import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { extractEngineApiSymbols } from "../adapters/ue5-code/engine-api-catalog.js";
import { EngineResolver } from "../adapters/ue5-code/engine-resolver.js";
import { epicModuleCachePath, syncEpicApiModules } from "../adapters/ue5-code/epic-api-sync.js";

test("引擎 API 目录只收类型定义，忽略注释、模板参数与前向声明", () => {
	const symbols = extractEngineApiSymbols(`
		// class ACommentExample {};
		template<class ActorClass> struct TContainer {};
		class AForwardOnly;
		class ENGINE_API ARealActor : public AActor { };
		class UE_DEPRECATED(5.0, "use ARealActor") AOldActor : public AActor { };
		struct ENGINE_API FRealData { int Value; };
		enum class ERealState : uint8 { Ready };
	`);

	assert.deepEqual(symbols, [
		{ name: "ARealActor", kind: "class", parseable: true },
		{ name: "AOldActor", kind: "class", parseable: true },
		{ name: "FRealData", kind: "struct", parseable: true },
		{ name: "ERealState", kind: "enum", parseable: true },
	]);
});

test("引擎 API 目录把反射与普通 F/E/I/S C++ 定义统一标为可解析 Spec", () => {
	const symbols = extractEngineApiSymbols(`
		UCLASS() class ENGINE_API AParsedActor : public AActor { };
		USTRUCT(BlueprintType) struct FParsedData { };
		UENUM() enum class EParsedState : uint8 { Ready };
		UENUM() enum class AnimPhysCollisionType : uint8 { Sphere };
		class APlainCppType { };
		class IPlainContract { virtual void Execute() = 0; };
		class SPlainWidget { void Construct(); };
	`);
	assert.deepEqual(symbols, [
		{ name: "AParsedActor", kind: "class", parseable: true },
		{ name: "FParsedData", kind: "struct", parseable: true },
		{ name: "APlainCppType", kind: "class", parseable: true },
		{ name: "IPlainContract", kind: "class", parseable: true },
		{ name: "SPlainWidget", kind: "class", parseable: true },
		{ name: "EParsedState", kind: "enum", parseable: true },
	]);
});

test("引擎解析器支持 UE_DEPRECATED 与 ADEPRECATED_ 类型定位", () => {
	const engineRoot = mkdtempSync(join(tmpdir(), "graphbrain-engine-api-"));
	const classesDir = join(engineRoot, "Engine", "Source", "Runtime", "Engine", "Classes");
	mkdirSync(classesDir, { recursive: true });
	writeFileSync(join(classesDir, "AtmosphericFog.h"), `
		UCLASS()
		class UE_DEPRECATED(4.26, "use SkyAtmosphere") AAtmosphericFog : public AInfo
		{
			GENERATED_BODY()
			UFUNCTION() void RefreshFog();
		};
	`);
	writeFileSync(join(classesDir, "LightWeightInstanceManager.h"), `
		UCLASS()
		class ADEPRECATED_LightWeightInstanceManager : public AActor
		{
			GENERATED_BODY()
		};
	`);

	const resolver = new EngineResolver(engineRoot);
	assert.equal(resolver.resolveClass("AAtmosphericFog")?.cls.name, "AAtmosphericFog");
	assert.equal(
		resolver.resolveClass("ADEPRECATED_LightWeightInstanceManager")?.cls.name,
		"ADEPRECATED_LightWeightInstanceManager",
	);
});

test("引擎解析器用同一模型解析普通 F/E/I/S 类型及其函数或枚举项", () => {
	const engineRoot = mkdtempSync(join(tmpdir(), "graphbrain-engine-plain-types-"));
	const publicDir = join(engineRoot, "Engine", "Source", "Runtime", "SlateCore", "Public");
	mkdirSync(publicDir, { recursive: true });
	const sourcePath = "Source/Runtime/SlateCore/Public/SharedTypes.h";
	writeFileSync(join(publicDir, "SharedTypes.h"), `
		struct FPlainPayload { int32 Count; void Reset(); };
		enum class EPlainState : uint8 { Idle, Ready };
		class IPlainSource { virtual bool Resolve(int32 Value) const = 0; };
		class SPlainWidget { void Construct(); static SPlainWidget* Make(); };
	`);
	const resolver = new EngineResolver(engineRoot);
	const cases = [
		["FPlainPayload", "ustruct", ["Reset"]],
		["EPlainState", "uenum", []],
		["IPlainSource", "uinterface", ["Resolve"]],
		["SPlainWidget", "uclass", ["Construct", "Make"]],
	] as const;
	for (const [name, kind, functions] of cases) {
		const cls = resolver.resolveClass(name, sourcePath)?.cls;
		assert.equal(cls?.kind, kind, name);
		assert.deepEqual(cls?.functions.map((fn) => fn.name), functions, name);
	}
	assert.deepEqual(resolver.resolveClass("EPlainState", sourcePath)?.cls.properties.map((entry) => entry.name), ["Idle", "Ready"]);
});

test("All modules 批量同步使用并发池且单模块失败不会中断其余本地缓存", async () => {
	const cacheDir = mkdtempSync(join(tmpdir(), "graphbrain-api-batch-"));
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input) => {
		const url = String(input);
		if (url.endsWith("/BadModule")) return new Response("failed", { status: 503 });
		return new Response('<h2 id="Classes">Classes</h2><table><tr><td><a href="/GoodType">FGoodType</a></td><td>Good</td></tr></table>', { status: 200 });
	};
	try {
		const progress: { completed: number; succeeded: number; failed: number }[] = [];
		const result = await syncEpicApiModules([
			{ scope: "Runtime", module: "GoodModule", url: "" },
			{ scope: "Runtime", module: "BadModule", url: "" },
		], 2, cacheDir, (status) => progress.push({ completed: status.completed, succeeded: status.succeeded, failed: status.failed }));
		assert.deepEqual({ requested: result.requested, succeeded: result.succeeded }, { requested: 2, succeeded: 1 });
		assert.equal(result.failed.length, 1);
		assert.deepEqual(progress.at(-1), { completed: 2, succeeded: 1, failed: 1 });
		assert.ok(existsSync(epicModuleCachePath("Runtime", "GoodModule", cacheDir)));
	} finally {
		globalThis.fetch = originalFetch;
	}
});
