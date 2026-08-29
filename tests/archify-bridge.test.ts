import assert from "node:assert/strict";
import test from "node:test";
import { mapNeighborhoodToArchitectureIR, MAX_COMPONENTS } from "../tools/archify-bridge.js";

const STATUS = { snapshot_id: "evidence-generation-abcdef1234567890", freshness: "current", publication_revision: 5 };

function neighborhood() {
	return {
		center_id: "ASabotageCharacter",
		symbols: [
			{ id: "ACharacter", label: "ACharacter", type: "uactor", module: "Engine", layer: "engine", source: { path: "Runtime/Engine/Classes/GameFramework/Character.h" }, evidence: { classification: "direct", method: "direct", confidence: 1 } },
			{ id: "USabotageTagEventSubsystem", label: "USabotageTagEventSubsystem", type: "uclass", module: "Sabotage", layer: "project" },
			{ id: "ESabotageInputContext", label: "ESabotageInputContext", type: "uenum", module: "Sabotage", layer: "project" },
			{ id: "ASabotageCharacter", label: "ASabotageCharacter", type: "uactor", module: "Sabotage", layer: "project", source: { path: "Source/Sabotage/SabotageCharacter.h", span: { start_line: 12 } }, evidence: { classification: "direct", method: "direct", confidence: 1 } },
		],
		relations: [
			{ source_id: "ASabotageCharacter", target_id: "ACharacter", relation: "inherits" },
			{ source_id: "ASabotageCharacter", target_id: "USabotageTagEventSubsystem", relation: "uses_member" },
			{ source_id: "ASabotageCharacter", target_id: "ESabotageInputContext", relation: "depends_on" },
			{ source_id: "ASabotageCharacter", target_id: "ASabotageCharacter", relation: "self" },
			{ source_id: "ACharacter", target_id: "UObject", relation: "inherits" },
		],
	};
}

test("bridge maps neighborhood to showcase architecture IR with evidence card", () => {
	const ir = mapNeighborhoodToArchitectureIR("ASabotageCharacter", STATUS, neighborhood());
	assert.equal(ir.schema_version, 1);
	assert.equal(ir.diagram_type, "architecture");
	assert.equal(ir.meta.quality_profile, "showcase");
	// 星形网格摆放：中心 (1,1)，schema 要求 grid 模式
	assert.deepEqual(ir.layout, { mode: "grid", cols: 3 });
	assert.deepEqual([ir.components[0].row, ir.components[0].col], [1, 1]);
	// 中心必选且居首；其余项目层优先，同层按 id 字典序
	assert.equal(ir.components[0].label, "ASabotageCharacter");
	assert.equal(ir.components[1].label, "ESabotageInputContext");
	// UE 类型映射 + sublabel
	const enumComp = ir.components.find((c) => c.label === "ESabotageInputContext");
	assert.equal(enumComp?.type, "database");
	assert.equal(enumComp?.sublabel, "Sabotage / project");
	// 关系：两端都入选才保留，自环与圈外目标丢弃，标签走关系词典
	// 默认不带边标签（平行同标签边会在 showcase 下拥挤）；语义由证据卡承载。
	const from = ir.components.find((c) => c.label === "ASabotageCharacter")!.id;
	assert.deepEqual(ir.connections.map((c) => ({ from: c.from, to: c.to })), [
		{ from, to: ir.components.find((c) => c.label === "ACharacter")!.id },
		{ from, to: ir.components.find((c) => c.label === "USabotageTagEventSubsystem")!.id },
		{ from, to: ir.components.find((c) => c.label === "ESabotageInputContext")!.id },
	]);
	// --labels 选项恢复关系词典标签
	const labeled = mapNeighborhoodToArchitectureIR("ASabotageCharacter", STATUS, neighborhood(), { labels: true });
	assert.equal(labeled.connections[0].label, "inherits");
	// 证据墙：snapshot/freshness/revision/provenance 随图交付
	const items = ir.cards[0].items;
	assert.ok(items.some((line) => line.startsWith("snapshot evidence-gener")));
	assert.ok(items.some((line) => line.includes("freshness current / publication rev 5")));
	assert.ok(items.some((line) => line.includes("Source/Sabotage/SabotageCharacter.h @ L12")));
});

test("bridge caps components and keeps center under the showcase limit", () => {
	const symbols = [
		{ id: "ASabotageCharacter", type: "uactor", layer: "project" },
		...Array.from({ length: 30 }, (_, i) => ({ id: `N${String(i).padStart(2, "0")}`, type: "uclass", layer: i % 2 ? "engine" : "project" })),
	];
	const ir = mapNeighborhoodToArchitectureIR("ASabotageCharacter", STATUS, { symbols, relations: [] });
	assert.equal(ir.components.length, MAX_COMPONENTS);
	assert.equal(ir.components[0].label, "ASabotageCharacter");
	const ids = new Set(ir.components.map((c) => c.id));
	assert.equal(ids.size, MAX_COMPONENTS);
});

test("bridge rejects malformed evidence payloads instead of emitting an empty diagram", () => {
	assert.throws(() => mapNeighborhoodToArchitectureIR("X", STATUS, { symbols: [], relations: [] }), /邻域为空/);
	assert.throws(() => mapNeighborhoodToArchitectureIR("X", STATUS, { symbols: "nope", relations: [] }), /不是数组/);
	assert.throws(() => mapNeighborhoodToArchitectureIR("X", STATUS, { symbols: [{}], relations: "nope" }), /不是数组/);
});
