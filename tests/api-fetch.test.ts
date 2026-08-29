import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, apiFetch } from "../viewer/src/apiFetch.js";

test("apiFetch exposes explicitly accepted conflicts and rejects them by default", async () => {
	const originalFetch = globalThis.fetch;
	let localHeader = "";
	globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
		localHeader = new Headers(init?.headers).get("X-GraphBrain-Local") ?? "";
		return new Response(JSON.stringify({ code: "READING_CONTEXT_CONFLICT", revision: 4 }), {
			status: 409,
			headers: { "Content-Type": "application/json", "X-Reading-Context-Revision": "4" },
		});
	}) as typeof fetch;
	try {
		await assert.rejects(
			apiFetch("/api/favorites/ue5_code", undefined, { notify: false }),
			(error: unknown) => error instanceof ApiError && error.status === 409,
		);
		const accepted = await apiFetch("/api/favorites/ue5_code", undefined, {
			notify: false,
			acceptStatuses: [409],
		});
		assert.equal(accepted.status, 409);
		assert.equal(localHeader, "1");
	} finally {
		globalThis.fetch = originalFetch;
	}
});
