// Graph Brain / adapters/ue5-code - Epic UE 5.8 C++ API 内容同步器
// 显式同步官方目录/模块页，解析名称与 Remarks 后落地 data/api-catalog，查看器运行时只读本地缓存。

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveGraphBrainProjectRoot } from "../../core/source/project-root.js";
import type { EngineApiScope } from "./engine-api-catalog.js";

const DOCS_ORIGIN = "https://dev.epicgames.com";
const DOCS_ROOT = `${DOCS_ORIGIN}/documentation/en-us/unreal-engine/API`;
const ROOT = resolveGraphBrainProjectRoot(import.meta.url, "..", "..");
export const DEFAULT_EPIC_API_CACHE = join(ROOT, "data", "api-catalog");

export interface EpicApiModuleSummary {
	scope: EngineApiScope;
	module: string;
	url: string;
}

export interface EpicApiRootCache {
	version: "5.8";
	source: string;
	synced_at: string;
	modules: EpicApiModuleSummary[];
}

export interface EpicApiSymbol {
	name: string;
	kind: string;
	remarks: string;
	url: string;
}

export interface EpicApiModuleCache {
	version: "5.8";
	scope: EngineApiScope;
	module: string;
	source: string;
	synced_at: string;
	metadata: Record<string, string>;
	symbols: EpicApiSymbol[];
}

export interface EpicApiBatchSyncResult {
	requested: number;
	succeeded: number;
	failed: { scope: EngineApiScope; module: string; error: string }[];
	/** 官方根目录未收录（Epic 未发布文档页）而被跳过的模块——不算失败，本地源码索引仍覆盖其 API */
	skipped_unpublished: { scope: EngineApiScope; module: string }[];
}

export interface EpicApiBatchSyncProgress {
	requested: number;
	completed: number;
	succeeded: number;
	failed: number;
	current?: { scope: EngineApiScope; module: string };
}

function decodeCodePoint(code: number): string {
	// 远端 HTML 完全可控：超出 Unicode 范围的实体（如 &#9999999999;）会让
	// fromCodePoint 抛 RangeError 击穿整次同步。
	return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\uFFFD";
}

function decodeHtml(value: string): string {
	return value
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => decodeCodePoint(parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_m, dec: string) => decodeCodePoint(parseInt(dec, 10)))
		.replace(/\s+/g, " ")
		.trim();
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

// DECISION: fetch 带指数退避重试（429/5xx/网络错误），批量同步时 Epic 站点会限流
// REASON: 实测批量 ~1800 模块时 Epic 对部分请求限流；更糟的是限流有时以 200 + 空壳页
//         形式返回（无表格无元数据），必须重试而非把空壳当成功缓存。
// DATE: 2026-07-19
async function fetchHtml(url: string, attempts = 4): Promise<string> {
	let lastError: Error | null = null;
	for (let attempt = 0; attempt < attempts; attempt++) {
		if (attempt > 0) await sleep(Math.min(1000 * 2 ** attempt, 10_000) + Math.random() * 500);
		let response: Response;
		try {
			response = await fetch(url, {
				headers: { "User-Agent": "GraphBrain-UE-API-Sync/1.0" },
				signal: AbortSignal.timeout(120_000),
			});
		} catch (reason) {
			lastError = reason as Error; // 网络错误 / 超时：退避后重试
			continue;
		}
		if (response.ok) return response.text();
		lastError = new Error(`Epic API 请求失败 ${response.status}: ${url}`);
		// 释放未消费的响应体：批量同步中残留的 429/5xx 体会让 socket 无法复用。
		await response.body?.cancel().catch(() => undefined);
		// 非 429 的 4xx 重试不会改变结果，立即失败；429/5xx 按 Retry-After 或退避重试
		if (response.status !== 429 && response.status < 500) throw lastError;
		if (attempt + 1 < attempts) {
			const retryAfter = Number(response.headers.get("retry-after"));
			if (Number.isFinite(retryAfter) && retryAfter > 0) await sleep(Math.min(retryAfter * 1000, 30_000));
		}
	}
	throw lastError ?? new Error(`Epic API 请求失败: ${url}`);
}

/**
 * 官方文档 URL 优先取根目录缓存：Epic 对超长模块名会截断 slug（尾缀 "-"），
 * 用本地模块名直接拼 URL 会命中 200 的空壳页而非 404。
 * 索引按 cacheDir 记忆，批量同步 ~1800 模块时避免反复读盘；根目录重同步后失效。
 */
const officialUrlIndexMemo = new Map<string, { exact: Map<string, string>; truncated: { scope: string; prefix: string; url: string }[] } | null>();

export function officialModuleUrl(scope: EngineApiScope, module: string, cacheDir = DEFAULT_EPIC_API_CACHE): string | null {
	let index = officialUrlIndexMemo.get(cacheDir);
	if (index === undefined || index === null) {
		const root = loadEpicApiRoot(cacheDir);
		index = root
			? {
				exact: new Map(root.modules.map((entry) => [`${entry.scope}:${entry.module.toLowerCase()}`, entry.url])),
				truncated: root.modules
					.filter((entry) => entry.module.endsWith("-"))
					.map((entry) => ({ scope: entry.scope, prefix: entry.module.slice(0, -1).toLowerCase(), url: entry.url })),
			}
			: null;
		// 缺失态（null）不长期记忆：根目录缓存随后出现（如另进程刚同步）时下次调用即可看到，
		// 只记忆已加载的索引；缺失时重查的代价只是一次失败的 readFile
		officialUrlIndexMemo.set(cacheDir, index);
	}
	if (!index) return null;
	const lower = module.toLowerCase();
	return index.exact.get(`${scope}:${lower}`)
		?? index.truncated.find((entry) => entry.scope === scope && lower.startsWith(entry.prefix))?.url
		?? null;
}

function writeJson(path: string, value: unknown) {
	mkdirSync(dirname(path), { recursive: true });
	// tmp+rename 原子写：不跟随 symlink，拒绝可预测路径的符号链接写穿。
	const destination = resolve(path);
	const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
	try {
		writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
		renameSync(temporary, destination);
	} finally {
		rmSync(temporary, { force: true });
	}
}

export function epicModuleCachePath(scope: string, module: string, cacheDir = DEFAULT_EPIC_API_CACHE): string {
	// module 名来自 URL 解码与 CLI 参数：净化后拼路径，杜绝 %2F 之类分隔符把缓存
	// 写到 modules/ 之外（与 engine-class-service 的类名净化同一策略）。
	const safeScope = scope.replace(/[^A-Za-z0-9_.-]/g, "_");
	const safeModule = module.replace(/[^A-Za-z0-9_.-]/g, "_");
	return join(cacheDir, "modules", `${safeScope}_${safeModule}.json`);
}

export async function syncEpicApiRoot(cacheDir = DEFAULT_EPIC_API_CACHE): Promise<EpicApiRootCache> {
	const html = await fetchHtml(DOCS_ROOT);
	const modules = new Map<string, EpicApiModuleSummary>();
	const linkRe = /href="(\/documentation\/(?:en-us\/)?unreal-engine\/API\/(Developer|Editor|Runtime|Plugins)\/([^/"?#]+))"/g;
	for (const match of html.matchAll(linkRe)) {
		const scope = match[2] as EngineApiScope;
		const module = decodeURIComponent(match[3]);
		modules.set(`${scope}:${module}`, { scope, module, url: `${DOCS_ORIGIN}${match[1]}` });
	}
	const cache: EpicApiRootCache = {
		version: "5.8",
		source: DOCS_ROOT,
		synced_at: new Date().toISOString(),
		modules: [...modules.values()].sort((a, b) => a.scope.localeCompare(b.scope) || a.module.localeCompare(b.module)),
	};
	writeJson(join(cacheDir, "ue5.8-root.json"), cache);
	officialUrlIndexMemo.delete(cacheDir);
	return cache;
}

export function parseEpicModulePage(html: string, scope: EngineApiScope, module: string, source: string): EpicApiModuleCache {
	const metadata: Record<string, string> = {};
	const metaTable = html.match(/<table[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>[\s\S]*?<\/table>/i)?.[1] ?? "";
	for (const row of metaTable.matchAll(/<tr>[\s\S]*?<td>([\s\S]*?)<\/td>[\s\S]*?<td>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi)) {
		const key = decodeHtml(row[1]);
		if (key) metadata[key] = decodeHtml(row[2]);
	}

	const symbols = new Map<string, EpicApiSymbol>();
	const sectionRe = /<h2[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2\b|<footer\b|$)/gi;
	for (const section of html.matchAll(sectionRe)) {
		const kind = decodeHtml(section[2]) || section[1];
		const body = section[3];
		const rowRe = /<tr>[\s\S]*?<td>[\s\S]*?<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/td>[\s\S]*?<td>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi;
		for (const row of body.matchAll(rowRe)) {
			const name = decodeHtml(row[2]);
			if (!name || name === "Name") continue;
			const href = row[1].startsWith("http") ? row[1] : `${DOCS_ORIGIN}${row[1]}`;
			symbols.set(`${kind}:${name}`, { name, kind, remarks: decodeHtml(row[3]), url: href });
		}
	}

	return {
		version: "5.8",
		scope,
		module,
		source,
		synced_at: new Date().toISOString(),
		metadata,
		symbols: [...symbols.values()],
	};
}

/** 空壳页判定：无符号表也无元数据表——Epic 对不存在的 slug 与限流响应都返回这种 200 页。 */
function isShellPage(cache: EpicApiModuleCache): boolean {
	return cache.symbols.length === 0 && Object.keys(cache.metadata).length === 0;
}

export async function syncEpicApiModule(
	scope: EngineApiScope,
	module: string,
	cacheDir = DEFAULT_EPIC_API_CACHE,
): Promise<EpicApiModuleCache> {
	// slug 以官方根目录为准（长模块名被 Epic 截断为 "...-"）；根目录未收录时回退直拼
	const source = officialModuleUrl(scope, module, cacheDir) ?? `${DOCS_ROOT}/${scope}/${encodeURIComponent(module)}`;
	let cache = parseEpicModulePage(await fetchHtml(source), scope, module, source);
	if (isShellPage(cache)) {
		// 空壳页可能是限流的软失败——退避后再试一次，仍为空壳才定性为无文档
		await sleep(3000 + Math.random() * 2000);
		cache = parseEpicModulePage(await fetchHtml(source), scope, module, source);
	}
	if (isShellPage(cache)) {
		throw new Error(`Epic 返回空壳页（该模块无文档页或持续被限流）：${source}`);
	}
	writeJson(epicModuleCachePath(scope, module, cacheDir), cache);
	return cache;
}

/**
 * 官方根目录已缓存且未收录该模块 → Epic 未发布其文档页（F28 实测 132 个全部如此）。
 * 批量同步（全量与增量）都应据此跳过，否则每轮全量同步都会重新产出同一批"失败"。
 * 根目录缓存缺失时返回 false（无法判定，不做排除），避免把全部模块误判为未发布。
 */
export function isModuleUnpublished(scope: EngineApiScope, module: string, cacheDir = DEFAULT_EPIC_API_CACHE): boolean {
	if (officialModuleUrl(scope, module, cacheDir) !== null) return false;
	// officialModuleUrl 已按 cacheDir 记忆根目录索引；索引为 null = 根目录缓存缺失 → 无法判定，不排除
	return officialUrlIndexMemo.get(cacheDir) != null;
}

/** 显式批量同步，使用小型并发池；单模块失败只进入汇总，不中断其余本地缓存写入。
 *  官方根目录未收录的模块在入队前剔除，记入 skipped_unpublished（不发请求、不算失败）。 */
export async function syncEpicApiModules(
	modules: EpicApiModuleSummary[],
	concurrency = 4,
	cacheDir = DEFAULT_EPIC_API_CACHE,
	onProgress?: (progress: EpicApiBatchSyncProgress) => void,
): Promise<EpicApiBatchSyncResult> {
	const deduped = [...new Map(modules.map((entry) => [`${entry.scope}:${entry.module}`, entry])).values()];
	const skipped: EpicApiBatchSyncResult["skipped_unpublished"] = [];
	const queue: EpicApiModuleSummary[] = [];
	for (const entry of deduped) {
		if (isModuleUnpublished(entry.scope, entry.module, cacheDir)) skipped.push({ scope: entry.scope, module: entry.module });
		else queue.push(entry);
	}
	const failed: EpicApiBatchSyncResult["failed"] = [];
	let cursor = 0;
	let succeeded = 0;
	let completed = 0;
	onProgress?.({ requested: queue.length, completed, succeeded, failed: failed.length });
	const worker = async () => {
		while (cursor < queue.length) {
			const entry = queue[cursor++];
			onProgress?.({ requested: queue.length, completed, succeeded, failed: failed.length, current: entry });
			try {
				await syncEpicApiModule(entry.scope, entry.module, cacheDir);
				succeeded++;
			} catch (reason) {
				failed.push({
					scope: entry.scope,
					module: entry.module,
					error: String((reason as Error).message ?? reason),
				});
			} finally {
				completed++;
				onProgress?.({ requested: queue.length, completed, succeeded, failed: failed.length, current: entry });
			}
		}
	};
	if (queue.length > 0) {
		await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), queue.length) }, worker));
	}
	const result: EpicApiBatchSyncResult = { requested: queue.length, succeeded, failed, skipped_unpublished: skipped };
	// 失败清单落盘：增量补同步（missing_only）与重启后的排查都依赖它
	writeJson(join(cacheDir, "sync-report.json"), {
		finished_at: new Date().toISOString(),
		...result,
	});
	return result;
}

/** 增量补同步的目标判定：本地无缓存，或缓存是历史遗留的空壳（0 符号且 0 元数据）。 */
export function isModuleCacheMissingOrShell(scope: string, module: string, cacheDir = DEFAULT_EPIC_API_CACHE): boolean {
	const cache = loadEpicApiModule(scope, module, cacheDir);
	return !cache || (cache.symbols.length === 0 && Object.keys(cache.metadata).length === 0);
}

export function loadEpicApiRoot(cacheDir = DEFAULT_EPIC_API_CACHE): EpicApiRootCache | null {
	try {
		const value = JSON.parse(readFileSync(join(cacheDir, "ue5.8-root.json"), "utf8")) as Partial<EpicApiRootCache>;
		// 形状校验：合法 JSON 但结构错误（{} / []）的缓存会在消费方炸出 TypeError，
		// 把每个目录请求都变成 500；按缺失处理走重建路径。
		if (typeof value.version !== "string" || !Array.isArray(value.modules)) return null;
		return value as EpicApiRootCache;
	} catch {
		return null;
	}
}

export function loadEpicApiModule(
	scope: string,
	module: string,
	cacheDir = DEFAULT_EPIC_API_CACHE,
): EpicApiModuleCache | null {
	try {
		const value = JSON.parse(readFileSync(epicModuleCachePath(scope, module, cacheDir), "utf8")) as Partial<EpicApiModuleCache>;
		if (typeof value.version !== "string" || typeof value.scope !== "string" || typeof value.module !== "string"
			|| !Array.isArray(value.symbols) || !value.metadata || typeof value.metadata !== "object") return null;
		return value as EpicApiModuleCache;
	} catch {
		return null;
	}
}

/** Exact-name lookup over the versioned local Epic cache; no network and no fuzzy ID mapping. */
export function resolveCachedEpicApiSymbols(
	names: readonly string[],
	cacheDir = DEFAULT_EPIC_API_CACHE,
): Map<string, { version: string; scope: EngineApiScope; module: string; kind: string; url: string }> {
	const wanted = new Set(names);
	const found = new Map<string, { version: string; scope: EngineApiScope; module: string; kind: string; url: string }>();
	const root = loadEpicApiRoot(cacheDir);
	if (!root) return found;
	for (const summary of root.modules) {
		if (found.size === wanted.size) break;
		const module = loadEpicApiModule(summary.scope, summary.module, cacheDir);
		if (!module || module.version !== root.version) continue;
		for (const symbol of module.symbols) {
			if (!wanted.has(symbol.name) || found.has(symbol.name)) continue;
			found.set(symbol.name, { version: root.version, scope: module.scope, module: module.module, kind: symbol.kind, url: symbol.url });
		}
	}
	return found;
}

async function main() {
	const args = process.argv.slice(2);
	const value = (name: string) => {
		const i = args.indexOf(name);
		return i >= 0 ? args[i + 1] : undefined;
	};
	const scopeArg = value("--scope");
	if (scopeArg !== undefined && !["Developer", "Editor", "Runtime", "Plugins"].includes(scopeArg)) {
		throw new Error(`--scope 必须是 Developer/Editor/Runtime/Plugins 之一，收到: ${scopeArg}`);
	}
	const scope = scopeArg as EngineApiScope | undefined;
	const modules = args.filter((_, i) => args[i - 1] === "--module" && args[i] !== undefined);
	const root = await syncEpicApiRoot();
	console.log(`Epic UE ${root.version} API 根目录：${root.modules.length} 个模块`);
	if (scope && modules.length > 0) {
		for (const module of modules) {
			const cache = await syncEpicApiModule(scope, module);
			console.log(`${scope}/${module}: ${cache.symbols.length} 个 API 符号`);
		}
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
