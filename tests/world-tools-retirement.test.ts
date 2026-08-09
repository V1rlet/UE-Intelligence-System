import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { handleRetiredWorldTools } from "../server/retired-world-tools.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVE = join(ROOT, "data", "archive", "world-atlas-v18");

interface RetirementManifest {
	schema: string;
	runtime_status: string;
	active_data_path: null;
	source_formats: Record<string, number>;
	projects: Array<{
		project_id: string;
		disposition: string;
		diagnostics: string[];
		files: Array<{ path: string; sha256: string }>;
	}>;
}

test("retired World Atlas content is immutable, versioned, and hash-addressed", () => {
	assert.equal(existsSync(join(ROOT, "data", "world-projects")), false);
	const manifest = JSON.parse(readFileSync(join(ARCHIVE, "migration-manifest.json"), "utf8")) as RetirementManifest;
	assert.equal(manifest.schema, "graphbrain.world-atlas-retirement/1");
	assert.equal(manifest.runtime_status, "retired");
	assert.equal(manifest.active_data_path, null);
	assert.deepEqual(manifest.source_formats, { world_atlas: 18, world_project: 2, quest_program: 2 });
	assert.deepEqual(manifest.projects.map((project) => project.project_id), ["demo-facility", "world-baf56900"]);

	for (const project of manifest.projects) {
		assert.ok(project.diagnostics.length > 0, `${project.project_id} must retain migration diagnostics`);
		assert.match(project.disposition, /^(engine_assets_require_review|archive_only)$/);
		for (const file of project.files) {
			const contents = readFileSync(join(ARCHIVE, file.path));
			assert.equal(createHash("sha256").update(contents).digest("hex"), file.sha256, file.path);
		}
	}
});

function responseProbe() {
	const headers = new Map<string, string>();
	let body = "";
	const res = {
		statusCode: 0,
		setHeader(name: string, value: string) { headers.set(name, value); },
		end(value?: string) { body = value ?? ""; },
	} as unknown as ServerResponse;
	return { res, headers, body: () => body };
}

test("all retired APIs terminate at one deterministic 410 boundary", async () => {
	for (const url of ["/api/world-atlas", "/api/world-projects/demo", "/api/quest-program", "/api/world-project-export/demo"]) {
		const probe = responseProbe();
		const handled = await handleRetiredWorldTools({
			req: { method: "POST", headers: {} } as IncomingMessage,
			res: probe.res,
			url,
			root: ROOT,
			dataDir: join(ROOT, "data"),
		});
		assert.equal(handled, true);
		assert.equal(probe.res.statusCode, 410);
		assert.equal(probe.headers.get("Content-Type"), "application/json; charset=utf-8");
		const payload = JSON.parse(probe.body()) as Record<string, unknown>;
		assert.equal(payload.code, "GRAPHBRAIN_WORLD_TOOLS_RETIRED");
		assert.equal(payload.archive, "data/archive/world-atlas-v18/");
	}

	const unrelated = responseProbe();
	assert.equal(await handleRetiredWorldTools({
		req: { method: "GET", headers: {} } as IncomingMessage,
		res: unrelated.res,
		url: "/api/design-deliveries",
		root: ROOT,
		dataDir: join(ROOT, "data"),
	}), false);
});
