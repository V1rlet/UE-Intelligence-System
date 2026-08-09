import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseProperty } from "../adapters/ue5-code/header-parser.js";
import { PARSE_CACHE_VERSION, emptyParseCache, loadParseCache, saveParseCache } from "../adapters/ue5-code/parse-cache.js";
import { checkGraphReferences, type GraphShape } from "../core/schema/graph-checks.js";
import { checkUeClassName, ueHeaderStemForType, ueSpecTypeLabel, ueTypeFromCodeName, ueTypeLabel } from "../core/schema/ue-naming.js";

test("UE 节点类型使用真实 C++ 前缀语义", () => {
	assert.equal(checkUeClassName("APlayerCombatCharacter", "uactor"), null);
	assert.match(checkUeClassName("UPlayerCombatCharacter", "uactor") ?? "", /必须以 A 开头/);
	assert.equal(ueTypeLabel("uactor"), "Actor 类（A 前缀）");
});

test("代码类型前缀映射由单一系统表驱动 F/E/I/S 与头文件定位", () => {
	const cases = [
		["ACombatActor", "uactor", "CombatActor"],
		["UCombatComponent", "ucomponent", "CombatComponent"],
		["FCombatSpec", "ustruct", "CombatSpec"],
		["ECombatState", "uenum", "CombatState"],
		["ICombatSource", "uinterface", "CombatSource"],
		["SCombatWidget", "uclass", "CombatWidget"],
	] as const;
	for (const [name, type, stem] of cases) {
		assert.equal(ueTypeFromCodeName(name), type, name);
		assert.equal(ueHeaderStemForType(name), stem, name);
	}
});

test("纯 C++ Spec 的类型说明不会为空并保留原始声明种类", () => {
	assert.equal(ueSpecTypeLabel("", "FPlainHelper", "class", true), "class（纯 C++） · 结构体（F 前缀）");
	assert.equal(ueSpecTypeLabel(undefined, "SPlainWidget", undefined, true), "class（纯 C++） · UObject / Slate / 普通 C++ 类（U/S 前缀）");
});

test("UPROPERTY 位域不会把位宽解析成成员名", () => {
	assert.deepEqual(parseProperty("uint8 bIsEnabled : 1"), {
		name: "bIsEnabled",
		type: "uint8",
		targetClass: null,
		relation: "composes",
	});
	assert.deepEqual(parseProperty("TObjectPtr<UInputAction> AttackAction = nullptr"), {
		name: "AttackAction",
		type: "TObjectPtr<UInputAction>",
		targetClass: "UInputAction",
		relation: "composes",
	});
});

test("图一致性检查覆盖全局 id 冲突、重复边和 parent 循环", () => {
	const graph: GraphShape = {
		meta: { domain: "ue5_code", subsystem: "test", format_version: 2 },
		elements: {
			nodes: [
				{ data: { id: "AOne", type: "uactor", parent: "ATwo" } },
				{ data: { id: "ATwo", type: "uactor", parent: "AOne" } },
			],
			edges: [
				{ data: { id: "AOne", source: "AOne", target: "ATwo" } },
				{ data: { id: "AOne", source: "ATwo", target: "AOne" } },
			],
		},
	};
	const errors = checkGraphReferences(graph).join("\n");
	assert.match(errors, /节点与边 id 冲突/);
	assert.match(errors, /重复的边 id/);
	assert.match(errors, /parent 形成循环/);
});

test("解析器升级后旧缓存失效，新缓存可正常读取", () => {
	const dir = mkdtempSync(join(tmpdir(), "graph-brain-test-"));
	const path = join(dir, "parse-cache.json");
	try {
		writeFileSync(path, JSON.stringify({ version: 1, domain: "ue5_code" }), "utf8");
		assert.equal(loadParseCache(path), null);
		const cache = emptyParseCache("test", [dir]);
		saveParseCache(path, cache);
		assert.equal(loadParseCache(path)?.version, PARSE_CACHE_VERSION);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
