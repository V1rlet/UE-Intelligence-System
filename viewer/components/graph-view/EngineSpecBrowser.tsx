import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CODE_QUICK_GROUPS } from "../../src/codeQuickEntries";
import AppIcon from "../common/AppIcon";
import EngineCatalogTree from "../common/EngineCatalogTree";
import { apiFetchJson } from "../../src/apiFetch";
import type { EngineCatalogClass, EngineCatalogModule } from "../../src/engineCatalogModel";
import { LatestRequestGate } from "../../src/latestRequest";
import type { EngineCatalogState } from "../../src/useEngineCatalog";

interface PageResult {
	results?: EngineCatalogClass[];
	next_header_offset?: number;
	has_more_headers?: boolean;
	total_headers?: number;
}

interface Props {
	busy: boolean;
	catalogState: EngineCatalogState;
	sourceRoot?: string;
	onOpenClass: (name: string, sourcePath?: string) => void | Promise<void>;
}

const PAGE_HEADERS = 32;

export default function EngineSpecBrowser({ busy, catalogState, sourceRoot, onOpenClass }: Props) {
	const { catalog, selectedModule, selectedClass } = catalogState;
	const [symbolQuery, setSymbolQuery] = useState("");
	const [results, setResults] = useState<EngineCatalogClass[]>([]);
	const [nextOffset, setNextOffset] = useState(0);
	const [hasMore, setHasMore] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const requestGate = useRef(new LatestRequestGate());

	const fetchPage = useCallback(async (module: EngineCatalogModule, offset: number, replace: boolean) => {
		const controller = requestGate.current.start();
		setLoading(true);
		setError(null);
		try {
			const params = new URLSearchParams({
				scope: module.scope,
				module: module.name,
				header_offset: String(offset),
				header_limit: String(PAGE_HEADERS),
				limit: "600",
			});
			if (sourceRoot) params.set("source_root", sourceRoot);
			const body = await apiFetchJson<PageResult>(`/api/engine-catalog/classes?${params}`, { signal: controller.signal }, { notify: false, context: "引擎 API 类" });
			if (!requestGate.current.isCurrent(controller)) return;
			setResults((current) => {
				const merged = new Map((replace ? [] : current).map((item) => [item.name, item]));
				for (const item of body.results ?? []) merged.set(item.name, item);
				return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
			});
			setNextOffset(body.next_header_offset ?? offset + PAGE_HEADERS);
			setHasMore(Boolean(body.has_more_headers));
		} catch (reason) {
			if ((reason as Error).name !== "AbortError" && requestGate.current.isCurrent(controller)) {
				setError(String((reason as Error).message ?? reason));
			}
		} finally {
			if (requestGate.current.finish(controller)) setLoading(false);
		}
	}, [sourceRoot]);

	useEffect(() => {
		setResults([]);
		setNextOffset(0);
		setHasMore(false);
		setError(null);
		if (selectedModule) void fetchPage(selectedModule, 0, true);
		else {
			requestGate.current.cancel();
			setLoading(false);
		}
		return () => requestGate.current.cancel();
	}, [fetchPage, selectedModule]);

	const visibleResults = useMemo(() => {
		const query = symbolQuery.trim().toLowerCase();
		const selectedInModule = selectedClass && selectedModule && selectedClass.scope === selectedModule.scope && selectedClass.module === selectedModule.name
			? selectedClass
			: null;
		const merged = selectedInModule && !results.some((item) => item.name === selectedInModule.name)
			? [selectedInModule, ...results]
			: results;
		return query ? merged.filter((item) => item.name.toLowerCase().includes(query)) : merged;
	}, [results, selectedClass, selectedModule, symbolQuery]);

	return (
		<section className="engine-spec-browser" aria-label="引擎层事实索引" aria-busy={loading || busy}>
			<header className="engine-spec-head">
				<div><span>UE {catalog?.engine_version ?? "5.8"} · 引擎源码索引</span><h2>引擎类与函数资料</h2><p>从架构脑图定位后按需读取源码；每次只解析所选模块的一批头文件，避免一次加载全部引擎类。</p></div>
				<label className="engine-spec-search"><AppIcon name="compass" size={17} /><input value={symbolQuery} onChange={(event) => setSymbolQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && symbolQuery.trim()) void onOpenClass(symbolQuery.trim()); }} placeholder="输入完整类名并回车，如 ACharacter" /></label>
			</header>

			<div className="engine-spec-load-policy" role="note"><b>按需读取</b><span>{catalog ? `${catalog.totals.modules} 模块 · ${catalog.totals.headers} 头文件可达` : "正在读取源码目录…"}</span><small>当前仅解析所选模块的 {PAGE_HEADERS} 个头文件；继续加载由你触发。</small></div>

			<div className="engine-spec-body">
				<EngineCatalogTree state={catalogState} ariaLabel="UE 5.8 源码森林" />

				<main className="engine-symbol-stage">
					{!selectedModule ? <div className="engine-spec-empty"><AppIcon name="library" size={28} /><b>从左侧选择模块</b><span>先选择模块，再分批读取类和函数声明；也可以在上方输入完整类名直接打开详情。</span></div> : <>
						<header><div><nav className="engine-symbol-breadcrumb" aria-label="当前引擎源码层级"><span>Engine Source</span><i>/</i><span>{selectedModule.scope}</span><i>/</i></nav><h3>{selectedModule.name}</h3></div><small>已读 {Math.min(nextOffset, selectedModule.header_count)} / {selectedModule.header_count} 个头文件 · {results.length} 个声明</small></header>
						<div className="engine-symbol-grid">{visibleResults.map((entry) => <button type="button" className={`engine-symbol-card kind-${entry.kind}${selectedClass?.name === entry.name && selectedClass.module === entry.module ? " active" : ""}`} key={`${entry.module}:${entry.name}`} disabled={busy || !entry.available_in_source} onClick={() => { catalogState.selectClass(entry); void onOpenClass(entry.name, entry.source_path); }} title={entry.available_in_source ? entry.source_path : "官方目录中存在，但本机引擎源码中未找到声明"}><span className="engine-spec-kind">{entry.kind}</span><b>{entry.name}</b><small>{entry.available_in_source ? entry.source_path : "官方目录 · 本机无源码"}</small>{entry.available_in_source ? <AppIcon name="arrow" size={14} /> : null}</button>)}</div>
						{!loading && visibleResults.length === 0 ? <div className="engine-spec-state">当前已加载批次中没有匹配声明。</div> : null}
						{hasMore ? <button type="button" className="engine-load-more" disabled={loading} onClick={() => void fetchPage(selectedModule, nextOffset, false)}>{loading ? "正在读取…" : `继续读取下一批 ${PAGE_HEADERS} 个头文件`}</button> : null}
					</>}
					{loading && results.length === 0 ? <div className="engine-spec-state">正在读取这一批源码声明…</div> : null}
					{error || catalogState.error ? <div className="engine-spec-state error">{error ?? catalogState.error}</div> : null}
				</main>
			</div>

			<section className="engine-spec-shortcuts" aria-label="跨模块常用类入口">
				<header className="engine-spec-shortcuts-head"><div><span>共享类详情入口</span><h3>跨模块直达</h3></div><p>跳过森林定位，直接解析常用引擎类型；打开后仍进入与项目类一致的关系图和只读详情。</p></header>
				<div className="engine-spec-quick">
					{CODE_QUICK_GROUPS.map((group) => <section key={group.id} className={`engine-spec-group group-${group.id}`}><header><span>{group.label}</span><small>{group.description}</small></header><div>{group.entries.map((entry) => <button type="button" className="engine-quick-card" key={entry.name} disabled={busy} onClick={() => void onOpenClass(entry.name)}><b>{entry.name}</b><small>{entry.folder}</small><AppIcon name="arrow" size={14} /></button>)}</div></section>)}
				</div>
			</section>
		</section>
	);
}
