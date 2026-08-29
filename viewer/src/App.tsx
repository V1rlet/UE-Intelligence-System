// GraphBrain is a read-only UE code architecture viewer.
// Planning, design, review and delivery live in ClaudeGameStudios.
import { lazy, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { graphSourceRootQuery } from "../../core/schema/graph-version";
import { useGraphDocument } from "./useGraphDocument";
import { useGraphFile } from "./useGraphFile";
import { graphLoadModeSatisfied } from "./loadGraphProjection";
import { useForestNavigation } from "./useForestNavigation";
import { useSpecNavigation } from "./useSpecNavigation";
import { useEngineClassParser } from "./useEngineClassParser";
import { useEngineCatalog } from "./useEngineCatalog";
import useFavorites from "../components/api-view/useFavorites";
import AppIcon from "../components/common/AppIcon";
import EvidenceStatusBadge from "../components/common/EvidenceStatusBadge";
import HierarchySelect, { type HierarchySelectOption } from "../components/common/HierarchySelect";
import { AsyncLoading, AsyncSurface } from "../components/common/AsyncSurface";
import ToastHost, { toast } from "../components/common/Toast";
import { useDialogFocus } from "../components/common/useDialogFocus";
import { handleRovingTabKeyDown, rovingTabStop } from "../components/common/rovingTabs";
import type { HelpSection } from "../components/help/HelpCenter";
import HomeView from "../components/home/HomeView";
import { FN_PAGE_SIZE, type SpecTarget } from "../components/graph-view/specModel";
import { specFunctionPageIndex } from "../components/common/functionPartition";
import { usePanelWidth } from "./usePanelWidth";
import { isBrowsableCodeGraph, selectExistingSpec } from "./workspaceModel";
import { appHistoryCommand, type AppHistoryWriteMode } from "./appHistory";
import { hasAppShortcutBlocker, resolveAppShortcut } from "./appShortcuts";
import { UE_SPEC_NODE_TYPES } from "../../core/schema/ue-naming";
import {
	buildAppSearch,
	resolveAppDeepLink,
	type AppDeepLink,
	type AppView,
	type ChangeEvidenceRoute,
	type ChangeRouteDiagnostic,
	type ChangeRouteResolution,
} from "./appRoute";
import {
	changeCodeLens,
	changeCodeSource,
	codeLensCapabilities,
	codeSourceCapabilities,
	type CodeLens,
	type CodeSource,
	type CodeWorkspaceState,
} from "./codeWorkspaceModel";
import { recordViewerWorkspace, viewerWorkspaceUsage } from "./localUsage";
import { confirmDiscardUnsavedChanges, guardedWorkspaceSwitch, hasUnsavedChanges } from "./unsavedChanges";

const ApiReferenceView = lazy(() => import("../components/api-view/ApiReferenceView"));
const GraphWorkspaceView = lazy(() => import("../components/graph-view/GraphWorkspaceView"));
const ArchitectureWorkspace = lazy(() => import("../components/mindmap/ArchitectureWorkspace"));
const ChangesView = lazy(() => import("../components/changes/ChangesView"));
const HelpCenter = lazy(() => import("../components/help/HelpCenter"));

const DOMAIN = "ue5_code" as const;
const SPEC_TYPES = new Set<string>(UE_SPEC_NODE_TYPES);

function readDeepLink(): AppDeepLink {
	return resolveAppDeepLink(window.location.search);
}

function isTypingTarget(target: EventTarget | null): boolean {
	return target instanceof HTMLInputElement
		|| target instanceof HTMLTextAreaElement
		|| target instanceof HTMLSelectElement
		|| (target instanceof HTMLElement && target.isContentEditable);
}

function mergeChangeRouteDiagnostics(current: ChangeRouteDiagnostic[], incoming: ChangeRouteDiagnostic[]): ChangeRouteDiagnostic[] {
	const merged = new Map(current.map((item) => [`${item.code}:${item.requested}`, item]));
	for (const item of incoming) merged.set(`${item.code}:${item.requested}`, item);
	return [...merged.values()];
}

export default function App() {
	const initialLink = useMemo(readDeepLink, []);
	const [view, setView] = useState<AppView>(initialLink.view);
	const recordedWorkspacesRef = useRef(new Set<string>());
	const [routeIssue, setRouteIssue] = useState(initialLink.issue);
	const historyWriteModeRef = useRef<AppHistoryWriteMode>("replace");
	const navigateView = useCallback((nextView: AppView) => {
		// 工作区切换会卸载标注面板等编辑器：有未保存草稿时先征得确认，
		// 否则探测基础设施只是死代码（beforeunload 只能拦标签页级离开）。
		if (!confirmDiscardUnsavedChanges()) return;
		setRouteIssue(null);
		setView((current) => {
			if (current !== nextView) historyWriteModeRef.current = "push";
			return nextView;
		});
	}, []);
	const [architectureScope, setArchitectureScope] = useState(initialLink.architectureScope ?? "root");
	const [codeWorkspace, setCodeWorkspace] = useState<CodeWorkspaceState>({ source: initialLink.codeSource, lens: initialLink.codeLens });
	const { source: codeSource, lens: codeLens } = codeWorkspace;
	useEffect(() => {
		const event = viewerWorkspaceUsage(view, codeLens);
		if (recordedWorkspacesRef.current.has(event)) return;
		recordedWorkspacesRef.current.add(event);
		recordViewerWorkspace(event);
	}, [codeLens, codeSource, view]);
	const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
	const [classChooser, setClassChooser] = useState<string[] | null>(null);
	const [helpSection, setHelpSection] = useState<HelpSection | null>(null);
	const [apiEntryRequest, setApiEntryRequest] = useState<{ id: string; seq: number } | null>(null);
	const [forceFullGraph, setForceFullGraph] = useState(Boolean(initialLink.spec || initialLink.focus));
	const [forestBranch, setForestBranch] = useState<string | null>(initialLink.forestBranch);
	const [changeEvidenceRoute, setChangeEvidenceRoute] = useState<ChangeEvidenceRoute>(initialLink.changes);
	const [changeRouteDiagnostics, setChangeRouteDiagnostics] = useState<ChangeRouteDiagnostic[]>(initialLink.changeDiagnostics);
	const [routeRestoreVersion, setRouteRestoreVersion] = useState(0);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const classChooserDialogRef = useDialogFocus<HTMLDivElement>(Boolean(classChooser), () => setClassChooser(null));
	const pendingSpecRef = useRef<SpecTarget | null>(initialLink.spec ? { id: initialLink.spec } : null);
	const pendingSpecSourceRef = useRef<"project" | "engine" | "auto">(initialLink.codeSource === "engine" ? "engine" : "project");
	const pendingFocusRef = useRef<string | null>(initialLink.focus);
	const currentPageLabel = view === "home"
		? "代码事实总览"
		: view === "architecture"
			? "代码架构"
			: view === "changes"
				? "代码变化"
				: codeLensCapabilities().find((lens) => lens.id === codeLens)?.label ?? "代码探索";

	useEffect(() => {
		window.document.title = `${helpSection ? "帮助中心" : currentPageLabel} · GraphBrain`;
	}, [currentPageLabel, helpSection]);

	const specNav = useSpecNavigation({});
	const document = useGraphDocument({ deepLink: initialLink });
	const {
		graphList, graphCatalog, listLoaded, catalogRefreshing, refreshGraphCatalog, catalogError,
		currentFile, setCurrentFile,
	} = document;
	const currentCatalogEntry = graphCatalog.find((entry) => entry.file === currentFile) ?? null;
	const supportsForestProjection = currentCatalogEntry?.capabilities?.file_forest_projection === 1;
	const graphLoadMode = codeLens === "api" && codeSource !== "engine"
		|| Boolean(specNav.specTarget) && codeSource !== "engine"
		|| forceFullGraph
		|| !supportsForestProjection
		? "full" as const
		: "projection" as const;

	const graphFile = useGraphFile({
		// The catalog is enough for overview/change/architecture. The multi-megabyte
		// project fact graph belongs to the code workspace and is loaded on entry.
		currentFile: view === "code" ? currentFile : null,
		loadMode: graphLoadMode,
		onLoadStart: ({ reason }) => {
			if (reason === "file") {
				setSelected(null);
				specNav.setSpecStack([]);
				specNav.setHoverId(null);
			}
		},
		onLoaded: () => undefined,
		onLoadError: (message) => toast(`加载代码图失败：${message}`, "error"),
	});
	const graphModeSatisfied = graphLoadModeSatisfied(graphFile.loadedGraphMode, graphLoadMode);
	const graph = graphFile.loadedGraphFile === currentFile && graphModeSatisfied ? graphFile.graph : null;
	const { graphLoading, graphLoadError, reloadGraph } = graphFile;
	const forest = useForestNavigation({ graph, displayGraph: graph, graphKey: currentFile, branch: forestBranch, onBranchChange: setForestBranch });
	const sourceRoot = graphSourceRootQuery(graph?.meta) || undefined;
	const engineCatalog = useEngineCatalog(
		sourceRoot,
		view === "code" && (codeSource === "engine" || codeSource === "all"),
	);
	const engine = useEngineClassParser({
		graph,
		isProjectGraph: forest.isProjectGraph,
		forestQuery: forest.forestQuery,
	});
	const { favorites, favIds, favError, toggleFavorite } = useFavorites(DOMAIN);
	const detailPanel = usePanelWidth("detail", { width: 380, min: 300, max: 680, side: "right" });
	const specPanel = usePanelWidth("spec", { width: 440, min: 340, max: 760, side: "right" });
	const updateChangeEvidenceRoute = useCallback((route: ChangeEvidenceRoute) => {
		setChangeRouteDiagnostics([]);
		setChangeEvidenceRoute(route);
	}, []);
	const applyChangeRouteResolution = useCallback((resolution: ChangeRouteResolution) => {
		setChangeEvidenceRoute(resolution.route);
		if (resolution.diagnostics.length > 0) {
			setChangeRouteDiagnostics((current) => mergeChangeRouteDiagnostics(current, resolution.diagnostics));
		}
	}, []);

	const subsystem = String(graph?.meta?.subsystem ?? graphCatalog.find((entry) => entry.file === currentFile)?.subsystem ?? "project");
	const displayElements = forest.isProjectGraph ? forest.forestElements : graph?.elements ?? null;
	const legend = useMemo(() => {
		const types = new Set<string>();
		const relations = new Set<string>();
		const layers = new Set<string>();
		for (const node of displayElements?.nodes ?? []) {
			if (node.data.type) types.add(String(node.data.type));
			if (node.data.layer) layers.add(String(node.data.layer));
		}
		for (const edge of displayElements?.edges ?? []) if (edge.data.relation) relations.add(String(edge.data.relation));
		return { types, relations, layers };
	}, [displayElements]);
	const toggleWorkspaceFavorite = useCallback((id: string) => {
		const facts = codeSource === "engine" ? engine.engineElements : graph?.elements;
		const data = facts?.nodes.find((node) => String(node.data.id) === id)?.data as Record<string, unknown> | undefined;
		if (data?.type !== "ufunction") {
			toast(`无法更新 ${id} 的快速入口：缺少函数事实`, "error");
			return;
		}
		void toggleFavorite(id, {
			kind: "function",
			source: codeSource === "engine" ? "engine" : "project",
			...(data.label ? { label: String(data.label) } : {}),
			...(data.parent ? { parent_id: String(data.parent) } : {}),
			...(data.module ? { module: String(data.module) } : {}),
			...(data.source_path ? { source_path: String(data.source_path) } : {}),
		});
	}, [codeSource, engine.engineElements, graph?.elements, toggleFavorite]);

	const openDocument = useCallback((file: string, destination: AppView = "code") => {
		// 文件切换会卸载整个图谱工作区（含标注面板）：必须过未保存守卫（F3）。
		guardedWorkspaceSwitch(() => {
			setCurrentFile(file);
			setForestBranch(null);
			setView(destination);
			setSelected(null);
			specNav.closeSpec();
		});
	}, [setCurrentFile, specNav.closeSpec]);

	const openWorkspaceSpec = useCallback((target: SpecTarget, source: "project" | "engine") => {
		navigateView("code");
		setCodeWorkspace({ source, lens: "relations" });
		specNav.openSpec(target);
		const facts = source === "engine" ? engine.engineElements : graph?.elements;
		const exists = facts?.nodes.some((node) => String(node.data.id) === target.id);
		if (source === "engine" && !exists && /^[A-Z][A-Za-z0-9_]{2,}$/.test(target.id)) {
			void engine.parseEngineClass(target.id, target.sourcePath);
		}
	}, [engine.parseEngineClass, graph, navigateView, specNav.openSpec]);
	const openSpec = useCallback((target: SpecTarget) => openWorkspaceSpec(target, "project"), [openWorkspaceSpec]);

	const openSpecFromArchitecture = useCallback((node: Record<string, unknown>) => {
		const target: SpecTarget = {
			id: String(node.id),
			chain: Array.isArray(node.inheritance_chain) ? node.inheritance_chain.map(String) : undefined,
			sourcePath: node.source_path ? String(node.source_path) : undefined,
		};
		const entry = selectExistingSpec(graphCatalog, currentFile);
		if (!entry) {
			toast("没有可承载类详情的 ue5_code 项目图。", "error");
			return;
		}
		if (!graph || graphFile.loadedGraphMode !== "full" || entry.file !== currentFile) {
			pendingSpecRef.current = target;
			pendingSpecSourceRef.current = "auto";
			setForceFullGraph(true);
			setCurrentFile(entry.file);
			navigateView("code");
			setCodeWorkspace({ source: "project", lens: "relations" });
			return;
		}
		const targetSource: "project" | "engine" = graph.elements.nodes.some((item) => String(item.data.id) === target.id) ? "project" : "engine";
		openWorkspaceSpec(target, targetSource);
	}, [currentFile, graph, graphCatalog, graphFile.loadedGraphMode, navigateView, openWorkspaceSpec, setCurrentFile]);

	useEffect(() => {
		if (!graph || !currentFile) return;
		if (pendingSpecRef.current) {
			const target = pendingSpecRef.current;
			pendingSpecRef.current = null;
			const requestedSource = pendingSpecSourceRef.current;
			const source = requestedSource === "auto"
				? graph.elements.nodes.some((item) => String(item.data.id) === target.id) ? "project" : "engine"
				: requestedSource;
			openWorkspaceSpec(target, source);
			setForceFullGraph(false);
		}
		if (pendingFocusRef.current) {
			const id = pendingFocusRef.current;
			pendingFocusRef.current = null;
			navigateView("code");
			setCodeWorkspace({ source: "project", lens: "relations" });
			const node = graph.elements.nodes.find((item) => String(item.data.id) === id);
			if (node && SPEC_TYPES.has(String(node.data.type ?? ""))) openWorkspaceSpec({ id }, "project");
			else forest.locateInForest(id);
			setForceFullGraph(false);
		}
	}, [currentFile, graph, forest.locateInForest, navigateView, openWorkspaceSpec, routeRestoreVersion]);

	const handleGraphDblTap = useCallback((data: Record<string, unknown>) => {
		const id = String(data.id ?? "");
		const type = String(data.type ?? "");
		if (type === "folder") {
			forest.toggleFolder(id);
			return;
		}
		if (type === "file") {
			const classes = Array.isArray(data.classes) ? data.classes.map(String) : [];
			if (classes.length === 1) openSpec({ id: classes[0], sourcePath: data.source_path ? String(data.source_path) : undefined });
			else if (classes.length > 1) setClassChooser(classes);
			return;
		}
		if (SPEC_TYPES.has(type)) openSpec({ id, sourcePath: data.source_path ? String(data.source_path) : undefined });
	}, [forest.toggleFolder, openSpec]);

	const jumpToNode = useCallback((id: string) => {
		navigateView("code");
		setCodeWorkspace({ source: "project", lens: "relations" });
		if (!graph || graphFile.loadedGraphMode !== "full") {
			pendingFocusRef.current = id;
			setForceFullGraph(true);
			const entry = selectExistingSpec(graphCatalog, currentFile);
			if (entry && entry.file !== currentFile) setCurrentFile(entry.file);
			return;
		}
		const node = graph?.elements.nodes.find((item) => String(item.data.id) === id);
		if (node && String(node.data.type ?? "") === "ufunction" && node.data.parent) {
			openSpec({ id: String(node.data.parent) });
			specNav.setSpecSelectedId(id);
			return;
		}
		if (node && SPEC_TYPES.has(String(node.data.type ?? ""))) {
			openSpec({ id });
			return;
		}
		forest.locateInForest(id);
	}, [currentFile, forest.locateInForest, graph, graphCatalog, graphFile.loadedGraphMode, navigateView, openSpec, setCurrentFile, specNav.setSpecSelectedId]);

	const locateFunction = useCallback((fnId: string, parentId: string) => {
		const source = engine.engineElements.nodes.some((node) => String(node.data.id) === fnId) ? "engine" : "project";
		openWorkspaceSpec({ id: parentId }, source);
		specNav.setSpecSelectedId(fnId);
		if (graph) {
			const functions = graph.elements.nodes
				.map((node) => node.data as { id?: unknown; type?: unknown; parent?: unknown; api?: { is_static?: boolean }; tags?: string[] })
				.filter((node) => node.type === "ufunction" && String(node.parent ?? "") === parentId)
				.map((node) => ({ id: String(node.id), api: node.api, tags: node.tags }));
			specNav.setFnPage(specFunctionPageIndex(functions, fnId, FN_PAGE_SIZE));
		}
	}, [engine.engineElements.nodes, graph, openWorkspaceSpec, specNav.setFnPage, specNav.setSpecSelectedId]);

	const showInApi = useCallback((fnId: string) => {
		setApiEntryRequest((previous) => ({ id: fnId, seq: (previous?.seq ?? 0) + 1 }));
		navigateView("code");
		setCodeWorkspace({ source: codeSource === "engine" ? "engine" : "project", lens: "api" });
		specNav.closeSpec();
	}, [codeSource, navigateView, specNav.closeSpec]);

	const openEngineClass = useCallback(async (name: string, sourcePath?: string) => {
		navigateView("code");
		setCodeWorkspace({ source: "engine", lens: "relations" });
		specNav.openSpec({ id: name, sourcePath });
		await engine.parseEngineClass(name, sourcePath);
	}, [engine.parseEngineClass, navigateView, specNav.openSpec]);

	useEffect(() => {
		const search = buildAppSearch({ view, file: currentFile, codeSource, codeLens, architectureScope, spec: specNav.specTarget?.id ?? null, forestBranch, changes: changeEvidenceRoute });
		const mode = historyWriteModeRef.current;
		historyWriteModeRef.current = "replace";
		const command = appHistoryCommand(window.location.pathname, window.location.search, search, mode);
		if (command) window.history[command.method](null, "", command.target);
	}, [architectureScope, changeEvidenceRoute, codeLens, codeSource, currentFile, forestBranch, specNav.specTarget, view]);

	useEffect(() => {
		if (view !== "changes") setChangeRouteDiagnostics([]);
	}, [view]);

	useEffect(() => {
		const onPopState = () => {
			historyWriteModeRef.current = "replace";
			const link = readDeepLink();
			// popstate 无法阻断（历史已切换），但离开编辑态工作区时至少显式告知草稿已丢（F3）。
			const hadUnsavedDraft = hasUnsavedChanges();
			setRouteIssue(link.issue);
			setView(link.view);
			setCodeWorkspace({ source: link.codeSource, lens: link.codeLens });
			setArchitectureScope(link.architectureScope ?? "root");
			setForestBranch(link.forestBranch);
			setChangeEvidenceRoute(link.changes);
			setChangeRouteDiagnostics(link.changeDiagnostics);
			if (link.file && graphList.includes(link.file)) setCurrentFile(link.file);
			specNav.closeSpec();
			setSelected(null);
			pendingSpecRef.current = link.spec ? { id: link.spec } : null;
			pendingSpecSourceRef.current = link.codeSource === "engine" ? "engine" : "project";
			pendingFocusRef.current = link.focus;
			setForceFullGraph(Boolean(link.spec || link.focus));
			setRouteRestoreVersion((version) => version + 1);
			if (hadUnsavedDraft && (link.view !== "code" || (link.file ?? currentFile) !== currentFile)) {
				window.alert("浏览器后退/前进离开了仍有未保存草稿的工作区，草稿已随切换丢弃。");
			}
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, [currentFile, graphList, setCurrentFile, specNav.closeSpec]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const action = resolveAppShortcut({
				key: event.key,
				altKey: event.altKey,
				ctrlKey: event.ctrlKey,
				metaKey: event.metaKey,
				shiftKey: event.shiftKey,
				defaultPrevented: event.defaultPrevented,
				typing: isTypingTarget(event.target),
				blocked: hasAppShortcutBlocker(window.document),
			});
			if (!action) return;
			if (action === "search" && !(view === "code" && codeSource === "project" && codeLens === "relations")) return;
			event.preventDefault();
			if (action === "overview") navigateView("home");
			else if (action === "exploreArchitecture") navigateView("architecture");
			else if (action === "exploreRelations") { navigateView("code"); setCodeWorkspace({ source: "project", lens: "relations" }); }
			else if (action === "changes") navigateView("changes");
			else if (action === "exploreApi") { navigateView("code"); setCodeWorkspace({ source: "all", lens: "api" }); }
			else if (action === "search") searchInputRef.current?.focus();
			else if (action === "help") setHelpSection("shortcuts");
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [codeLens, codeSource, navigateView, view]);

	const searchTotal = forest.searchResults.length + (engine.engineCandidate ? 1 : 0);
	const currentTitle = currentCatalogEntry?.title ?? currentFile ?? "未选择代码图";
	const codeGraphOptions = useMemo<HierarchySelectOption[]>(() => graphCatalog
		.filter(isBrowsableCodeGraph)
		.map((entry) => ({
			value: entry.file,
			label: entry.title || entry.subsystem,
			group: entry.kind === "reference" ? "架构参考图" : "源码事实图",
			description: entry.subsystem,
			meta: `${entry.nodes.toLocaleString()} 节点 · ${entry.edges.toLocaleString()} 关系`,
		})), [graphCatalog]);
	const panelVariables = { "--detail-w": `${detailPanel.width}px`, "--spec-w": `${specPanel.width}px` } as CSSProperties;
	const graphDetailMounted = codeLens === "relations" && codeSource !== "engine" && Boolean(selected) && !specNav.specTarget;
	const selectCodeSource = useCallback((source: CodeSource) => {
		// 离开 project 来源会卸载标注编辑器：状态不变时直接短路，避免无谓确认（F3）。
		const next = changeCodeSource(codeWorkspace, source);
		if (next.source === codeWorkspace.source && next.lens === codeWorkspace.lens) return;
		if (!confirmDiscardUnsavedChanges()) return;
		setCodeWorkspace(next);
		if (specNav.specTarget) specNav.closeSpec();
	}, [codeWorkspace, specNav.closeSpec, specNav.specTarget]);
	const selectCodeLens = useCallback((lens: CodeLens) => {
		// relations→api 会卸载图谱工作区（含标注面板）：同样先短路再守卫（F3）。
		const next = changeCodeLens(codeWorkspace, lens);
		if (next.source === codeWorkspace.source && next.lens === codeWorkspace.lens) return;
		if (!confirmDiscardUnsavedChanges()) return;
		setCodeWorkspace(next);
		if (specNav.specTarget) specNav.closeSpec();
	}, [codeWorkspace, specNav.closeSpec, specNav.specTarget]);
	const openProjectCode = useCallback((file?: string) => {
		if (file) setCurrentFile(file);
		setForestBranch(null);
		setForceFullGraph(false);
		navigateView("code");
		setCodeWorkspace({ source: "project", lens: "relations" });
		setSelected(null);
		specNav.closeSpec();
	}, [navigateView, setCurrentFile, specNav.closeSpec]);
	const openApiLens = useCallback(() => {
		navigateView("code");
		setCodeWorkspace({ source: "all", lens: "api" });
		specNav.closeSpec();
	}, [navigateView, specNav.closeSpec]);

	// 深链兜底：URL 未带 file 且本地无上次记录时，代码工作区会因渲染门槛
	// （graph 非空才挂载）保持整页空白。目录就绪后自动选中默认项目图。
	useEffect(() => {
		if (view !== "code" || !listLoaded || currentFile || graphList.length === 0) return;
		const preferred = graphCatalog.find((entry) => entry.domain === DOMAIN && entry.subsystem === "project") ?? graphCatalog[0];
		if (preferred) setCurrentFile(preferred.file);
	}, [view, listLoaded, currentFile, graphList.length, graphCatalog, setCurrentFile]);

	return <div className="app shell">
		{routeIssue ? <div className="route-not-found" role="alert">
			<AppIcon name="warning" size={18} />
			<span><strong>{routeIssue.kind === "retired-view" ? "创作工具已迁出 GraphBrain" : "找不到请求的页面"}</strong><small>{routeIssue.kind === "retired-view" ? "方案、关卡设计、评审与交付由 ClaudeGameStudios 持有；GraphBrain 只查看 UE 代码事实。" : `未知视图：${routeIssue.value}`}</small></span>
			<button type="button" onClick={() => guardedWorkspaceSwitch(() => { setRouteIssue(null); setView("home"); })}>返回首页</button>
		</div> : null}
		<a className="skip-link" href="#main-content">跳到主要内容</a>

		<nav className="rail" aria-label="代码架构查看器导航">
			<div className="rail-brand" title="GraphBrain · 代码架构查看器" aria-label="GraphBrain"><span className="rail-mark"><AppIcon name="graph" size={21} /></span><span className="rail-wordmark"><b>GRAPH</b><b>BRAIN</b></span></div>
			<button type="button" className={`rail-btn${view === "home" ? " active" : ""}`} aria-current={view === "home" ? "page" : undefined} title="总览（0）" onClick={() => navigateView("home")}><span className="rail-icon"><AppIcon name="home" size={19} /></span><span className="rail-label">总览</span></button>
			<button type="button" className={`rail-btn${view === "architecture" || view === "code" ? " active" : ""}`} aria-current={view === "architecture" || view === "code" ? "page" : undefined} title="探索（1）" onClick={() => navigateView("architecture")}><span className="rail-icon"><AppIcon name="graph" size={19} /></span><span className="rail-label">探索</span></button>
			<button type="button" className={`rail-btn${view === "changes" ? " active" : ""}`} aria-current={view === "changes" ? "page" : undefined} title="变化（3）" onClick={() => navigateView("changes")}><span className="rail-icon"><AppIcon name="history" size={19} /></span><span className="rail-label">变化</span></button>
			<div className="rail-spacer" />
			<button type="button" className="rail-btn rail-help" title="帮助（?）" aria-label="打开帮助" onClick={() => setHelpSection("current")}><span className="rail-icon"><AppIcon name="help" size={19} /></span><span className="rail-label">帮助</span></button>
		</nav>

		<div className="deck" style={panelVariables}>
			{view === "code" ? <header className={`topbar topbar-code topbar-graph topbar-code-workspace${codeLens !== "api" && specNav.specTarget ? " has-spec-nav" : graphDetailMounted ? " has-detail-panel" : ""}`} data-code-source={codeSource} data-code-lens={codeLens} data-graph-load-mode={graphFile.loadedGraphMode ?? "loading"}>
				{codeLens !== "api" && specNav.specTarget ? <span className="spec-nav">
					<button type="button" className="back-btn" onClick={specNav.backSpec}>← 返回{specNav.specStack.length > 1 ? ` ${specNav.specStack[specNav.specStack.length - 2].id}` : "代码图"}</button>
					{specNav.specStack.length > 1 ? <button type="button" className="back-btn" onClick={specNav.closeSpec}>⌂ 代码图</button> : null}
					<span className="spec-crumbs">{specNav.specStack.map((item, index) => <span key={`${item.id}:${index}`}>{index > 0 ? " › " : ""}<b>{item.id}</b></span>)}</span>
				</span> : null}

				{!specNav.specTarget || codeLens === "api" ? <div className="code-workspace-switches">
					<div className="code-lens-switch explore-mode-switch" role="tablist" aria-label="探索方式" onKeyDown={handleRovingTabKeyDown}>
						<button type="button" role="tab" aria-selected="false" tabIndex={-1} onClick={() => guardedWorkspaceSwitch(() => setView("architecture"))}>架构</button>
						{codeLensCapabilities().map((lens) => <button type="button" role="tab" aria-selected={codeLens === lens.id} tabIndex={rovingTabStop(codeLens === lens.id)} className={codeLens === lens.id ? "active" : ""} title={lens.description} key={lens.id} onClick={() => selectCodeLens(lens.id)}>{lens.label}</button>)}
					</div>
					<div className="code-source-switch" role="tablist" aria-label={`${codeLens === "relations" ? "关系图" : "API"}代码来源`} onKeyDown={handleRovingTabKeyDown}>
						{codeSourceCapabilities(codeLens).map((source) => <button type="button" role="tab" aria-selected={codeSource === source.id} tabIndex={rovingTabStop(codeSource === source.id)} className={codeSource === source.id ? "active" : ""} title={source.description} key={source.id} onClick={() => selectCodeSource(source.id)}>{source.label}</button>)}
					</div>
				</div> : null}

				{!specNav.specTarget || codeLens === "api" ? <div className="topbar-document-slot">
					{codeSource !== "engine" && graphList.length > 1 ? <HierarchySelect
						className="topbar-graph-picker"
						value={currentFile ?? ""}
						options={codeGraphOptions}
						label="选择代码图"
						eyebrow="当前代码图"
						searchable
						searchPlaceholder="筛选代码图…"
						panelMinWidth={390}
						onChange={(file) => openDocument(file, "code")}
					/> : <span className="topbar-source-context" title={codeSource === "engine" ? "UE 5.8 引擎源码" : currentTitle}>
						<small>{codeSource === "engine" ? "当前源码域" : "当前代码图"}</small>
						<strong>{codeSource === "engine" ? "UE 5.8 · Engine Source" : currentTitle}</strong>
					</span>}
				</div> : null}

				{!specNav.specTarget || codeLens === "api" ? <div className="topbar-aux-slot">
				{codeLens === "relations" && codeSource === "project" && forest.isProjectGraph ? <>
					<span className="forest-search">
						<AppIcon className="forest-search-icon" name="search" size={16} />
						<input ref={searchInputRef} type="text" role="combobox" aria-label="搜索类名或文件名" aria-autocomplete="list" aria-controls="forest-search-options" aria-expanded={Boolean(forest.forestQuery.trim())} aria-activedescendant={forest.searchSel >= 0 ? (forest.searchSel < forest.searchResults.length ? `forest-search-option-${forest.searchSel}` : "forest-search-option-engine") : undefined} placeholder="搜索类名或文件名…（/）" value={forest.forestQuery} onChange={(event) => { forest.setForestQuery(event.target.value); forest.setSearchSel(-1); engine.setEngineFetch({ state: "idle" }); }} onKeyDown={(event) => {
							if (event.key === "ArrowDown") { event.preventDefault(); forest.setSearchSel((value) => Math.min(value + 1, searchTotal - 1)); }
							else if (event.key === "ArrowUp") { event.preventDefault(); forest.setSearchSel((value) => Math.max(value - 1, -1)); }
							else if (event.key === "Enter" && searchTotal > 0) { const index = Math.max(forest.searchSel, 0); if (index < forest.searchResults.length) forest.locateInForest(forest.searchResults[index].id); else if (engine.engineCandidate) void openEngineClass(engine.engineCandidate); }
							else if (event.key === "Escape") { forest.setForestQuery(""); forest.setSearchSel(-1); }
						}} />
						{forest.forestQuery ? <button type="button" className="forest-search-clear" aria-label="清除代码图搜索" onClick={() => { forest.setForestQuery(""); forest.setSearchSel(-1); searchInputRef.current?.focus(); }}>×</button> : null}
						{forest.forestQuery.trim() ? <ul id="forest-search-options" className="forest-search-results" role="listbox">
							{forest.searchResults.map((result, index) => <li id={`forest-search-option-${index}`} role="option" aria-selected={index === forest.searchSel} key={result.id} className={index === forest.searchSel ? "active" : ""} onMouseEnter={() => forest.setSearchSel(index)} onClick={() => forest.locateInForest(result.id)}><span className="fsr-kind">{result.kind === "folder" ? "📁" : "📄"}</span>{result.label}{result.via ? <span className="fsr-via"> — 类 {result.via}</span> : null}</li>)}
							{engine.engineCandidate ? <li id="forest-search-option-engine" role="option" aria-selected={forest.searchSel === forest.searchResults.length} className={`fsr-engine${forest.searchSel === forest.searchResults.length ? " active" : ""}`} onClick={() => void openEngineClass(engine.engineCandidate!)}>⚡ {engine.engineFetch.state === "loading" ? "正在解析" : "转到引擎源码"}「{engine.engineCandidate}」</li> : null}
							{engine.engineFetch.state === "error" ? <li className="fsr-error">{engine.engineFetch.msg}</li> : null}
							{searchTotal === 0 ? <li className="fsr-empty">没有匹配项</li> : null}
						</ul> : null}
					</span>
				</> : <span className="topbar-context-hint">
					<AppIcon name={codeLens === "api" ? "api" : "graph"} size={15} />
					{codeLens === "relations" ? "按模块浏览引擎源码" : codeSource === "all" ? "跨项目与引擎检索" : codeSource === "engine" ? "引擎类型与函数" : "项目类型与函数"}
				</span>}
				</div> : null}
				{codeSource !== "engine" && currentCatalogEntry
					? <EvidenceStatusBadge entry={currentCatalogEntry} />
					: <span className="readonly-badge">只读{codeSource === "engine" ? "引擎源码" : "代码事实"}</span>}
			</header> : null}

			<main id="main-content" tabIndex={-1} className={`workspace${view === "code" && codeLens !== "api" && specNav.specTarget ? " spec-overlay-open" : ""}`}>
				{view === "home" ? <HomeView catalog={graphCatalog} loaded={listLoaded} refreshing={catalogRefreshing} error={catalogError} onRefresh={() => void refreshGraphCatalog()} openGraph={openProjectCode} openArchitecture={() => navigateView("architecture")} openApi={openApiLens} /> : null}

				{view === "architecture" ? <AsyncSurface label="正在打开代码架构" detail="代码架构没有成功打开。" icon="graph" variant="workspace" resetKey={`architecture:${architectureScope}`} onExit={() => navigateView("home")}><ArchitectureWorkspace catalog={graphCatalog} scopeId={architectureScope} onScopeChange={setArchitectureScope} onOpenRelations={() => { navigateView("code"); setCodeWorkspace({ source: "project", lens: "relations" }); }} onOpenApi={openApiLens} onBack={() => navigateView("home")} backLabel="返回总览" onOpenSpec={openSpecFromArchitecture} /></AsyncSurface> : null}

				{view === "changes" ? <AsyncSurface label="正在打开代码变化" detail="代码变化没有成功打开。" icon="history" variant="workspace" resetKey="changes" onExit={() => navigateView("home")}><ChangesView route={changeEvidenceRoute} diagnostics={changeRouteDiagnostics} onRouteChange={updateChangeEvidenceRoute} onRouteResolution={applyChangeRouteResolution} onDismissDiagnostics={() => setChangeRouteDiagnostics([])} onExplore={() => navigateView("architecture")} onOpenNode={jumpToNode} /></AsyncSurface> : null}

				{catalogError && (view === "architecture" || view === "code") ? <div className="error-banner">{catalogError}</div> : null}
				{!catalogError && view === "code" && listLoaded && graphList.length === 0 ? <div className="empty-state"><div className="empty-icon" aria-hidden="true">🕸</div><h2>还没有代码事实图</h2><p>运行 UE 源码提取器后，GraphBrain 会在这里显示只读架构。</p></div> : null}
				{graphLoading && view === "code" ? <AsyncLoading label="正在读取代码图" detail="整理源码节点与关系" icon="graph" variant="workspace" /> : null}
				{graphLoadError && !graphLoading && view === "code" ? <div className="workspace-load-error" role="alert"><AppIcon name="graph" /><div><strong>代码图没有加载成功</strong><p>{graphLoadError}</p></div><button type="button" onClick={reloadGraph}>重试</button></div> : null}

				{view === "code" && codeLens === "api" && listLoaded && !graphLoading && graph ? <AsyncSurface label="正在打开 API 视图" loadingDetail="准备项目与引擎代码资料" detail="API 视图没有成功打开。" icon="api" variant="workspace" resetKey={`api:${subsystem}`} onExit={() => setView("home")}><ApiReferenceView elements={graph.elements} domain={DOMAIN} subsystem={subsystem} favorites={favorites} favIds={favIds} favError={favError} onToggleFavorite={toggleFavorite} onLocate={locateFunction} entryRequest={apiEntryRequest} onJumpToNode={jumpToNode} sourceRoot={sourceRoot} source={codeSource} onSourceChange={(source) => { if (source === codeSource) return; if (!confirmDiscardUnsavedChanges()) return; setCodeWorkspace({ source, lens: "api" }); }} engineCatalog={engineCatalog} engineParser={{ elements: engine.engineElements, parsedClassNames: engine.parsedClassNames, parsingClassNames: engine.parsingClassNames, parseClass: engine.parseEngineClass }} /></AsyncSurface> : null}

				{view === "code" && codeLens !== "api" && graph && !graphLoading ? <AsyncSurface label="正在打开代码关系图" loadingDetail="加载图谱工作区" detail="代码关系图没有成功打开。" icon="graph" variant="workspace" resetKey={`graph:${currentFile ?? "none"}`} onExit={() => setView("home")}><GraphWorkspaceView
					data={{
						graph, currentFile, domain: DOMAIN, subsystem, displayElements, legend,
						isProjectGraph: forest.isProjectGraph, forestFocus: forest.forestFocus, codeSource,
						forest: forest.isProjectGraph ? {
							visibleNodes: forest.forestVisibleNodes,
							totalNodes: forest.forestTotalNodes,
							collapsedFolders: forest.forestCollapsedFolders,
							viewKey: forest.forestViewKey,
							onCollapseToRoots: forest.collapseToRoots,
						} : undefined,
					}}
					spec={{
						specTarget: specNav.specTarget, hoverId: specNav.hoverId, specSelectedId: specNav.specSelectedId, fnPage: specNav.fnPage, specZonePages: specNav.specZonePages, focusRequest: specNav.focusRequest,
						onFnPage: (page) => { specNav.setFnPage(page); specNav.setHoverId(null); }, onZonePage: (zone, page) => { specNav.setSpecZonePages((previous) => ({ ...previous, [zone]: page })); specNav.setHoverId(null); },
						onHover: specNav.setHoverId, onSelectSpecNode: specNav.setSpecSelectedId, onOpenSpec: (target) => openWorkspaceSpec(target, codeSource === "engine" ? "engine" : "project"), onCloseSpec: specNav.closeSpec, onRequestFocus: specNav.requestFocus,
						favIds, onToggleFav: toggleWorkspaceFavorite, onLocateFn: locateFunction, onShowInApi: showInApi, onJumpToNode: jumpToNode,
					}}
					canvas={{ selected, onSelect: setSelected, onGraphDblTap: handleGraphDblTap, onFolderToggle: forest.toggleFolder }}
					engine={{ busy: engine.engineFetch.state === "loading", elements: engine.engineElements, catalogState: engineCatalog, sourceRoot, onOpenClass: openEngineClass }}
					panels={{ specPanel, detailPanel }}
					onExit={() => setView("home")}
				/></AsyncSurface> : null}
			</main>
		</div>

		{classChooser ? <div className="class-chooser-mask" onClick={() => setClassChooser(null)}><div ref={classChooserDialogRef} className="class-chooser" role="dialog" aria-modal="true" aria-label="选择要查看的类" onClick={(event) => event.stopPropagation()}><h3>该文件包含多个 C++ 类型</h3>{classChooser.map((name) => <button key={name} onClick={() => { setClassChooser(null); openSpec({ id: name }); }}>{name}</button>)}</div></div> : null}
		{helpSection ? <AsyncSurface label="正在打开帮助" detail="帮助中心没有成功打开。" icon="library" variant="overlay" resetKey={`help:${helpSection}:${view}:${codeLens}`} onExit={() => setHelpSection(null)}><HelpCenter initialSection={helpSection} view={view === "code" ? codeLens === "api" ? "api" : "graph" : view} onClose={() => setHelpSection(null)} /></AsyncSurface> : null}
		<ToastHost />
	</div>;
}
