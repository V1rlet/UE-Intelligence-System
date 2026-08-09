import assert from "node:assert/strict";
import test from "node:test";
import { resolveNodeSourceHash } from "../core/annotation/staleness.js";
import { knowledgeContext } from "../viewer/components/annotation-panel/knowledgeContext.js";

test("annotations are code-fact notes with source binding semantics", () => {
	const context = knowledgeContext("ue5_code");
	assert.equal(context.domain, "ue5_code");
	assert.equal(context.title, "工程标注");
	assert.equal(context.sourceName, "源码");
	assert.equal(context.objectName, "代码对象");
	assert.deepEqual(context.types.map((type) => type.label), ["风险", "实践", "决策", "性能", "依据"]);
});

test("retired domains cannot produce annotation source hashes", () => {
	assert.equal(resolveNodeSourceHash("retired_domain", "demo", "area_one"), null);
});
