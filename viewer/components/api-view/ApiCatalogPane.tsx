// Graph Brain / viewer - API Reference View 左侧导航列（ApiReferenceView 拆出）。
// 三源 tab + 模块/类树 + 引擎 API 目录（汇总/筛选/同步/搜索结果）。
// 全部为受控 props；状态与数据派生仍归 ApiReferenceView 本体。
import SearchHighlight from "./SearchHighlight";
import EngineCatalogTree from "../common/EngineCatalogTree";
import type { EngineCatalogState } from "../../src/useEngineCatalog";
import {
	ALL_CATALOG_FILTER,
	type ApiClassFavorite,
	type CatalogSyncStatus,
	type EngineCatalogClass,
	type EngineClassInfo,
	type Source,
} from "./apiTypes";

interface Props {
	width: number;
	source: Source;
	onApplySourceFilter: (nextSource: Source) => void;
	navQuery: string;
	/** 导航搜索输入：设置 navQuery；非引擎源输入时仅切 source="all"（不触发 applySourceFilter 的清空） */
	onNavSearch: (value: string) => void;
	catalogSearchCurrent: boolean;
	onCatalogSearchCurrentChange: (value: boolean) => void;
	navTree: Map<string, Map<string, number>>;
	collapsedMods: Set<string>;
	onToggleModule: (mod: string) => void;
	classFilter: string | null;
	onSelectProjectClass: (cls: string | null) => void;
	isClassFavorite: (favoriteSource: ApiClassFavorite["source"], name: string) => boolean;
	onToggleClassFavorite: (favorite: ApiClassFavorite) => void;
	engineCatalog: EngineCatalogState;
	catalogSyncBusy: boolean;
	catalogSyncStatus: CatalogSyncStatus | null;
	onSyncCatalog: (missingOnly?: boolean) => void;
	catalogError: string | null;
	catalogSearching: boolean;
	catalogTotal: number;
	catalogDisplayClasses: EngineCatalogClass[];
	catalogParsed: Set<string>;
	catalogParsing: Set<string>;
	engineClasses: EngineClassInfo[];
	onSelectCatalogClass: (entry: EngineCatalogClass) => void;
	onHome: () => void;
}

export default function ApiCatalogPane({
	width, source, onApplySourceFilter, navQuery, onNavSearch, catalogSearchCurrent,
	onCatalogSearchCurrentChange, navTree, collapsedMods, onToggleModule, classFilter,
	onSelectProjectClass, isClassFavorite, onToggleClassFavorite, engineCatalog,
	catalogSyncBusy, catalogSyncStatus, onSyncCatalog, catalogError, catalogSearching, catalogTotal,
	catalogDisplayClasses, catalogParsed, catalogParsing, engineClasses, onSelectCatalogClass, onHome,
}: Props) {
	const catalog = engineCatalog.catalog;
	const catalogModule = engineCatalog.selectedModuleName;
	return (
		<nav className="api-nav" style={{ width }}>
			<div className="api-nav-caption">
				<span>{source === "all" ? "全部代码 · API" : source === "engine" ? "引擎源码 · API" : "项目代码 · API"}</span>
				<button type="button" className="api-nav-home" onClick={onHome} title="返回 API 搜索首页" aria-label="返回 API 搜索首页">⌕</button>
			</div>
			<div className="api-nav-search-wrap">
				<span aria-hidden="true">⌕</span>
				<input
					value={navQuery}
					onChange={(e) => onNavSearch(e.target.value)}
					aria-label={source === "engine" ? "搜索引擎类" : "搜索模块或类"}
					placeholder={source === "engine" ? "搜索引擎类…" : "搜索模块或类…"}
				/>
				{navQuery ? <button type="button" className="api-nav-search-clear" aria-label="清除模块或类搜索" onClick={() => onNavSearch("")}>×</button> : null}
			</div>
			{navQuery.trim() ? (
				<label className="api-search-scope">
					<input
						type="checkbox"
						checked={catalogSearchCurrent}
						onChange={(event) => onCatalogSearchCurrentChange(event.target.checked)}
					/>
					<span>{catalogSearchCurrent ? "只搜索当前用途 / 模块" : "全局搜索全部用途与模块"}</span>
				</label>
			) : null}
			{source !== "engine" ? <>
			<div className="api-nav-section-head">项目 API</div>
			{[...navTree.entries()]
						.filter(([mod, classes]) => {
							const q = navQuery.trim().toLowerCase();
							return !q || mod.toLowerCase().includes(q) || [...classes.keys()].some((cls) => cls.toLowerCase().includes(q));
						})
						.sort(([a], [b]) => a.localeCompare(b)).map(([mod, classes]) => (
						<div key={mod} className="api-nav-module">
							<button
								type="button"
								className={`api-nav-mod-head${source === "project" && classFilter === null ? " active" : ""}`}
								aria-expanded={!collapsedMods.has(mod)}
								onClick={() => onToggleModule(mod)}
							>
								{collapsedMods.has(mod) ? "▸" : "▾"} {mod}
							</button>
							{!collapsedMods.has(mod)
								? [...classes.entries()]
									.filter(([cls]) => !navQuery.trim() || cls.toLowerCase().includes(navQuery.trim().toLowerCase()) || mod.toLowerCase().includes(navQuery.trim().toLowerCase()))
									.sort(([a], [b]) => a.localeCompare(b)).map(([cls, count]) => (
									<div className="api-nav-favorite-row" key={cls}>
										<button
											type="button"
											className={`api-nav-class${classFilter === cls ? " active" : ""}`}
											aria-pressed={classFilter === cls}
										onClick={() => onSelectProjectClass(classFilter === cls ? null : cls)}
										>
											{cls} <span className="api-count">{count}</span>
										</button>
										<button
											type="button"
											className={`api-nav-star${isClassFavorite("project", cls) ? " active" : ""}`}
											title={isClassFavorite("project", cls) ? "从快速入口移除" : "加入快速入口"}
											aria-label={`${isClassFavorite("project", cls) ? "从快速入口移除" : "加入快速入口"}：${cls}`}
											aria-pressed={isClassFavorite("project", cls)}
											onClick={() => onToggleClassFavorite({ name: cls, source: "project", module: mod })}
										>{isClassFavorite("project", cls) ? "★" : "☆"}</button>
									</div>
								))
								: null}
						</div>
					))}
			</> : null}

			{source !== "project" ? <>
			<div className="api-nav-section-head"><span>引擎源码与 API</span></div>
			<div className="api-catalog-summary">
				<div><strong>{catalog?.totals.modules.toLocaleString() ?? "—"}</strong><span>模块</span></div>
				<div><strong>{catalog?.totals.headers.toLocaleString() ?? "—"}</strong><span>公开头文件</span></div>
				<div className={catalog?.official_cache?.synced ? "synced" : ""}><strong>{catalog?.official_cache?.modules.toLocaleString() ?? "0"}</strong><span>官方目录</span></div>
			</div>
			<EngineCatalogTree state={engineCatalog} compact ariaLabel="引擎 API 共用源码目录" onSelectModule={() => onApplySourceFilter("engine")} />
			<details className="api-catalog-maintenance">
				<summary>目录维护与官方资料同步</summary>
				<div className="api-catalog-controls">
					<button type="button" disabled={catalogSyncBusy || !catalog} onClick={() => onSyncCatalog(false)} title="同步当前源码树所选范围">{catalogSyncBusy ? `同步 ${catalogSyncStatus?.completed ?? 0}/${catalogSyncStatus?.requested ?? "…"}` : "同步当前范围"}</button>
					<button type="button" disabled={catalogSyncBusy || !catalog} onClick={() => onSyncCatalog(true)}>补同步缺失</button>
				</div>
			</details>
			{catalogSyncStatus ? (
				<div className={`api-catalog-sync-status state-${catalogSyncStatus.state}`} role="status" aria-live="polite">
					<div>
						<strong>{catalogSyncStatus.state === "completed" ? "同步完成" : catalogSyncStatus.state === "failed" ? "同步失败" : "正在同步到本地"}</strong>
						<span>{catalogSyncStatus.completed}/{catalogSyncStatus.requested}</span>
					</div>
					<progress max={Math.max(1, catalogSyncStatus.requested)} value={catalogSyncStatus.completed} />
					<small>成功 {catalogSyncStatus.succeeded} · 失败 {catalogSyncStatus.failed_count}{catalogSyncStatus.current ? ` · 当前 ${catalogSyncStatus.current.scope}/${catalogSyncStatus.current.module}` : ""}</small>
					{catalogSyncStatus.failed && catalogSyncStatus.failed.length > 0 ? (
						<details><summary>查看 {catalogSyncStatus.failed.length} 个失败模块</summary>{catalogSyncStatus.failed.map((failure) => <p key={`${failure.scope}:${failure.module}`}><b>{failure.scope}/{failure.module}</b><span>{failure.error}</span></p>)}</details>
					) : null}
				</div>
			) : null}
			{catalogError ? <div className="api-catalog-error" role="alert">{catalogError}</div> : null}
			<div className="api-catalog-result-head">
				<span>{catalogSearching ? "全局匹配结果" : catalogModule === ALL_CATALOG_FILTER ? "全部引擎 API" : catalogModule}</span><b>{catalogTotal.toLocaleString()}</b>
			</div>
			<div className="api-catalog-results">
				{catalogDisplayClasses.map((entry, index) => {
					const parsed = catalogParsed.has(entry.name) || engineClasses.some((item) => item.name === entry.name && item.parsed);
					const parsing = catalogParsing.has(entry.name);
					return (
						<div key={`${entry.scope}:${entry.module}:${entry.name}`} className="api-catalog-search-entry">
							{catalogSearching && catalogDisplayClasses[index - 1]?.scope !== entry.scope ? (
								<div className="api-catalog-group-head">
									<strong>{entry.scope}</strong>
									<span>{catalogDisplayClasses.filter((item) => item.scope === entry.scope).length}</span>
								</div>
							) : null}
							<div className={`api-catalog-class${source === "engine" && classFilter === entry.name ? " active" : ""}${entry.available_in_source ? "" : " official-only"}`}>
							<button
								type="button"
								disabled={parsing}
								onClick={() => onSelectCatalogClass(entry)}
								title={`${entry.name} — ${parsing ? "本地解析中…" : parsed ? "本地已缓存" : entry.parseable ? "本地可解析" : entry.available_in_source ? "源码声明" : "官方文档"}${entry.available_in_source ? (entry.remarks ? ` · ${entry.remarks}` : entry.source_path ? ` · ${entry.source_path}` : "") : " · 本机源码未定位，仍可查看官方目录内容"}`}
							>
								<span className={`api-kind api-kind-${entry.kind}`}>{entry.kind === "class" ? "C" : entry.kind === "struct" ? "S" : "E"}</span>
								<span className="api-catalog-name"><SearchHighlight text={entry.name} query={navQuery} /></span>
								<i className={`api-parse-dot${parsing ? " parsing" : parsed ? " parsed" : entry.parseable ? " parseable" : entry.available_in_source ? " source" : " official"}`} />
							</button>
							<button
								type="button"
								className={`api-catalog-star${isClassFavorite("engine", entry.name) ? " active" : ""}`}
								title={isClassFavorite("engine", entry.name) ? "从快速入口移除" : "加入快速入口"}
								aria-label={`${isClassFavorite("engine", entry.name) ? "从快速入口移除" : "加入快速入口"}：${entry.name}`}
								aria-pressed={isClassFavorite("engine", entry.name)}
								onClick={() => onToggleClassFavorite({ name: entry.name, source: "engine", module: entry.module, sourcePath: entry.source_path })}
							>{isClassFavorite("engine", entry.name) ? "★" : "☆"}</button>
							{/* docs_url 已在目录边界做过 http(s) 归一化；空值时不渲染外链（空 href 会指向当前页）。 */}
							{entry.docs_url ? <a href={entry.docs_url} target="_blank" rel="noreferrer" title="Epic UE 5.8 官方 API" aria-label={`在新窗口打开 ${entry.name} 的 Epic UE 5.8 官方 API`}>↗</a> : null}
							</div>
						</div>
					);
				})}
			</div>
			</> : null}

		</nav>
	);
}
