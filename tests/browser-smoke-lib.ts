import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const BASE = process.env.GB_SMOKE_BASE ?? "http://127.0.0.1:3030";

export interface CodeFixture {
	file: string;
	subsystem: string;
	specId: string;
}

export function findChrome(): string {
	const candidates = [
		process.env.GB_CHROME_EXE,
		"C:/Program Files/Google/Chrome/Application/chrome.exe",
		"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
		join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
	].filter((path): path is string => Boolean(path));
	for (const path of candidates) if (existsSync(path)) return path;
	throw new Error("未找到 Chrome；可通过 GB_CHROME_EXE 指定可执行文件");
}

export const delay = (ms: number) => new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms));

async function waitForProcessExit(process: ChildProcess, timeoutMs: number): Promise<boolean> {
	if (process.exitCode !== null || process.signalCode !== null) return true;
	await Promise.race([
		new Promise<void>((resolveExit) => process.once("exit", () => resolveExit())),
		delay(timeoutMs),
	]);
	return process.exitCode !== null || process.signalCode !== null;
}

async function removeBrowserProfile(profile: string): Promise<void> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 8; attempt += 1) {
		try {
			rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
			return;
		} catch (error) {
			lastError = error;
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "EPERM" && code !== "EBUSY" && code !== "ENOTEMPTY") throw error;
			await delay(150 + attempt * 100);
		}
	}
	console.warn(`[browser-smoke] temporary Chrome profile cleanup deferred: ${profile} (${String(lastError)})`);
}

async function stopBrowserProcess(chrome: ChildProcess): Promise<void> {
	if (await waitForProcessExit(chrome, 1_500)) return;
	if (process.platform === "win32" && chrome.pid) {
		spawnSync("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
	} else chrome.kill("SIGKILL");
	await waitForProcessExit(chrome, 2_000);
}

export async function waitUntil<T>(read: () => Promise<T | null>, label: string, timeoutMs = 20_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			const value = await read();
			if (value !== null) return value;
		} catch (error) {
			lastError = error;
		}
		await delay(100);
	}
	throw new Error(`等待超时：${label}${lastError ? `（${String(lastError)}）` : ""}`);
}

export async function resolveCodeFixture(): Promise<CodeFixture> {
	const response = await fetch(`${BASE}/api/graph-catalog`, { signal: AbortSignal.timeout(5_000) });
	if (!response.ok) throw new Error(`GraphBrain 服务异常：HTTP ${response.status}`);
	const catalog = await response.json() as Array<{ file: string; domain: string; subsystem: string; kind?: string }>;
	if (!catalog.length || catalog.some((entry) => entry.domain !== "ue5_code")) {
		throw new Error("图目录必须非空且只包含 ue5_code");
	}
	const entry = catalog.find((item) => item.subsystem === "project" && item.kind !== "mindmap")
		?? catalog.find((item) => item.kind !== "mindmap");
	if (!entry) throw new Error("图目录没有可查看的代码事实图");
	const graphResponse = await fetch(`${BASE}/data/graphs/${encodeURIComponent(entry.file)}`, { signal: AbortSignal.timeout(5_000) });
	if (!graphResponse.ok) throw new Error(`代码图读取失败：HTTP ${graphResponse.status}`);
	const graph = await graphResponse.json() as { elements?: { nodes?: Array<{ data?: { id?: unknown; type?: unknown } }> } };
	const specTypes = new Set(["uclass", "uactor", "ucomponent", "uinterface", "ustruct", "uenum"]);
	const spec = graph.elements?.nodes?.find((node) => specTypes.has(String(node.data?.type ?? "")));
	if (!spec?.data?.id) throw new Error(`${entry.file} 没有可用于类详情冒烟的代码类型`);
	return { file: entry.file, subsystem: entry.subsystem, specId: String(spec.data.id) };
}

export class CdpClient {
	private nextId = 1;
	private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	private listeners = new Map<string, Set<(params: unknown) => void>>();

	constructor(private readonly socket: WebSocket) {
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(String(event.data)) as { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message: string } };
			if (message.method) {
				for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
				return;
			}
			if (!message.id) return;
			const request = this.pending.get(message.id);
			if (!request) return;
			this.pending.delete(message.id);
			if (message.error) request.reject(new Error(message.error.message));
			else request.resolve(message.result);
		});
	}

	on<T = unknown>(method: string, listener: (params: T) => void): () => void {
		const listeners = this.listeners.get(method) ?? new Set<(params: unknown) => void>();
		const wrapped = (params: unknown) => listener(params as T);
		listeners.add(wrapped);
		this.listeners.set(method, listeners);
		return () => {
			listeners.delete(wrapped);
			if (listeners.size === 0) this.listeners.delete(method);
		};
	}

	send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		const id = this.nextId++;
		this.socket.send(JSON.stringify({ id, method, params }));
		return new Promise<T>((resolveRequest, rejectRequest) => {
			this.pending.set(id, { resolve: (value) => resolveRequest(value as T), reject: rejectRequest });
		});
	}

	async evaluate<T = unknown>(expression: string): Promise<T> {
		const response = await this.send<{ exceptionDetails?: { exception?: { description?: string; value?: unknown }; text?: string }; result?: { value?: T } }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
		if (response.exceptionDetails) {
			const exception = response.exceptionDetails.exception?.description ?? response.exceptionDetails.exception?.value;
			throw new Error(String(exception ?? response.exceptionDetails.text ?? "页面脚本执行失败"));
		}
		return response.result?.value as T;
	}

	close(): void {
		this.listeners.clear();
		this.socket.close();
	}
}

export interface BrowserSession {
	cdp: CdpClient;
	process: ChildProcess;
	profile: string;
	close: () => Promise<void>;
}

export async function launchBrowser(url: string, options: { reducedMotion?: boolean; windowSize?: string } = {}): Promise<BrowserSession> {
	const profile = mkdtempSync(join(tmpdir(), "graphbrain-cdp-"));
	const chrome = spawn(findChrome(), [
		"--headless=new",
		"--use-angle=swiftshader",
		"--enable-unsafe-swiftshader",
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-background-mode",
		"--disable-background-networking",
		"--disable-component-update",
		"--disable-default-apps",
		"--mute-audio",
		...(options.reducedMotion === false ? [] : ["--force-prefers-reduced-motion=reduce"]),
		"--remote-debugging-port=0",
		`--user-data-dir=${profile}`,
		`--window-size=${options.windowSize ?? "1440,900"}`,
		url,
	], { stdio: "ignore", windowsHide: true });

	try {
		const portFile = join(profile, "DevToolsActivePort");
		const port = await waitUntil(async () => {
			if (!existsSync(portFile)) return null;
			return Number(readFileSync(portFile, "utf8").split(/\r?\n/)[0]) || null;
		}, "Chrome 调试端口");
		const target = await waitUntil(async () => {
			const response = await fetch(`http://127.0.0.1:${port}/json/list`);
			const targets = await response.json() as Array<{ type: string; webSocketDebuggerUrl: string }>;
			return targets.find((item) => item.type === "page") ?? null;
		}, "Chrome 页面目标");
		const socket = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise<void>((resolveOpen, rejectOpen) => {
			socket.addEventListener("open", () => resolveOpen(), { once: true });
			socket.addEventListener("error", () => rejectOpen(new Error("浏览器调试连接失败")), { once: true });
		});
		const cdp = new CdpClient(socket);
		await cdp.send("Runtime.enable");
		await cdp.send("Page.enable");
		return {
			cdp,
			process: chrome,
			profile,
			close: async () => {
				try {
					await Promise.race([cdp.send("Browser.close").then(() => undefined), delay(1_000)]);
				} catch {
					// Browser.close can sever the socket before acknowledging the command.
				}
				cdp.close();
				await stopBrowserProcess(chrome);
				await removeBrowserProfile(profile);
			},
		};
	} catch (error) {
		await stopBrowserProcess(chrome);
		await removeBrowserProfile(profile);
		throw error;
	}
}

export async function waitForSelector(cdp: CdpClient, selector: string): Promise<void> {
	await waitUntil(async () => await cdp.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`) ? true : null, selector);
}

export async function navigate(cdp: CdpClient, url: string, selector: string): Promise<void> {
	await cdp.send("Page.navigate", { url });
	await waitForSelector(cdp, selector);
}

export async function captureScreenshot(cdp: CdpClient, path: string): Promise<void> {
	const result = await cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
	writeFileSync(path, result.data, "base64");
	if (statSync(path).size < 20_000) throw new Error(`${path} 疑似空白截图`);
}
