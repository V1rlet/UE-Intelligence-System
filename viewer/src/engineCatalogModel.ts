export const ENGINE_SCOPES = ["Runtime", "Developer", "Editor", "Plugins"] as const;
export type EngineScope = (typeof ENGINE_SCOPES)[number];
export const ALL_ENGINE_CATALOG = "all" as const;

export interface EngineCatalogModule {
	name: string;
	scope: EngineScope;
	header_count: number;
	docs_url?: string;
}

export interface EngineCatalog {
	engine_version: string;
	docs_version?: string;
	docs_root?: string;
	modules: EngineCatalogModule[];
	totals: { modules: number; headers: number };
	official_cache?: { synced: boolean; modules: number; synced_at?: string };
}

export interface EngineCatalogClass {
	name: string;
	kind: "class" | "struct" | "enum";
	scope: EngineScope;
	module: string;
	source_path: string;
	docs_url: string;
	remarks?: string;
	official_kind?: string;
	available_in_source: boolean;
	parseable: boolean;
}

export interface CatalogSyncStatus {
	job_id?: string;
	state: "queued" | "running" | "completed" | "failed";
	requested: number;
	completed: number;
	succeeded: number;
	failed_count: number;
	failed?: { scope: string; module: string; error: string }[];
	skipped_unpublished?: number;
	current?: { scope: string; module: string };
	started_at: string;
	finished_at?: string;
	error?: string;
}

/** docs_url 的单一收口：目录数据来自外部同步管线（Epic 目录 → 本地缓存 → 客户端），
 *  不得直接信任为 href——只接受 http(s) 绝对地址，其余（javascript:/data:/相对路径）丢弃。 */
export function safeDocsUrl(url: string | null | undefined): string | undefined {
	if (typeof url !== "string" || !url) return undefined;
	try {
		const { protocol } = new URL(url);
		return protocol === "http:" || protocol === "https:" ? url : undefined;
	} catch {
		return undefined;
	}
}

export function normalizeEngineCatalogClasses(entries: EngineCatalogClass[]): EngineCatalogClass[] {
	return entries.map((entry) => ({ ...entry, docs_url: safeDocsUrl(entry.docs_url) ?? "" }));
}

