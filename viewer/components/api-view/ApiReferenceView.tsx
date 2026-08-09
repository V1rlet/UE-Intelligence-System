// Graph Brain / viewer - API Reference View（P3U2 → F12 重构）：ufunction 速查视图
// 三列布局：左导航 | 中列表 | 右详情面板
// 三源 tab：全部 | 项目 API | UE 5.8 引擎 API
// 引擎 API 模式：按需解析引擎类 + 用户快速入口 + 分类过滤
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, apiFetchJson } from "../../src/apiFetch";
import { LatestRequestGate } from "../../src/latestRequest";
import { usePanelWidth } from "../../src/usePanelWidth";
import { toast } from "../common/Toast";
import { isStaticFunction, specFunctionPageIndex } from "../common/functionPartition";
import type { GraphElements } from "../graph-view/GraphView";
import type { EngineCatalogState } from "../../src/useEngineCatalog";
import ReadonlySpecPanel from "../graph-view/ReadonlySpecPanel";
import SpecView from "../graph-view/SpecView";
import { FN_PAGE_SIZE, type FocusRequest, type SpecTarget, type SpecZonePages } from "../graph-view/specModel";
import { advanceSpecTrail } from "../graph-view/specNavigation";
import { CODE_QUICK_ENTRIES } from "../../src/codeQuickEntries";
import { buildApiFunctionNodeModel } from "./apiNodeModel";
import { hasConcreteSpecTarget, resolveApiSpecContext } from "./apiSpecContext";
import { groupApiSearchResults, rankApiEntries } from "./apiSearch";
import ApiCatalogPane from "./ApiCatalogPane";
import ApiDetailPane from "./ApiDetailPane";
import PanelResizer from "./PanelResizer";
import SearchHighlight from "./SearchHighlight";
import type { Favorite, FavoriteInput } from "./useFavorites";
import {
	ALL_CATALOG_FILTER,
	type ApiClassFavorite,
	type ApiFunctionFavoriteRef,
	type ApiInfo,
	type ApiSpecTrailEntry,
	type CatalogSyncStatus,
	type EngineCatalogClass,
	type EngineClassInfo,
	type EngineMetaFilter,
	type FnEntry,
	type Source,
} from "./apiTypes";

interface Props {
	elements: GraphElements;
	domain: string;
	subsystem: string;
	favorites: Favorite[];
	favIds: Set<string>;
	favError: string | null;
	onToggleFavorite: (id: string, details?: Partial<FavoriteInput>) => Promise<void>;
	onLocate?: (fnId: string, parentId: string) => void;
	entryRequest?: { id: string; seq: number } | null;
	onJumpToNode?: (nodeId: string) => void;
	sourceRoot?: string;
	source: Source;
	onSourceChange: (source: Source) => void;
	engineCatalog: EngineCatalogState;
	engineParser: {
		elements: GraphElements;
		parsedClassNames: Set<string>;
		parsingClassNames: Set<string>;
		parseClass: (name: string, sourcePath?: string) => Promise<boolean>;
	};
}

export default function ApiReferenceView({
	elements, domain, subsystem, favorites, favIds, favError, onToggleFavorite, onLocate, entryRequest, onJumpToNode, sourceRoot,
	source, onSourceChange, engineCatalog, engineParser,
}: Props) {
	const [query, setQuery] = useState("");
	const [landing, setLanding] = useState(() => !(source === "engine" && engineCatalog.selectedClass));
	const [landingQuery, setLandingQuery] = useState("");
	const [navQuery, setNavQuery] = useState("");
	const [searchRange, setSearchRange] = useState<"global" | "current">("global");
	const [catalogSearchCurrent, setCatalogSearchCurrent] = useState(false);
	const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
	const [favMode, setFavMode] = useState(false);
	const [classFilter, setClassFilter] = useState<string | null>(() => source === "engine" ? engineCatalog.selectedClass?.name ?? null : null);
	const [specTrail, setSpecTrail] = useState<ApiSpecTrailEntry[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [specHoverId, setSpecHoverId] = useState<string | null>(null);
	const [specFnPage, setSpecFnPage] = useState(0);
	const [specZonePages, setSpecZonePages] = useState<SpecZonePages>({});
	const [specFocusRequest, setSpecFocusRequest] = useState<FocusRequest | null>(null);
	const [collapsedMods, setCollapsedMods] = useState<Set<string>>(new Set());
	const setSource = onSourceChange;
	// 引擎 API 状态
	const engineElements = engineParser.elements;
	const catalogParsed = engineParser.parsedClassNames;
	const catalogParsing = engineParser.parsingClassNames;
	const engineClasses = useMemo<EngineClassInfo[]>(() => CODE_QUICK_ENTRIES.map((entry) => ({
		...entry,
		parsed: catalogParsed.has(entry.name),
		loading: catalogParsing.has(entry.name),
	})), [catalogParsed, catalogParsing]);
	const [engineCategory, setEngineCategory] = useState<string | null>(null);
	const [engineMetaFilter, setEngineMetaFilter] = useState<EngineMetaFilter | null>(null);
	const catalogScope = engineCatalog.selectedScope;
	const catalogModule = engineCatalog.selectedModuleName;
	const [catalogClasses, setCatalogClasses] = useState<EngineCatalogClass[]>([]);
	const [catalogTotal, setCatalogTotal] = useState(0);
	const [catalogResultKey, setCatalogResultKey] = useState("");
	const [catalogSyncBusy, setCatalogSyncBusy] = useState(false);
	const [catalogSyncStatus, setCatalogSyncStatus] = useState<CatalogSyncStatus | null>(null);
	const [catalogError, setCatalogError] = useState<string | null>(null);
	const catalogSyncRequest = useRef(new LatestRequestGate());
	const selectedCatalogClass = engineCatalog.selectedClass;
	const [catalogSyncSeq, setCatalogSyncSeq] = useState(0);
	const catalogRequestKey = [catalogScope, catalogModule, catalogSearchCurrent ? "current" : "global", navQuery.trim(), sourceRoot ?? "", catalogSyncSeq].join("\u0000");
	const classFavorites = useMemo<ApiClassFavorite[]>(() => favorites
		.filter((favorite) => favorite.kind === "class" && favorite.source !== "unknown")
		.map((favorite) => ({ name: favorite.node_id, source: favorite.source as "project" | "engine", module: favorite.module, sourcePath: favorite.source_path })), [favorites]);
	const functionFavoriteRefs = useMemo<ApiFunctionFavoriteRef[]>(() => favorites
		.filter((favorite) => favorite.kind === "function")
		.map((favorite) => ({
			id: favorite.node_id,
			label: favorite.label ?? favorite.node_id.split("::").pop() ?? favorite.node_id,
			parent: favorite.parent_id ?? favorite.node_id.split("::")[0] ?? "（未知类型）",
			module: favorite.module ?? "（未知模块）",
			tags: [],
			layer: favorite.source,
			...(favorite.source_path ? { source_path: favorite.source_path } : {}),
		})), [favorites]);
	const navPanel = usePanelWidth("apinav", { width: 310, min: 240, max: 480, side: "left" });
	const detailPanel = usePanelWidth("apidetail", { width: 410, min: 320, max: 600, side: "right" });

	useEffect(() => () => catalogSyncRequest.current.cancel(), []);

	useEffect(() => {
		let cancelled = false;
		const controller = new AbortController();
		const requestKey = catalogRequestKey;
		const timer = window.setTimeout(async () => {
			setCatalogError(null);
			try {
				const params = new URLSearchParams({ limit: "400" });
				const globalCatalogSearch = Boolean(navQuery.trim()) && !catalogSearchCurrent;
				if (!globalCatalogSearch && catalogScope !== ALL_CATALOG_FILTER) params.set("scope", catalogScope);
				if (!globalCatalogSearch && catalogModule !== ALL_CATALOG_FILTER) params.set("module", catalogModule);
				if (sourceRoot) params.set("source_root", sourceRoot);
				if (navQuery.trim()) params.set("q", navQuery.trim());
				const body = await apiFetchJson<{ results?: EngineCatalogClass[]; total?: number }>(
					`/api/engine-catalog/classes?${params}`,
					{ signal: controller.signal },
					{ notify: false, context: "模块 API 类" },
				);
				if (!cancelled) {
					setCatalogClasses(body.results ?? []);
					setCatalogTotal(Number(body.total ?? 0));
					setCatalogResultKey(requestKey);
				}
			} catch (error) {
				if (!cancelled && (error as Error).name !== "AbortError") setCatalogError((error as Error).message);
			}
		}, 180);
		return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
	}, [catalogModule, catalogRequestKey, catalogScope, catalogSearchCurrent, navQuery, sourceRoot]);

	// ── 项目函数提取 ──
	const projectFns = useMemo<FnEntry[]>(() => {
		const classTags = new Map<string, string[]>();
		for (const n of elements.nodes) {
			const d = n.data as Record<string, unknown>;
			if (d.type !== "ufunction" && Array.isArray(d.tags)) {
				const scoped = (d.tags as string[]).filter((t: string) => t.startsWith("#"));
				if (scoped.length > 0) classTags.set(String(d.id), scoped);
			}
		}
		return elements.nodes
			.map((n) => n.data as Record<string, unknown>)
			.filter((d) => d.type === "ufunction")
			.map((d) => {
				const own = Array.isArray(d.tags) ? (d.tags as string[]) : [];
				const inherited = classTags.get(String(d.parent)) ?? [];
				return {
					id: String(d.id),
					label: String(d.label ?? d.id),
					parent: String(d.parent ?? "（无所属类）"),
					module: String(d.module ?? "（无模块）"),
					description: d.description ? String(d.description) : undefined,
					tags: [...new Set([...own, ...inherited])],
					api: d.api as ApiInfo | undefined,
					layer: d.layer ? String(d.layer) : undefined,
					source_path: d.source_path ? String(d.source_path) : undefined,
				};
			});
	}, [elements]);

	// ── 引擎函数提取 ──
	const engineFns = useMemo<FnEntry[]>(() => {
		return engineElements.nodes
			.map((n) => n.data as Record<string, unknown>)
			.filter((d) => d.type === "ufunction")
			.map((d) => {
				const tags = Array.isArray(d.tags) ? (d.tags as string[]) : [];
				return {
					id: String(d.id),
					label: String(d.label ?? d.id),
					parent: String(d.parent ?? ""),
					module: String(d.module ?? ""),
					description: d.description ? String(d.description) : undefined,
					tags,
					api: d.api as ApiInfo | undefined,
					layer: "engine",
					source_path: d.source_path ? String(d.source_path) : undefined,
				};
			});
	}, [engineElements]);

	// ── 当前可见函数（根据源过滤） ──
	const fns = useMemo<FnEntry[]>(() => {
		switch (source) {
			case "project": return projectFns.filter((f) => f.layer !== "engine");
			case "engine": return engineFns;
			default: return [...projectFns, ...engineFns];
		}
	}, [source, projectFns, engineFns]);

	const globalFunctionSearch = Boolean(query.trim()) && searchRange === "global";
	const searchFns = useMemo(
		() => globalFunctionSearch ? [...projectFns, ...engineFns] : fns,
		[engineFns, fns, globalFunctionSearch, projectFns],
	);

	// ── 场景标签全集 ──
	const allTags = useMemo(() => {
		const s = new Set<string>();
		for (const f of fns) for (const t of f.tags) if (t.startsWith("#")) s.add(t);
		return [...s].sort();
	}, [fns]);

	// ── 引擎模式分类（从 UFUNCTION Category 提取） ──
	const engineCategories = useMemo<string[]>(() => {
		if (source !== "engine") return [];
		const cats = new Set<string>();
		for (const f of engineFns) {
			for (const t of f.tags) {
				if (t.startsWith("#")) cats.add(t.replace("#", ""));
			}
		}
		return [...cats].sort();
	}, [source, engineFns]);

	// ── 筛选管线 ──
	const visible = useMemo(() => {
		const q = query.trim().toLowerCase();
		const candidates = searchFns.filter((f) => {
			if (favMode && !favIds.has(f.id)) return false;
			if (!globalFunctionSearch && classFilter && f.parent !== classFilter) return false;
			if (!globalFunctionSearch && source === "engine" && engineCategory) {
				if (!f.tags.includes(`#${engineCategory}`)) return false;
			}
			if (!globalFunctionSearch && source === "engine" && engineMetaFilter) {
				if (engineMetaFilter === "BlueprintCallable" && !f.api?.blueprint_exposable) return false;
				if (engineMetaFilter === "C++ Only" && !f.api?.cpp_only) return false;
				if (engineMetaFilter === "WorldContext" && !/WorldContext/i.test(f.api?.signature ?? "")) return false;
				if (engineMetaFilter === "Latent" && !f.tags.some((t) => /latent/i.test(t))) return false;
			}
			if (!globalFunctionSearch && activeTags.size > 0 && ![...activeTags].every((t) => f.tags.includes(t))) return false;
			return true;
		});
		if (!q) return candidates;
		return rankApiEntries(candidates.map((f) => ({
			...f,
			name: f.label,
			scope: f.layer === "engine" ? "Engine API" : "Project API",
			signature: f.api?.signature,
			tags: [...f.tags, f.parent, ...(f.api?.params ?? []).map((param) => param.name)],
			popularity: (favIds.has(f.id) ? 55 : 0) + (f.api?.blueprint_exposable ? 12 : 0) + (f.api?.cpp_only ? 0 : 4),
		})), query).map((match) => match.entry);
	}, [activeTags, classFilter, engineCategory, engineMetaFilter, favIds, favMode, globalFunctionSearch, query, searchFns, source]);

	// ── 树形导航 ──
	const navTree = useMemo(() => {
		const tree = new Map<string, Map<string, number>>();
		for (const f of projectFns) {
			const classes = tree.get(f.module) ?? new Map<string, number>();
			classes.set(f.parent, (classes.get(f.parent) ?? 0) + 1);
			tree.set(f.module, classes);
		}
		return tree;
	}, [projectFns]);

	// ── 按类分组 ──
	const grouped = useMemo(() => {
		const m = new Map<string, FnEntry[]>();
		for (const f of visible) {
			const list = m.get(f.parent) ?? [];
			list.push(f);
			m.set(f.parent, list);
		}
		return [...m.entries()].sort(([a], [b]) => query.trim() ? 0 : a.localeCompare(b));
	}, [query, visible]);

	// 主画布只有在用户明确进入类时才切换为单类 Spec；未选择类时保留搜索结果节点总览。
	const contextClass = classFilter;
	const apiSpecContext = useMemo(
		() => resolveApiSpecContext(elements, engineElements, source, contextClass),
		[elements, engineElements, source, contextClass],
	);
	const contextIsEngine = apiSpecContext?.elements === engineElements;
	const sharedSpecSelectedId = selectedId && apiSpecContext?.elements.nodes.some((node) => String(node.data.id) === selectedId)
		? selectedId
		: apiSpecContext?.target.id ?? null;
	const contextFns = contextClass ? fns.filter((f) => f.parent === contextClass) : [];
	const contextSample = contextFns[0];
	const contextClassData = apiSpecContext?.elements.nodes.find((node) => String(node.data.id) === contextClass)?.data as Record<string, unknown> | undefined;
	const catalogSearching = Boolean(navQuery.trim());
	const currentCatalogClasses = catalogResultKey === catalogRequestKey ? catalogClasses : [];
	const currentCatalogTotal = catalogResultKey === catalogRequestKey ? catalogTotal : 0;
	const catalogDisplayClasses = useMemo(() => {
		const enriched = currentCatalogClasses.map((entry) => ({
			...entry,
			description: entry.remarks,
			popularity:
				(classFavorites.some((favorite) => favorite.source === "engine" && favorite.name === entry.name) ? 45 : 0)
				+ (catalogParsed.has(entry.name) ? 25 : 0)
				+ (entry.available_in_source ? 10 : 0)
				+ (entry.scope === "Runtime" ? 4 : 0),
		}));
		if (catalogSearching) {
			return groupApiSearchResults(enriched, navQuery).flatMap((group) => group.matches.map((match) => match.entry));
		}
		return enriched.sort((a, b) =>
			a.scope.localeCompare(b.scope) || a.module.localeCompare(b.module) || a.name.localeCompare(b.name),
		);
	}, [catalogParsed, catalogSearching, classFavorites, currentCatalogClasses, navQuery]);
	const contextCatalogClass = selectedCatalogClass?.name === contextClass
		? selectedCatalogClass
		: currentCatalogClasses.find((entry) => entry.name === contextClass);
	const contextEngineParsed = contextClass
		? catalogParsed.has(contextClass) || engineClasses.some((entry) => entry.name === contextClass && entry.parsed)
		: false;
	const showSharedSpecLayout = apiSpecContext !== null;
	const contextSpecSource: ApiSpecTrailEntry["source"] = contextIsEngine || (!apiSpecContext && source === "engine")
		? "engine"
		: "project";
	const contextSourcePath = String(contextClassData?.source_path ?? contextCatalogClass?.source_path ?? "") || undefined;

	useEffect(() => {
		if (!contextClass) {
			setSpecTrail((trail) => trail.length > 0 ? [] : trail);
			return;
		}
		setSpecTrail((trail) => advanceSpecTrail(trail, {
			id: contextClass,
			source: contextSpecSource,
			...(contextSourcePath ? { sourcePath: contextSourcePath } : {}),
		}));
	}, [contextClass, contextSourcePath, contextSpecSource]);

	useEffect(() => {
		setSpecHoverId(null);
		setSpecFnPage(0);
		setSpecZonePages({});
	}, [contextClass]);

	useEffect(() => {
		if (!apiSpecContext || !selectedId) return;
		const selectedNode = apiSpecContext.elements.nodes.find((node) => String(node.data.id) === selectedId)?.data as Record<string, unknown> | undefined;
		if (selectedNode?.type !== "ufunction") return;
		const classFunctions = apiSpecContext.elements.nodes
			.map((node) => node.data as Record<string, unknown> & { id: string })
			.filter((node) => node.type === "ufunction" && node.parent === apiSpecContext.target.id);
		const pageIndex = specFunctionPageIndex(classFunctions, selectedId, FN_PAGE_SIZE);
		if (pageIndex >= 0) setSpecFnPage(pageIndex);
	}, [apiSpecContext, selectedId]);

	// ── 选中的函数详情 ──
	const selectedFn = useMemo<FnEntry | null>(
		() => (selectedId ? fns.find((f) => f.id === selectedId) ?? null : null),
		[selectedId, fns],
	);

	// ── companion 解析 ──
	const resolveCompanion = useCallback(
		(name: string): FnEntry | undefined =>
			fns.find((f) => f.id === name) ??
			fns.find((f) => f.id.endsWith(`::${name}`)) ??
			fns.find((f) => f.label === name),
		[fns],
	);

	// ── 引擎类解析 ──
	const parseEngineClass = async (className: string, sourcePath?: string) => {
		setCatalogError(null);
		try {
			const parsed = await engineParser.parseClass(className, sourcePath);
			if (!parsed) throw new Error("本机引擎源码解析失败");
			setClassFilter(className);
		} catch (e) {
			setCatalogError(`解析 ${className} 失败：${(e as Error).message}`);
		}
	};

	const selectCatalogClass = (entry: EngineCatalogClass) => {
		setSource("engine");
		setEngineCategory(null);
		setEngineMetaFilter(null);
		setSelectedId(null);
		engineCatalog.selectClass(entry);
		setClassFilter(entry.name);
		if (entry.parseable && !catalogParsed.has(entry.name)) void parseEngineClass(entry.name, entry.source_path);
	};

	const syncCatalogModule = async (missingOnly = false) => {
		const controller = catalogSyncRequest.current.start();
		setCatalogSyncBusy(true);
		setCatalogSyncStatus(null);
		setCatalogError(null);
		try {
			const response = await apiFetch("/api/engine-catalog/sync", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				signal: controller.signal,
				body: JSON.stringify({
					scope: catalogScope,
					module: catalogModule,
					source_root: sourceRoot,
					...(missingOnly ? { missing_only: true } : {}),
				}),
			}, { context: "Epic API 同步" });
			let body = await response.json();
			if (!catalogSyncRequest.current.isCurrent(controller)) return;
			if (!response.ok) throw new Error(body.error ?? "Epic API 模块同步失败");
			if (response.status === 202 && body.job_id) {
				setCatalogSyncStatus(body as CatalogSyncStatus);
				while (body.state === "queued" || body.state === "running") {
					await new Promise((resolve) => window.setTimeout(resolve, 700));
					if (!catalogSyncRequest.current.isCurrent(controller)) return;
					const statusResponse = await apiFetch(`/api/engine-catalog/sync/status?job_id=${encodeURIComponent(body.job_id)}`, { signal: controller.signal }, { context: "Epic API 同步状态" });
					body = await statusResponse.json();
					if (!catalogSyncRequest.current.isCurrent(controller)) return;
					if (!statusResponse.ok) throw new Error(body.error ?? "无法读取同步任务状态");
					setCatalogSyncStatus(body as CatalogSyncStatus);
				}
				if (body.state === "failed") throw new Error(body.error ?? "Epic API 批量同步失败");
			}
			if (!catalogSyncRequest.current.isCurrent(controller)) return;
			const skippedNote = typeof body.skipped_unpublished === "number" && body.skipped_unpublished > 0
				? `；跳过 ${body.skipped_unpublished} 个官方未发布文档的模块（API 符号仍由本地源码索引覆盖）`
				: "";
			if (Array.isArray(body.failed) && body.failed.length > 0) {
				setCatalogError(`批量同步已结束：成功 ${body.succeeded}/${body.requested}，失败 ${body.failed.length} 个模块${skippedNote}；失败项可在同步状态中查看`);
			} else if (typeof body.succeeded === "number") {
				toast(`已同步 ${body.succeeded} 个引擎 API 模块到本地${skippedNote}`, "success", 2600);
			} else {
				toast(`${catalogScope}/${catalogModule} 已同步到本地`, "success", 2200);
				setCatalogSyncStatus({
					state: "completed",
					requested: 1,
					completed: 1,
					succeeded: 1,
					failed_count: 0,
					started_at: new Date().toISOString(),
					finished_at: new Date().toISOString(),
				});
			}
			setCatalogSyncSeq((seq) => seq + 1);
			engineCatalog.refresh();
		} catch (error) {
			if ((error as Error).name !== "AbortError" && catalogSyncRequest.current.isCurrent(controller)) {
				setCatalogError((error as Error).message);
			}
		} finally {
			if (catalogSyncRequest.current.finish(controller)) setCatalogSyncBusy(false);
		}
	};

	// ── 图谱侧反向跳入 ──
	useEffect(() => {
		if (!entryRequest) return;
		const f = fns.find((x) => x.id === entryRequest.id);
		if (f) {
			setLanding(false);
			setSource(f.layer === "engine" ? "engine" : "project");
			setSelectedId(f.id);
			setQuery("");
			setActiveTags(new Set());
			setClassFilter(f.parent);
			setFavMode(false);
		}
	}, [entryRequest, fns]);

	const toggleTag = (t: string) =>
		setActiveTags((prev) => {
			const next = new Set(prev);
			if (!next.delete(t)) next.add(t);
			return next;
		});

	const isClassFavorite = (favoriteSource: ApiClassFavorite["source"], name: string) =>
		classFavorites.some((entry) => entry.source === favoriteSource && entry.name === name);

	const toggleClassFavorite = (favorite: ApiClassFavorite) => {
		void onToggleFavorite(favorite.name, {
			kind: "class",
			source: favorite.source,
			...(favorite.module ? { module: favorite.module } : {}),
			...(favorite.sourcePath ? { source_path: favorite.sourcePath } : {}),
		});
	};
	const toggleFunctionFavorite = (fn: FnEntry) => {
		void onToggleFavorite(fn.id, {
			kind: "function",
			source: fn.layer === "engine" ? "engine" : "project",
			label: fn.label,
			parent_id: fn.parent,
			module: fn.module,
			...(fn.source_path ? { source_path: fn.source_path } : {}),
		});
	};

	const favoriteFunctions = [...new Map(
		[...functionFavoriteRefs.filter((fn) => favIds.has(fn.id)), ...projectFns, ...engineFns]
			.filter((fn) => favIds.has(fn.id))
			.map((fn) => [fn.id, fn]),
	).values()];
	const scopedClassFavorites = classFavorites.filter((favorite) => source === "all" || favorite.source === source);
	const scopedFavoriteFunctions = favoriteFunctions.filter((fn) => source === "all" || fn.layer === source);
	const applySourceFilter = (nextSource: Source) => {
		setSource(nextSource);
		setClassFilter(null);
		setSelectedId(null);
		setEngineCategory(null);
		setEngineMetaFilter(null);
	};

	const openClassFavorite = (favorite: ApiClassFavorite) => {
		setLanding(false);
		setSelectedId(null);
		setEngineCategory(null);
		setEngineMetaFilter(null);
		setSource(favorite.source);
		if (favorite.source === "engine") void parseEngineClass(favorite.name, favorite.sourcePath);
		else setClassFilter(favorite.name);
	};

	const openFunctionFavorite = (fn: FnEntry) => {
		setLanding(false);
		setSource(fn.layer === "engine" ? "engine" : fn.layer === "project" ? "project" : "all");
		setClassFilter(fn.parent);
		setSelectedId(fn.id);
		setQuery("");
	};

	const submitLandingSearch = () => {
		const value = landingQuery.trim();
		setLanding(false);
		setSource("all");
		setSearchRange("global");
		setCatalogSearchCurrent(false);
		setNavQuery(value);
		setQuery(value);
		setClassFilter(null);
		setSelectedId(null);
	};

	const copySignature = async (sig: string) => {
		try {
			await navigator.clipboard.writeText(sig);
			toast("签名已复制", "success", 1800);
		} catch {
			toast("复制失败（浏览器未授权剪贴板）", "error");
		}
	};
	const openSharedSpecTarget = (target: SpecTarget) => {
		if (target.id === apiSpecContext?.target.id) {
			focusSharedSpecNode(target.id);
			return;
		}
		const currentElements = apiSpecContext?.elements;
		const currentHasTarget = currentElements ? hasConcreteSpecTarget(currentElements, target.id) : false;
		const projectHasTarget = hasConcreteSpecTarget(elements, target.id);
		const engineHasTarget = hasConcreteSpecTarget(engineElements, target.id);
		const stayInEngine = currentElements === engineElements && (currentHasTarget || !projectHasTarget);
		if (stayInEngine || (!projectHasTarget && engineHasTarget)) {
			setSource("engine");
			if (!engineHasTarget) void parseEngineClass(target.id, target.sourcePath);
		} else if (projectHasTarget) {
			setSource("project");
		} else {
			onJumpToNode?.(target.id);
			return;
		}
		setClassFilter(target.id);
		setSelectedId(null);
	};
	const focusSharedSpecNode = (id: string) => {
		setSelectedId(id);
		setSpecFocusRequest({ id, seq: Date.now() });
	};
	const openSharedSpecFunction = (fnId: string, parentId: string) => {
		const fn = [...projectFns, ...engineFns].find((entry) => entry.id === fnId);
		if (fn) setSource(fn.layer === "engine" ? "engine" : "project");
		setClassFilter(parentId);
		focusSharedSpecNode(fnId);
	};
	const jumpWithinSharedSpec = (nodeId: string) => {
		const node = apiSpecContext?.elements.nodes.find((entry) => String(entry.data.id) === nodeId)?.data as Record<string, unknown> | undefined;
		if (!node) {
			onJumpToNode?.(nodeId);
			return;
		}
		if (nodeId === apiSpecContext?.target.id || node.type === "ufunction" || node.type === "lifecycle_step") {
			focusSharedSpecNode(nodeId);
			return;
		}
		openSharedSpecTarget({ id: nodeId });
	};
	const toggleSharedSpecFavorite = (fnId: string) => {
		const fn = [...projectFns, ...engineFns].find((entry) => entry.id === fnId);
		if (fn) toggleFunctionFavorite(fn);
		else onToggleFavorite(fnId);
	};

	const renderFunctionCard = (f: FnEntry) => {
		const isFav = favIds.has(f.id);
		const isSelected = selectedId === f.id;
		const nodeModel = buildApiFunctionNodeModel(f);
		return (
			<div
				key={f.id}
				id={`api-entry-${f.id}`}
				className={`api-fn-card api-spec-function-node${isSelected ? " selected" : ""}`}
				role="button"
				tabIndex={0}
				aria-pressed={isSelected}
				onClick={() => setSelectedId(isSelected ? null : f.id)}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						setSelectedId(isSelected ? null : f.id);
					}
				}}
			>
				<div className="api-fn-card-top">
					<span className="api-node-glyph" aria-hidden="true">ƒ</span>
					<span className="api-fn-name"><SearchHighlight text={f.label} query={query} /></span>
					<span className="api-fn-vis">
						{isStaticFunction(f) ? "STATIC" : f.api?.blueprint_exposable ? "BP" : f.api?.cpp_only ? "C++" : "API"}
					</span>
					<button
						className={`api-star${isFav ? " faved" : ""}`}
						title={isFav ? "从快速入口移除" : "加入快速入口"}
						onClick={(event) => { event.stopPropagation(); toggleFunctionFavorite(f); }}
					>
						{isFav ? "★" : "☆"}
					</button>
				</div>
				<div className="api-node-signature">
					<span className="api-node-exec-pin is-input" aria-hidden="true" />
					<code title={nodeModel.signature}><SearchHighlight text={nodeModel.signature} query={query} /></code>
					<span className="api-node-exec-pin is-output" aria-hidden="true" />
				</div>
				<div className="api-node-ports">
					<div className="api-node-inputs">
						{nodeModel.visibleParams.map((param) => (
							<span className="api-node-param" key={`${f.id}:${param.name}`} title={param.note ?? `${param.type} ${param.name}`}>
								<i aria-hidden="true" /><b>{param.name}</b><code>{param.type}</code>
							</span>
						))}
						{nodeModel.visibleParams.length === 0 ? <span className="api-node-port-empty">无输入参数</span> : null}
						{nodeModel.hiddenParamCount > 0 ? <span className="api-node-port-more">+{nodeModel.hiddenParamCount} 个参数 · 详情中查看</span> : null}
					</div>
					<div className="api-node-outputs">
						<span className="api-node-return"><code>{nodeModel.returnType}</code><b>Return</b><i aria-hidden="true" /></span>
					</div>
				</div>
				<div className="api-fn-card-tags">
					{f.tags.filter((tag) => tag.startsWith("#")).map((tag) => (
						<span key={tag} className="api-tag-mini">{tag}</span>
					))}
				</div>
				{f.description ? <div className="api-fn-card-desc"><SearchHighlight text={f.description} query={query} /></div> : null}
				<footer className="api-node-source">
					<span>{nodeModel.sourceLabel} · {f.module}</span>
					<code title={f.source_path}>{nodeModel.sourceFile}</code>
				</footer>
			</div>
		);
	};

	if (landing) {
		return (
			<div className="api-view api-landing-view">
				<main className="api-landing">
					<header className="api-landing-head">
						<span>项目与引擎函数资料</span>
						<h1>查询项目与 UE 5.8 API</h1>
						<p>搜索类、函数、说明或参数；进入类后按继承、成员和函数分区阅读。</p>
					</header>
					<form className="api-landing-search" onSubmit={(event) => { event.preventDefault(); submitLandingSearch(); }}>
						<span>⌕</span>
						<input autoFocus value={landingQuery} onChange={(event) => setLandingQuery(event.target.value)} placeholder="搜索 API，例如 ACharacter、Networking、GetWorld…" aria-label="搜索全部 API" />
						<button type="submit">搜索</button>
					</form>
					<div className="api-landing-scope" aria-label="当前 API 来源">当前范围 · {source === "all" ? "项目与引擎" : source === "project" ? "项目代码" : "引擎源码"}</div>

					<section className="api-landing-section is-quick">
						<header><div><h2>快速入口</h2></div><small>类和函数均可自由加入、移除</small></header>
						{scopedClassFavorites.length + scopedFavoriteFunctions.length > 0 ? (
							<div className="api-landing-favorite-grid">
								{scopedClassFavorites.map((favorite) => (
									<div className="api-common-card" key={`${favorite.source}:${favorite.name}`}>
										<button type="button" className="api-common-main" onClick={() => openClassFavorite(favorite)}><span>{favorite.source === "engine" ? "UE 引擎类" : "项目类"}</span><strong>{favorite.name}</strong><small>{favorite.module ?? "查看类详情"}</small></button>
										<button type="button" className="api-common-remove" onClick={() => toggleClassFavorite(favorite)} title="从快速入口移除">×</button>
									</div>
								))}
								{scopedFavoriteFunctions.map((fn) => (
									<div className="api-common-card" key={fn.id}>
										<button type="button" className="api-common-main" onClick={() => openFunctionFavorite(fn)}><span>{fn.layer === "engine" ? "UE" : fn.layer === "project" ? "PROJECT" : "SOURCE UNKNOWN"} · FUNCTION</span><strong>{fn.label}</strong><small>{fn.parent}</small></button>
										<button type="button" className="api-common-remove" onClick={() => toggleFunctionFavorite(fn)} title="从快速入口移除">×</button>
									</div>
								))}
							</div>
						) : <div className="api-landing-common-empty"><b>{source === "all" ? "快速入口为空" : source === "project" ? "没有项目 API 快速入口" : "没有引擎 API 快速入口"}</b><span>在对应类目录或函数卡片上点击 ☆ 添加。</span></div>}
					</section>
					<button type="button" className="api-landing-browse" onClick={() => setLanding(false)}>浏览完整 API 目录 →</button>
				</main>
			</div>
		);
	}

	// ── 渲染 ──
	return (
		<div className={`api-view api-source-${source}`}>
			<div className="api-body">
				{/* ── 左侧导航（ApiCatalogPane）── */}
				<ApiCatalogPane
					width={navPanel.width}
					source={source}
					onApplySourceFilter={applySourceFilter}
					navQuery={navQuery}
					onNavSearch={(value) => {
						setNavQuery(value);
						if (value.trim() && !catalogSearchCurrent) setSource("all");
					}}
					catalogSearchCurrent={catalogSearchCurrent}
					onCatalogSearchCurrentChange={setCatalogSearchCurrent}
					navTree={navTree}
					collapsedMods={collapsedMods}
					onToggleModule={(mod) => {
						setSource("project");
						setEngineCategory(null);
						setEngineMetaFilter(null);
						setCollapsedMods((prev) => {
							const next = new Set(prev);
							if (!next.delete(mod)) next.add(mod);
							return next;
						});
					}}
					classFilter={classFilter}
					onSelectProjectClass={(cls) => {
						setSource("project");
						setEngineCategory(null);
						setEngineMetaFilter(null);
						setSelectedId(null);
						setClassFilter(cls);
					}}
					isClassFavorite={isClassFavorite}
					onToggleClassFavorite={toggleClassFavorite}
					engineCatalog={engineCatalog}
					catalogSyncBusy={catalogSyncBusy}
					catalogSyncStatus={catalogSyncStatus}
					onSyncCatalog={(missingOnly) => void syncCatalogModule(missingOnly)}
					catalogError={catalogError}
					catalogSearching={catalogSearching}
					catalogTotal={currentCatalogTotal}
					catalogDisplayClasses={catalogDisplayClasses}
					catalogParsed={catalogParsed}
					catalogParsing={catalogParsing}
					engineClasses={engineClasses}
					onSelectCatalogClass={selectCatalogClass}
					onHome={() => setLanding(true)}
				/>
				<PanelResizer
					state={navPanel}
					label="拖动调整导航栏宽度"
					title="拖动或使用方向键调整导航栏宽度"
				/>

				{/* ── 中间列表 ── */}
				<div className={`api-main${showSharedSpecLayout ? " api-spec-mode" : ""}`}>
					{contextClass ? (
						<header className="api-context">
							<nav className="api-spec-breadcrumb" aria-label="类详情路径">
								<button type="button" onClick={() => { setClassFilter(null); setSelectedId(null); }}>API 查询</button>
								{specTrail.map((entry, index) => (
									<span key={`${entry.source}:${entry.id}`}>
										<i>/</i>
										{index === specTrail.length - 1
											? <b>{entry.id}</b>
											: <button type="button" onClick={() => { setSpecTrail((trail) => trail.slice(0, index + 1)); setSource(entry.source); setClassFilter(entry.id); setSelectedId(null); }}>{entry.id}</button>}
									</span>
								))}
							</nav>
							{contextIsEngine ? (
								<div className="api-engine-notice"><span>ⓘ</span> 从本机 UE 头文件解析并持久缓存；不调用 AI、不消耗 token，也不写入项目图谱</div>
							) : null}
							<div className="api-context-row">
								<div>
									<div className="api-context-kicker">{contextIsEngine ? "UE 5.8 · 引擎 API" : `${contextSample?.module ?? "当前项目"} · 项目 API`}</div>
									<h2>{contextClass}</h2>
									<div className="api-context-meta">
									{contextClassData?.type ? <span>{String(contextClassData.type)}</span> : null}
									<span>{contextFns.length} 个函数</span>
										{(contextSample?.source_path || contextCatalogClass?.source_path) ? <code>{contextSample?.source_path || contextCatalogClass?.source_path}</code> : null}
									</div>
								</div>
								<div className="api-context-actions">
									<button type="button" className={`api-context-favorite${isClassFavorite(contextIsEngine ? "engine" : "project", contextClass) ? " active" : ""}`} onClick={() => toggleClassFavorite({ name: contextClass, source: contextIsEngine ? "engine" : "project", module: contextSample?.module ?? contextCatalogClass?.module, sourcePath: contextSample?.source_path ?? contextCatalogClass?.source_path })}>{isClassFavorite(contextIsEngine ? "engine" : "project", contextClass) ? "★ 快速入口" : "☆ 加入快速入口"}</button>
									<span className="api-context-state">{contextIsEngine ? (contextEngineParsed ? "本地已缓存" : contextCatalogClass?.available_in_source ? "本地待解析" : "官方目录") : "项目类型"}</span>
								</div>
							</div>
							{contextIsEngine && contextCatalogClass?.remarks ? <p className="api-context-remarks">{contextCatalogClass.remarks}</p> : null}
						</header>
					) : null}
					{contextIsEngine && contextCatalogClass && !contextEngineParsed ? (
						<section className="api-official-class-card">
							<div>
								<span className="api-context-kicker">Epic 官方 UE 5.8 目录</span>
								<h3>{contextCatalogClass.name}</h3>
								<p>{contextCatalogClass.remarks || (contextCatalogClass.available_in_source ? "正在从本机头文件整理类结构；普通 C++ 类型与 UE 反射类型使用同一套读取方式。" : "官方目录已收录该类型；当前本机源码索引没有找到声明。")}</p>
								<div className="api-official-meta">
									<span>{contextCatalogClass.scope}</span>
									<span>{contextCatalogClass.module}</span>
									<span>{contextCatalogClass.official_kind || contextCatalogClass.kind}</span>
								</div>
							</div>
							<a className="api-detail-btn" href={contextCatalogClass.docs_url} target="_blank" rel="noreferrer">↗ Epic 官方 API</a>
						</section>
					) : null}
					<div className="api-toolbar">
						<input
							type="text"
							className="api-search"
							placeholder={source === "engine" ? "搜索引擎函数名 / 描述 / 参数…" : "搜索函数名 / 描述 / 参数 / 标签…"}
							value={query}
							onChange={(e) => {
								setQuery(e.target.value);
								if (e.target.value.trim() && searchRange === "global") {
									setClassFilter(null);
									setSelectedId(null);
								}
							}}
							onKeyDown={(e) => e.key === "Escape" && setQuery("")}
						/>
						{query.trim() ? (
							<span className="api-function-search-range" role="group" aria-label="函数搜索范围">
								<button
									type="button"
									className={searchRange === "global" ? "active" : ""}
									onClick={() => { setSearchRange("global"); setClassFilter(null); setSelectedId(null); }}
								>
									全局
								</button>
								<button
									type="button"
									className={searchRange === "current" ? "active" : ""}
									onClick={() => setSearchRange("current")}
								>
									当前分类
								</button>
							</span>
						) : null}
						<span className="api-mode">
							<button className={!favMode ? "active" : ""} onClick={() => setFavMode(false)}>
								全部函数 <span className="api-count">{fns.length}</span>
							</button>
							<button className={favMode ? "active" : ""} onClick={() => setFavMode(true)}>
								快速入口函数 <span className="api-count">{[...favIds].filter((id) => fns.some((f) => f.id === id)).length}</span>
							</button>
						</span>
					</div>

					{/* 标签栏 / 分类栏 */}
					{!contextClass ? (source === "engine" ? (
						<div className="api-tagbar">
							<button className={`api-tag${engineMetaFilter === null ? " active" : ""}`} onClick={() => setEngineMetaFilter(null)}>全部</button>
							{(["BlueprintCallable", "C++ Only", "WorldContext", "Latent"] as EngineMetaFilter[]).map((flag) => (
								<button
									key={flag}
									className={`api-tag${engineMetaFilter === flag ? " active" : ""}`}
									onClick={() => setEngineMetaFilter(engineMetaFilter === flag ? null : flag)}
								>{flag === "C++ Only" ? "仅限 C++" : flag}</button>
							))}
						</div>
					) : allTags.length > 0 ? (
						<div className="api-tagbar">
							{allTags.map((t) => (
								<button
									key={t}
									className={`api-tag${activeTags.has(t) ? " active" : ""}`}
									onClick={() => toggleTag(t)}
								>{t}</button>
							))}
							{activeTags.size > 0 ? (
								<button className="api-tag-clear" onClick={() => setActiveTags(new Set())}>清空</button>
							) : null}
						</div>
					) : null) : null}
					{favError ? <p className="ann-error">{favError}</p> : null}

					{/* 分类 + 函数列表 */}
					<div className="api-results-shell">
						{!contextClass && source === "engine" && engineCategories.length > 0 ? (
							<aside className="api-category-nav">
								<div className="api-category-title">分类</div>
								<button className={engineCategory === null ? "active" : ""} onClick={() => setEngineCategory(null)}>全部</button>
								{engineCategories.map((cat) => (
									<button key={cat} className={engineCategory === cat ? "active" : ""} onClick={() => setEngineCategory(engineCategory === cat ? null : cat)}>{cat}</button>
								))}
							</aside>
						) : null}
						<div className={`api-list${showSharedSpecLayout ? " api-shared-spec-list" : ""}`}>
						{showSharedSpecLayout && apiSpecContext ? (
							<SpecView
								elements={apiSpecContext.elements}
								target={apiSpecContext.target}
								fnPage={specFnPage}
								onFnPage={(page) => { setSpecFnPage(page); setSpecHoverId(null); }}
								zonePages={specZonePages}
								onZonePage={(zone, page) => { setSpecZonePages((previous) => ({ ...previous, [zone]: page })); setSpecHoverId(null); }}
								hoverId={specHoverId}
								focusRequest={specFocusRequest}
								onHover={setSpecHoverId}
								onJump={openSharedSpecTarget}
								onSelectNode={(data) => setSelectedId(data ? String(data.id) : apiSpecContext.target.id)}
								viewportKey={`api-spec:${contextIsEngine ? "engine" : "project"}:${apiSpecContext.target.id}`}
							/>
						) : (
							<>
								{visible.length === 0 ? (
									<p className="hint">
										{source === "engine" && engineFns.length === 0
											? contextCatalogClass && !contextCatalogClass.parseable
											? contextCatalogClass.available_in_source
												? "正在从本机头文件整理类结构资料。"
												: "该类型来自 Epic 官方目录，本机源码未定位；可查看 Remarks 或官方文档。"
											: "点击左侧引擎类，从本机头文件离线解析；结果会持久缓存，之后打开可直接读取。"
											: favMode && favIds.size === 0
											? "快速入口中还没有函数——在条目上点 ☆ 添加。"
												: "没有匹配的函数；试试放宽搜索词或清空标签筛选。"}
									</p>
								) : null}
								{grouped.map(([cls, list]) => (
									<section key={cls} className="api-class-group">
										<button type="button" className="api-class-head api-class-node-entry" onClick={() => { setClassFilter(cls); setSelectedId(null); }}>
											<span className="api-class-node-glyph">C</span><strong>{cls}</strong><small>{list[0]?.module ?? "API 类"}</small><span className="api-count">{list.length} 函数</span><b>查看类详情 →</b>
										</button>
										<div className="api-fn-cards">{list.map(renderFunctionCard)}</div>
									</section>
								))}
								{visible.length > 0 ? <div className="api-list-footer">共 {visible.length} 项{contextClass ? ` · ${contextClass}` : ""}</div> : null}
							</>
						)}
						</div>
					</div>
				</div>

				{/* ── 右侧详情面板 ── */}
				{showSharedSpecLayout && apiSpecContext ? (
					<>
						<PanelResizer
							state={detailPanel}
							label="拖动调整类详情宽度"
							title="拖动或使用方向键调整类详情宽度"
						/>
						<div className="api-shared-spec-panel" style={{ width: detailPanel.width }}>
							<ReadonlySpecPanel
								elements={apiSpecContext.elements}
								target={apiSpecContext.target}
								domain={domain}
								subsystem={subsystem}
								selectedId={sharedSpecSelectedId}
								fnPage={specFnPage}
								onFnPage={(page) => { setSpecFnPage(page); setSpecHoverId(null); }}
								onSelect={focusSharedSpecNode}
								onJump={openSharedSpecTarget}
								favIds={favIds}
								onToggleFav={toggleSharedSpecFavorite}
								onJumpFn={openSharedSpecFunction}
								onShowInApi={focusSharedSpecNode}
								mermaidEntries={[]}
								onOpenMermaid={() => undefined}
								onJumpToNode={jumpWithinSharedSpec}
								onClose={() => { setClassFilter(null); setSelectedId(null); }}
							/>
						</div>
					</>
				) : null}
				{selectedFn && !showSharedSpecLayout ? (
					<ApiDetailPane
						selectedFn={selectedFn}
						detailPanel={detailPanel}
						favIds={favIds}
						onToggleFav={toggleFunctionFavorite}
						onLocate={onLocate}
						onCopySignature={copySignature}
						onSelectFn={(id) => setSelectedId(id)}
						onClose={() => setSelectedId(null)}
						source={source}
						isClassFavorite={isClassFavorite}
						onToggleClassFavorite={toggleClassFavorite}
						resolveCompanion={resolveCompanion}
						contextCatalogClass={contextCatalogClass}
						domain={domain}
						subsystem={subsystem}
						onJumpToNode={onJumpToNode}
					/>
				) : null}
			</div>
		</div>
	);
}
