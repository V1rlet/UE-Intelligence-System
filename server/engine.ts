// Graph Brain / server - 引擎 API 路由族：本地目录 / 类检索 / Epic 官方内容同步 / 按需类解析
// 同步任务在内存任务表跟踪（202 + 轮询 /sync/status）；未发布文档的模块统一跳过（F29）。

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getEngineApiCatalog, searchEngineApiClasses } from "../adapters/ue5-code/engine-api-catalog";
import {
	DEFAULT_EPIC_API_CACHE,
	isModuleCacheMissingOrShell,
	loadEpicApiRoot,
	officialModuleUrl,
	syncEpicApiModule,
	syncEpicApiModules,
} from "../adapters/ue5-code/epic-api-sync";
import { resolveEngineClassElements, resolveEngineRoot } from "../adapters/ue5-code/engine-class-service";
import { type ApiHandler, methodNotAllowed, readJsonBody, searchParamsOf, sendJson } from "./http";

interface EpicSyncJobStatus {
	job_id: string;
	state: "queued" | "running" | "completed" | "failed";
	scope: string;
	module: string;
	requested: number;
	completed: number;
	succeeded: number;
	failed_count: number;
	failed: { scope: string; module: string; error: string }[];
	/** 官方根目录未收录（Epic 未发布文档页）被跳过的模块数——不算失败 */
	skipped_unpublished?: number;
	current?: { scope: string; module: string };
	started_at: string;
	finished_at?: string;
	error?: string;
}

const epicSyncJobs = new Map<string, EpicSyncJobStatus>();

class QueryParameterError extends Error {}

function integerQuery(
	params: URLSearchParams,
	name: string,
	bounds: { min: number; max: number },
): number | undefined {
	const raw = params.get(name);
	if (raw === null) return undefined;
	if (!/^\d+$/.test(raw)) throw new QueryParameterError(`${name} 必须是整数`);
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < bounds.min || value > bounds.max) {
		throw new QueryParameterError(`${name} 必须在 ${bounds.min}–${bounds.max} 之间`);
	}
	return value;
}

function createEpicSyncJobId(): string {
	return `epic-sync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 官方内容缓存健康摘要（P2b）：根目录龄期 + 模块缓存规模与最旧同步时间。 */
function officialCacheHealth(): Record<string, unknown> {
	const root = loadEpicApiRoot();
	const modulesDir = join(DEFAULT_EPIC_API_CACHE, "modules");
	let cachedModules = 0;
	let oldestMtime = 0;
	let newestMtime = 0;
	try {
		for (const file of readdirSync(modulesDir)) {
			if (!file.endsWith(".json")) continue;
			cachedModules++;
			const mtime = statSync(join(modulesDir, file)).mtimeMs;
			if (!oldestMtime || mtime < oldestMtime) oldestMtime = mtime;
			if (mtime > newestMtime) newestMtime = mtime;
		}
	} catch { /* 缓存目录不存在 = 0 */ }
	return {
		root_synced_at: root?.synced_at ?? null,
		root_modules: root?.modules.length ?? 0,
		cached_modules: cachedModules,
		oldest_cached_at: oldestMtime ? new Date(oldestMtime).toISOString() : null,
		newest_cached_at: newestMtime ? new Date(newestMtime).toISOString() : null,
	};
}

/**
 * 引擎目录响应组装：official_cache 是既有契约（{synced, modules}，UI 直接
 * `modules.toLocaleString()` 渲染）——健康摘要必须挂独立键 official_cache_health；
 * F30 曾把它覆盖成新形状导致 API 视图渲染崩溃（"API查询中的内容打不开"）。
 */
export function engineCatalogPayload<T extends { official_cache: unknown }>(catalog: T): T & { official_cache_health: Record<string, unknown> } {
	return { ...catalog, official_cache_health: officialCacheHealth() };
}

export const handleEngineCatalog: ApiHandler = ({ req, res, url }) => {
	if (url !== "/api/engine-catalog") return false;
	if (req.method !== "GET") {
		methodNotAllowed(res);
		return true;
	}
	const params = searchParamsOf(req);
	const engineRoot = resolveEngineRoot(params.get("source_root")?.split(";")[0] ?? undefined);
	if (!engineRoot) {
		sendJson(res, 500, { error: "未定位到 UE 5.8 引擎根目录" });
		return true;
	}
	try {
		sendJson(res, 200, engineCatalogPayload(getEngineApiCatalog(engineRoot)));
	} catch (e) {
		sendJson(res, 500, { error: (e as Error).message });
	}
	return true;
};

export const handleEngineCatalogClasses: ApiHandler = ({ req, res, url }) => {
	if (url !== "/api/engine-catalog/classes") return false;
	if (req.method !== "GET") {
		methodNotAllowed(res);
		return true;
	}
	const params = searchParamsOf(req);
	try {
		const limit = integerQuery(params, "limit", { min: 1, max: 1000 });
		const headerOffset = integerQuery(params, "header_offset", { min: 0, max: Number.MAX_SAFE_INTEGER });
		const headerLimit = integerQuery(params, "header_limit", { min: 1, max: 64 });
		if (headerLimit !== undefined && (!params.get("scope") || !params.get("module"))) {
			throw new QueryParameterError("分页源码解析必须先指定 scope 与 module");
		}
		const engineRoot = resolveEngineRoot(params.get("source_root")?.split(";")[0] ?? undefined);
		if (!engineRoot) {
			sendJson(res, 500, { error: "未定位到 UE 5.8 引擎根目录" });
			return true;
		}
		sendJson(res, 200, searchEngineApiClasses(engineRoot, {
			query: params.get("q") ?? undefined,
			scope: params.get("scope") ?? undefined,
			module: params.get("module") ?? undefined,
			limit,
			headerOffset,
			headerLimit,
		}));
	} catch (e) {
		sendJson(res, e instanceof QueryParameterError ? 400 : 500, { error: (e as Error).message });
	}
	return true;
};

export const handleEngineCatalogSync: ApiHandler = async ({ req, res, url }) => {
	if (url !== "/api/engine-catalog/sync") return false;
	if (req.method !== "POST") {
		methodNotAllowed(res, "POST");
		return true;
	}
	try {
		const body = await readJsonBody(req);
		const scope = String(body.scope ?? "all");
		const module = String(body.module ?? "all");
		// 白名单校验：scope/module 会流入 URL 与文件路径，非法值直接拒绝（防止
		// URL 路径注入与缓存目录外写）。
		const ENGINE_SCOPES = ["Runtime", "Developer", "Editor", "Plugins"];
		if (scope !== "all" && !ENGINE_SCOPES.includes(scope)) {
			sendJson(res, 400, { error: `非法 scope: ${scope}` });
			return true;
		}
		if (module !== "all" && !/^[A-Za-z0-9_.-]+$/.test(module)) {
			sendJson(res, 400, { error: `非法 module 名: ${module}` });
			return true;
		}
		// 增量补同步：只处理本地缺缓存或缓存为历史空壳（0 符号 0 元数据）的模块。
		// 官方根目录未收录的模块没有文档页（实测 132 个全部如此）——增量在此过滤，
		// 全量路径由 syncEpicApiModules 统一剔除并计入 skipped_unpublished（不再每轮
		// 全量同步重新产出同一批 132 个"失败"）；这些模块的 API 符号本来就来自本地
		// 源码索引，Epic 后补文档后重同步根目录即可自动解锁
		const missingOnly = body.missing_only === true;
		if (scope === "all" || module === "all") {
			const engineRoot = resolveEngineRoot(String(body.source_root ?? "").split(";")[0] || undefined);
			if (!engineRoot) throw new Error("未定位到 UE 5.8 引擎根目录");
			const targets = getEngineApiCatalog(engineRoot).modules
				.filter((entry) => scope === "all" || entry.scope === scope)
				.filter((entry) => module === "all" || entry.name === module)
				.filter((entry) => !missingOnly || (
					isModuleCacheMissingOrShell(entry.scope, entry.name)
					&& officialModuleUrl(entry.scope, entry.name) !== null
				))
				.map((entry) => ({ scope: entry.scope, module: entry.name, url: entry.docs_url }));
			const job: EpicSyncJobStatus = {
				job_id: createEpicSyncJobId(),
				state: "queued",
				scope,
				module,
				requested: targets.length,
				completed: 0,
				succeeded: 0,
				failed_count: 0,
				failed: [],
				started_at: new Date().toISOString(),
			};
			epicSyncJobs.set(job.job_id, job);
			for (const [id, oldJob] of epicSyncJobs) {
				if (id !== job.job_id && Date.now() - Date.parse(oldJob.started_at) > 6 * 60 * 60 * 1000) epicSyncJobs.delete(id);
			}
			job.state = "running";
			// 并发 3：4 并发全量同步时 Epic 限流明显（200 空壳页/连接失败），3 更稳
			void syncEpicApiModules(targets, 3, undefined, (progress) => {
				job.requested = progress.requested;
				job.completed = progress.completed;
				job.succeeded = progress.succeeded;
				job.failed_count = progress.failed;
				job.current = progress.current;
			}).then((batchResult) => {
				job.state = "completed";
				job.completed = batchResult.requested;
				job.succeeded = batchResult.succeeded;
				job.failed = batchResult.failed;
				job.failed_count = batchResult.failed.length;
				job.skipped_unpublished = batchResult.skipped_unpublished.length;
				job.current = undefined;
				job.finished_at = new Date().toISOString();
			}).catch((error) => {
				job.state = "failed";
				job.error = String((error as Error).message ?? error);
				job.current = undefined;
				job.finished_at = new Date().toISOString();
			});
			sendJson(res, 202, job);
			return true;
		}
		const result = await syncEpicApiModule(scope as "Runtime" | "Developer" | "Editor" | "Plugins", module);
		sendJson(res, 200, result);
	} catch (e) {
		sendJson(res, 500, { error: (e as Error).message });
	}
	return true;
};

export const handleEngineCatalogSyncStatus: ApiHandler = ({ req, res, url }) => {
	if (url !== "/api/engine-catalog/sync/status") return false;
	if (req.method !== "GET") {
		methodNotAllowed(res);
		return true;
	}
	const jobId = searchParamsOf(req).get("job_id") ?? "";
	const job = epicSyncJobs.get(jobId);
	if (!job) sendJson(res, 404, { error: "同步任务不存在或状态已过期" });
	else sendJson(res, 200, job);
	return true;
};

/** 按需引擎类解析（P3U1）：?source_root= 用当前图的项目 Source 推导引擎根 */
export const handleEngineClass: ApiHandler = ({ req, res, url }) => {
	const engMatch = url.match(/^\/api\/engine-class\/(\w+)$/);
	if (!engMatch) return false;
	if (req.method !== "GET") {
		methodNotAllowed(res);
		return true;
	}
	const params = searchParamsOf(req);
	const engineRoot = resolveEngineRoot(params.get("source_root")?.split(";")[0] ?? undefined);
	if (!engineRoot) {
		sendJson(res, 500, { error: "未定位到引擎根目录（可设 GRAPH_BRAIN_ENGINE_ROOT 环境变量）" });
		return true;
	}
	try {
		const result = resolveEngineClassElements(
			engMatch[1],
			engineRoot,
			params.get("source_path") ?? undefined,
		);
		sendJson(res, "error" in result ? 404 : 200, result);
	} catch (e) {
		sendJson(res, 500, { error: (e as Error).message });
	}
	return true;
};

export const engineHandlers: ApiHandler[] = [
	handleEngineCatalog,
	handleEngineCatalogClasses,
	handleEngineCatalogSync,
	handleEngineCatalogSyncStatus,
	handleEngineClass,
];
