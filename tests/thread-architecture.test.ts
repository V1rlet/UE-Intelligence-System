import assert from "node:assert/strict";
import test from "node:test";
import { UE5_THREAD_EDGES, UE5_THREAD_NODES } from "../adapters/ue5-code/thread-architecture.js";
import { CODE_QUICK_ENTRIES, CODE_QUICK_GROUPS } from "../viewer/src/codeQuickEntries.js";

test("UE5.8 执行模型拥有闭合端点、源码证据和安全边界", () => {
	const ids = new Set(UE5_THREAD_NODES.map((node) => node.data.id));
	assert.equal(ids.size, UE5_THREAD_NODES.length);
	for (const node of UE5_THREAD_NODES) {
		assert.ok(String(node.data.safetyBoundary).length > 20, `${node.data.id} should document its safety boundary`);
		const evidence = node.data.sourceEvidence as Array<{ path: string; symbol: string; line: number }>;
		assert.ok(evidence.length > 0, `${node.data.id} should have source evidence`);
		assert.ok(evidence.every((item) => item.path && item.symbol && item.line > 0));
	}
	for (const edge of UE5_THREAD_EDGES) {
		assert.ok(ids.has(edge.data.source), `unknown source ${edge.data.source}`);
		assert.ok(ids.has(edge.data.target), `unknown target ${edge.data.target}`);
	}
});

test("线程模型保留 UE 的可选线程与 Chaos 阶段语义", () => {
	const render = UE5_THREAD_NODES.find((node) => node.data.id === "thread:render")?.data;
	const chaos = UE5_THREAD_NODES.find((node) => node.data.id === "tasks:chaos")?.data;
	assert.equal(render?.optional, true);
	assert.match(String(render?.description), /折叠回 Game Thread/);
	assert.equal(chaos?.executionKind, "solver_tasks");
	assert.doesNotMatch(String(chaos?.label), /^Physics Thread$/i);
	assert.ok(UE5_THREAD_EDGES.some((edge) => edge.data.source === "thread:async-loading" && edge.data.target === "thread:game" && edge.data.relation === "completes_on"));
});

test("API 快速入口覆盖系统库、Gameplay 框架和玩法能力", () => {
	assert.deepEqual(CODE_QUICK_GROUPS.map((group) => group.id), ["system", "framework", "capability"]);
	const names = new Set(CODE_QUICK_ENTRIES.map((entry) => entry.name));
	assert.equal(names.size, CODE_QUICK_ENTRIES.length);
	for (const required of ["AActor", "ACharacter", "APlayerController", "AGameModeBase", "UActorComponent", "UEnhancedInputComponent", "UAbilitySystemComponent"]) {
		assert.ok(names.has(required), `${required} should be a Gameplay quick entry`);
	}
});
