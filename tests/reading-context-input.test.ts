import assert from "node:assert/strict";
import test from "node:test";
import {
	parseAnnotationInput,
	parseExpectedRevision,
	parseFavoriteInput,
	parseRequiredId,
} from "../server/reading-context-input.js";
import {
	READING_CONTEXT_ACCEPT_STATUSES,
	readingContextRevisionOf,
} from "../viewer/src/readingContextHttp.js";

test("reading-context revision contracts reject ambiguous headers on both boundaries", () => {
	assert.equal(parseExpectedRevision('"17"'), 17);
	assert.equal(parseExpectedRevision("0"), 0);
	for (const value of [undefined, "", "revision-17", 'W/"17"', "-1", '"17", "18"']) {
		assert.equal(parseExpectedRevision(value), null, String(value));
	}
	assert.equal(parseExpectedRevision(['"17"', '"18"']), null);
	assert.deepEqual(READING_CONTEXT_ACCEPT_STATUSES, [409]);
	assert.equal(readingContextRevisionOf(new Response(null, { headers: { ETag: '"21"' } })), 21);
	assert.equal(readingContextRevisionOf(new Response(null, { headers: { ETag: 'W/"21"' } }), 7), 7);
});

test("favorite request parsing preserves declared semantics and rejects guessed defaults", () => {
	assert.deepEqual(parseFavoriteInput({
		kind: "class",
		source: "project",
		node_id: "AThing",
		label: "Thing",
	}), { kind: "class", source: "project", node_id: "AThing", label: "Thing" });
	assert.throws(() => parseFavoriteInput({ source: "project", node_id: "AThing" }), /kind/);
	assert.throws(() => parseFavoriteInput({ kind: "method", source: "project", node_id: "AThing" }), /kind/);
	assert.throws(() => parseFavoriteInput({ kind: "class", source: "guessed", node_id: "AThing" }), /source/);
	assert.throws(() => parseFavoriteInput({ kind: "class", source: "project", node_id: { id: "AThing" } }), /node_id/);
});

test("annotation request parsing requires complete add payloads and validates partial updates", () => {
	assert.deepEqual(parseAnnotationInput({ type: "gotcha", content: "Check ownership" }, true), {
		type: "gotcha",
		content: "Check ownership",
	});
	assert.deepEqual(parseAnnotationInput({ content: "Updated" }), { content: "Updated" });
	assert.throws(() => parseAnnotationInput({ content: "Missing type" }, true), /type/);
	assert.throws(() => parseAnnotationInput({ type: "invented", content: "x" }, true), /type/);
	assert.throws(() => parseAnnotationInput({ content: { text: "x" } }), /content/);
	assert.equal(parseRequiredId({ ann_id: "ann_1" }, "ann_id"), "ann_1");
	assert.throws(() => parseRequiredId({ ann_id: "" }, "ann_id"), /ann_id/);
});
