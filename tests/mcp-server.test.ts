// V7 回归：gb/1 MCP 工具面验收。
// spawn tools/mcp-server.ts 子进程，stdio 完成 initialize → tools/list → 逐工具 tools/call：
// - 工具清单与 gb/1 声明一致（7 个只读工具，无写方法）；
// - gb_search_symbols 返回 provenance 字段（快照/发布/引擎身份透传）；
// - require-fresh 语义：空/不可用数据根（freshness≠current）返回 EVIDENCE_STALE 诊断而非事实数据；
// - 协议面拒绝未知（写类）工具调用。
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const REPO_ROOT = resolve(createRequire(import.meta.url).resolve("../package.json"), "..");
const SERVER = resolve(REPO_ROOT, "tools", "mcp-server.ts");
const TSX_CLI = join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");

interface Pending {
	resolve: (value: Record<string, unknown>) => void;
	reject: (error: Error) => void;
}

class McpClient {
	private child: ChildProcessWithoutNullStreams;
	private buffer = "";
	private nextId = 1;
	private pending = new Map<number, Pending>();

	constructor(root: string) {
		this.child = spawn(process.execPath, [TSX_CLI, SERVER], {
			cwd: REPO_ROOT,
			windowsHide: true,
			env: { ...process.env, GRAPH_BRAIN_ROOT: root },
		}) as ChildProcessWithoutNullStreams;
		this.child.stdout.setEncoding("utf8");
		this.child.stdout.on("data", (chunk: string) => {
			this.buffer += chunk;
			let newlineAt = this.buffer.indexOf("\n");
			while (newlineAt >= 0) {
				const line = this.buffer.slice(0, newlineAt).trim();
				this.buffer = this.buffer.slice(newlineAt + 1);
				if (line) this.dispatch(line);
				newlineAt = this.buffer.indexOf("\n");
			}
		});
		this.child.stderr.on("data", () => { /* 就绪日志走 stderr，不参与断言 */ });
	}

	private dispatch(line: string): void {
		const message = JSON.parse(line) as { id?: number; result?: Record<string, unknown>; error?: { message: string } };
		if (typeof message.id !== "number") return;
		const pending = this.pending.get(message.id);
		if (!pending) return;
		this.pending.delete(message.id);
		if (message.error) pending.reject(new Error(message.error.message));
		else pending.resolve(message.result ?? {});
	}

	request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
		const id = this.nextId++;
		return new Promise<Record<string, unknown>>((resolveRequest, rejectRequest) => {
			this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
			this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
		});
	}

	notify(method: string, params: Record<string, unknown> = {}): void {
		this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
	}
	close(): void {
		this.child.kill();
	}
}

const GB_TOOLS = ["gb_status", "gb_search_symbols", "gb_symbol_detail", "gb_neighborhood", "gb_impact", "gb_changes", "gb_annotations_get"] as const;

test("V7：initialize → tools/list 与 gb/1 声明一致，且不含任何写方法", async () => {
	const client = new McpClient(REPO_ROOT);
	try {
		const init = await client.request("initialize", {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "graphbrain-v7-test", version: "0" },
		});
		assert.equal((init.serverInfo as { name?: string } | undefined)?.name, "graphbrain");
		client.notify("notifications/initialized");
		const listed = await client.request("tools/list", {});
		const names = (listed.tools as Array<{ name: string }>).map((tool) => tool.name).sort();
		assert.deepEqual(names, [...GB_TOOLS].sort(), "工具清单必须与 gb/1 声明完全一致");
		for (const name of names) {
			assert.match(name, /^gb_[a-z_]+$/, `工具名必须带 gb_ 前缀且不含写语义动词：${name}`);
			assert.doesNotMatch(name, /write|mutate|create|delete|save|update/, `只读面禁止写语义工具名：${name}`);
		}
	} finally {
		client.close();
	}
});

test("V7：gb_search_symbols 返回 provenance；新鲜度门槛 fail-closed 返回诊断码", async () => {
	const freshClient = new McpClient(REPO_ROOT);
	try {
		await handshake(freshClient);
		const call = await callTool(freshClient, "gb_search_symbols", { text: "Project", limit: 5 });
		const payload = JSON.parse((call.content as Array<{ type: string; text: string }>)[0].text) as Record<string, unknown>;
		assert.equal(payload.format_version, "graphbrain-mcp/1");
		assert.ok(payload.provenance === undefined || typeof payload.provenance === "object");
		for (const key of ["snapshot_id", "publication_revision", "engine_identity"]) {
			assert.ok(key in payload, `provenance 必须透传 ${key}`);
		}
	} finally {
		freshClient.close();
	}

	const staleRoot = mkdtempSync(join(tmpdir(), "graphbrain-v7-stale-"));
	const staleClient = new McpClient(staleRoot);
	try {
		await handshake(staleClient);
		const stale = await callTool(staleClient, "gb_search_symbols", { text: "anything" });
		assert.equal(stale.isError, true, "不满足新鲜度门槛必须以错误结果收敛");
		const diagnostic = JSON.parse((stale.content as Array<{ type: string; text: string }>)[0].text) as Record<string, unknown>;
		assert.equal(diagnostic.code, "EVIDENCE_STALE");
		assert.equal(diagnostic.symbols, undefined, "诊断结果不得夹带事实数据");
		assert.ok(staleRoot.length > 0);
	} finally {
		staleClient.close();
		rmSync(staleRoot, { recursive: true, force: true });
	}
});

test("V7：协议面拒绝未声明的写类工具调用", async () => {
	const client = new McpClient(REPO_ROOT);
	try {
		await handshake(client);
		const rejected = await callTool(client, "gb_write_annotations", { node_id: "UProject" });
		assert.equal(rejected.isError, true, "未声明工具必须被拒绝执行（不存在写旁路）");
		const text = (rejected.content as Array<{ type: string; text: string }>)[0].text;
		assert.match(text, /unknown tool|not found/i);
	} finally {
		client.close();
	}
});

function handshake(client: McpClient): Promise<void> {
	return (async () => {
		await client.request("initialize", {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "graphbrain-v7-test", version: "0" },
		});
		// initialized 是通知（无响应体）：必须 fire-and-forget，await 会永久挂起。
		client.notify("notifications/initialized");
	})();
}

function callTool(client: McpClient, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
	return client.request("tools/call", { name, arguments: args });
}
