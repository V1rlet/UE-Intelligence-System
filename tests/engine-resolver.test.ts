// Graph Brain / tests - 引擎类头文件定位：命名空间枚举与常规声明双形态
// F31 回归：declRe 只认 `class|struct|enum <名字>` 字面声明——命名空间枚举
// （`namespace EDrawDebugTrace { enum Type }`）的名字跟在 namespace 后，定位永远失败，
// 按需解析报"未命中"、Spec 打开为空（用户两次报障的最终根因）。

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EngineResolver } from "../adapters/ue5-code/engine-resolver.js";

test("resolveClass：命名空间枚举经 source_path 精确路径可定位并解析出值成员", () => {
	const engineRoot = mkdtempSync(join(tmpdir(), "graphbrain-resolver-"));
	try {
		const headerDir = join(engineRoot, "Engine", "Source", "Runtime", "ZzModule", "Classes", "Kismet");
		mkdirSync(headerDir, { recursive: true });
		writeFileSync(join(headerDir, "ZzSystemLibrary.h"), `#pragma once

UENUM()
namespace EZzDrawDebugTrace
{
	enum Type
	{
		None,
		ForDuration,
	};
}

UCLASS()
class ZZ_API UZzSystemLibrary : public UObject
{
	GENERATED_BODY()
};
`, "utf8");
		const resolver = new EngineResolver(engineRoot);

		// 命名空间枚举：经辅助类型节点携带的 source_path（Engine/Source 相对根）定位
		const nsEnum = resolver.resolveClass("EZzDrawDebugTrace", "Runtime/ZzModule/Classes/Kismet/ZzSystemLibrary.h");
		assert.ok(nsEnum, "命名空间枚举必须能经精确路径定位");
		assert.equal(nsEnum.cls.kind, "uenum");
		assert.deepEqual(nsEnum.cls.properties.map((p) => p.name), ["None", "ForDuration"]);

		// 常规类声明不受影响（同文件、同 source_path 路由）
		const lib = resolver.resolveClass("UZzSystemLibrary", "Runtime/ZzModule/Classes/Kismet/ZzSystemLibrary.h");
		assert.ok(lib, "常规 UCLASS 定位不受影响");

		// 不存在的类型仍然未命中
		assert.equal(resolver.resolveClass("ENotThere", "Runtime/ZzModule/Classes/Kismet/ZzSystemLibrary.h"), null);
	} finally {
		rmSync(engineRoot, { recursive: true, force: true });
	}
});
