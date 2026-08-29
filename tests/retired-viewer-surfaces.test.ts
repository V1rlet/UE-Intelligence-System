import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import test from "node:test";
import { handleRetiredViewerSurfaces } from "../server/retired-viewer-surfaces.js";

function responseProbe() {
	let body = "";
	const headers = new Map<string, string | number | readonly string[]>();
	const res = {
		statusCode: 0,
		setHeader(name: string, value: string | number | readonly string[]) { headers.set(name, value); },
		end(value?: string) { body = value ?? ""; },
	} as unknown as ServerResponse;
	return { res, headers, body: () => body };
}

async function invoke(url: string, method = "GET") {
	const probe = responseProbe();
	const handled = await handleRetiredViewerSurfaces({
		req: { method, headers: {}, url } as IncomingMessage,
		res: probe.res,
		url,
		root: resolve("."),
		dataDir: resolve("data"),
	});
	return { handled, status: probe.res.statusCode, headers: probe.headers, body: probe.body() };
}

test("retired Mermaid and generic embed routes share one stable diagnostic boundary", async () => {
	for (const [url, surface] of [
		["/embed/ue5_code/project", "generic-embed"],
		["/api/mermaid", "mermaid"],
		["/data/mermaid/example.mmd", "mermaid"],
	] as const) {
		const result = await invoke(url);
		assert.equal(result.handled, true);
		assert.equal(result.status, 410);
		const payload = JSON.parse(result.body);
		assert.equal(payload.code, "VIEWER_SURFACE_RETIRED");
		assert.equal(payload.surface, surface);
		assert.match(payload.compatibility, /diagnostic adapter/);
	}
});

test("retired viewer routes retain their read-only method contract", async () => {
	const result = await invoke("/api/mermaid", "POST");
	assert.equal(result.status, 405);
	assert.equal(result.headers.get("Allow"), "GET");
	assert.equal((await invoke("/api/not-retired")).handled, false);
});
