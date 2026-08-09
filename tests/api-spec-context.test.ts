import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hasConcreteSpecTarget, resolveApiSpecContext } from "../viewer/components/api-view/apiSpecContext";
import type { GraphElements } from "../viewer/components/graph-view/GraphView";
import { advanceSpecTrail } from "../viewer/components/graph-view/specNavigation";

const project: GraphElements = {
	nodes: [{ data: { id: "UShared", type: "uclass", layer: "project", inheritance_chain: ["UObject", "UShared"], projectOnly: true } }],
	edges: [{ data: { id: "project-edge", source: "UShared", target: "UObject", relation: "depends_on" } }],
};
const engine: GraphElements = {
	nodes: [
		{ data: { id: "UShared", type: "uclass", source_path: "Engine/UShared.h", inheritance_chain: ["UObject", "UShared"], engineOnly: true } },
		{ data: { id: "UEngineOnly", type: "uclass", source_path: "Engine/UEngineOnly.h", inheritance_chain: ["UObject", "UEngineOnly"] } },
	],
	edges: [],
};

test("API class context reuses the exact GraphElements consumed by the shared Spec", () => {
	const projectContext = resolveApiSpecContext(project, engine, "project", "UShared");
	assert.equal(projectContext?.elements, project);
	assert.deepEqual(projectContext?.target, { id: "UShared", chain: ["UObject", "UShared"] });

	const engineContext = resolveApiSpecContext(project, engine, "engine", "UEngineOnly");
	assert.equal(engineContext?.elements, engine);
	assert.deepEqual(engineContext?.target, { id: "UEngineOnly", chain: ["UObject", "UEngineOnly"] });
});

test("Spec navigation rejects outline stubs and truncates cyclic breadcrumb jumps", () => {
	const withStub: GraphElements = {
		nodes: [...engine.nodes, { data: { id: "UOutline", type: "uclass", layer: "engine" } }],
		edges: [],
	};
	assert.equal(hasConcreteSpecTarget(withStub, "UOutline"), false);
	assert.equal(resolveApiSpecContext(project, withStub, "engine", "UOutline"), null);
	assert.deepEqual(
		advanceSpecTrail([{ id: "UA" }, { id: "UB" }], { id: "UA", sourcePath: "A.h" }),
		[{ id: "UA", sourcePath: "A.h" }],
	);
});

test("all-source API context prefers project facts and falls back to parsed engine facts", () => {
	assert.equal(resolveApiSpecContext(project, engine, "all", "UShared")?.elements, project);
	assert.equal(resolveApiSpecContext(project, engine, "all", "UEngineOnly")?.elements, engine);
	assert.equal(resolveApiSpecContext(project, engine, "all", "UMissing"), null);
});

test("API class workspace mounts the same Spec view and inspector on one shared context", () => {
	const source = readFileSync("viewer/components/api-view/ApiReferenceView.tsx", "utf8");
	assert.match(source, /<SpecView[\s\S]*?elements=\{apiSpecContext\.elements\}[\s\S]*?target=\{apiSpecContext\.target\}/);
	assert.match(source, /<ReadonlySpecPanel[\s\S]*?elements=\{apiSpecContext\.elements\}[\s\S]*?target=\{apiSpecContext\.target\}/);
	assert.match(source, /showSharedSpecLayout && apiSpecContext/);
	assert.match(source, /className="api-spec-breadcrumb"/);
	assert.match(source, /!contextClass \? \(source === "engine"/);
	assert.ok(!source.includes("showSemanticClassLayout"), "旧条目式语义主视图分支必须清除");
	assert.ok(!source.includes("api-semantic-section"), "F/E/I/S 不得回退到旧分类卡片");
});
