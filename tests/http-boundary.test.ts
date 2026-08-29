import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";
import {
	HttpInputError,
	HttpPayloadTooLargeError,
	readJsonBody,
	sendHttpError,
	sendInternalError,
} from "../server/http.js";

function requestBody(chunks: Array<string | Buffer>): IncomingMessage {
	const listeners: Record<string, Array<(chunk?: string | Buffer) => void>> = {};
	const request = {
		headers: {},
		on(event: string, listener: (chunk?: string | Buffer) => void) {
			(listeners[event] ??= []).push(listener);
			return request;
		},
	} as unknown as IncomingMessage;
	queueMicrotask(() => {
		for (const chunk of chunks) listeners.data?.forEach((listener) => listener(chunk));
		listeners.end?.forEach((listener) => listener());
	});
	return request;
}

function responseProbe() {
	let body = "";
	const headers = new Map<string, string | number | readonly string[]>();
	const response = {
		statusCode: 0,
		setHeader(name: string, value: string | number | readonly string[]) { headers.set(name, value); },
		end(value?: string) { body = value ?? ""; },
	} as unknown as ServerResponse;
	return { response, headers, body: () => body };
}

test("JSON request boundary distinguishes malformed and oversized payloads", async () => {
	await assert.rejects(readJsonBody(requestBody(["{"])), (error: unknown) =>
		error instanceof HttpInputError && error.status === 400 && error.code === "INVALID_REQUEST");
	await assert.rejects(readJsonBody(requestBody([JSON.stringify(["not", "an", "object"])])), (error: unknown) =>
		error instanceof HttpInputError && error.status === 400);
	await assert.rejects(readJsonBody(requestBody([Buffer.alloc(1024 * 1024 + 1)])), (error: unknown) =>
		error instanceof HttpPayloadTooLargeError && error.status === 413 && error.code === "PAYLOAD_TOO_LARGE");
});

test("HTTP boundary emits declared client errors and hides unexpected operational details", () => {
	const declared = responseProbe();
	assert.equal(sendHttpError(declared.response, new HttpInputError("字段无效")), true);
	assert.equal(declared.response.statusCode, 400);
	assert.deepEqual(JSON.parse(declared.body()), { error: "字段无效", code: "INVALID_REQUEST" });

	const unexpected = responseProbe();
	const oldConsoleError = console.error;
	console.error = () => undefined;
	try {
		assert.equal(sendHttpError(unexpected.response, new Error("G:\\secret\\reading-context.json")), false);
		sendInternalError(unexpected.response, new Error("G:\\secret\\reading-context.json"), "test failure");
	} finally {
		console.error = oldConsoleError;
	}
	assert.equal(unexpected.response.statusCode, 500);
	assert.deepEqual(JSON.parse(unexpected.body()), { error: "GraphBrain 内部错误", code: "INTERNAL_ERROR" });
	assert.doesNotMatch(unexpected.body(), /secret|reading-context/);
});
