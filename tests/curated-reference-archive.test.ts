import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { handleGraphProjection } from "../server/graph-projection.js";
import { handleDataFiles } from "../server/misc.js";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "graphbrain-curated-archive-"));
	const dataDir = join(root, "data");
	const archive = join(dataDir, "archive", "curated-references-v1");
	mkdirSync(archive, { recursive: true });
	writeFileSync(join(archive, "migration-manifest.json"), JSON.stringify({
		format_version: "graphbrain.curated-reference-archive/1",
		status: "archived",
		entries: [{ file: "legacy.cyto.json", subsystem: "legacy", original_path: "data/graphs/legacy.cyto.json", archive_path: "data/archive/curated-references-v1/graphs/legacy.cyto.json", bytes: 1, sha256: "a".repeat(64), annotation_targets: 0 }],
	}));
	return { root, dataDir };
}

function responseProbe() {
	let body = "";
	const response = { statusCode: 0, setHeader() {}, end(value?: string) { body = value ?? ""; } } as unknown as ServerResponse;
	return { response, json: () => JSON.parse(body) as Record<string, unknown> };
}

test("archived graph data and projection paths return one stable 410 diagnostic", async (t) => {
	const current = fixture();
	t.after(() => rmSync(current.root, { recursive: true, force: true }));
	for (const [handler, url, requestUrl] of [
		[handleDataFiles, "/data/graphs/legacy.cyto.json", "/data/graphs/legacy.cyto.json"],
		[handleGraphProjection, "/api/graph-projection", "/api/graph-projection?file=legacy.cyto.json"],
	] as const) {
		const probe = responseProbe();
		assert.equal(await handler({
			req: { method: "GET", url: requestUrl, headers: {} } as IncomingMessage,
			res: probe.response, url, root: current.root, dataDir: current.dataDir,
		}), true);
		assert.equal(probe.response.statusCode, 410);
		assert.equal(probe.json().code, "CURATED_REFERENCE_ARCHIVED");
	}
});
