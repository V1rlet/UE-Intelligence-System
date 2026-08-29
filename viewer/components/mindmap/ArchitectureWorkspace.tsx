// Read-only architecture projection derived from the active catalog preview.
// The preview remains the single owner of displayed identities and relations;
// grouping and positions below are presentation-only views over those facts.
import { lazy, useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import AppIcon from "../common/AppIcon";
import { AsyncSurface } from "../common/AsyncSurface";
import EvidenceStatusBadge from "../common/EvidenceStatusBadge";
import { handleRovingTabKeyDown, rovingTabStop } from "../common/rovingTabs";
import { nextTreeItemIndex, type VisibleTreeItem } from "../common/treeNavigation";
import { useDialogFocus } from "../common/useDialogFocus";
import { relationPresentation } from "../graph-view/relationPresentation";
import type { GraphCatalogEntry } from "../../src/graphCatalog";
import { architectureScopeElements } from "./architectureProjection";
import { buildLayeredArchitectureGraph } from "./mindmapForest";
import "../../styles/architecture-workspace.css";

const GraphView = lazy(() => import("../graph-view/GraphView"));
const SPEC_NODE_TYPES = new Set(["uclass", "uactor", "ucomponent", "uinterface", "ustruct", "uenum"]);
type ArchitecturePanel = "scopes" | "legend";

interface Props {
	catalog: GraphCatalogEntry[];
	scopeId: string;
	onScopeChange: (scopeId: string) => void;
	onOpenRelations: () => void;
	onOpenApi: () => void;
	onBack: () => void;
	backLabel: string;
	onOpenSpec: (node: Record<string, unknown>) => void;
}

interface PreviewScope {
	id: string;
	group: string | null;
	title: string;
	nodes: number;
	edges: number;
	types: Array<[string, number]>;
	relations: Array<[string, number]>;
}

const TYPE_LABELS = new Map([
	["uclass", "类"], ["uactor", "Actor"], ["ucomponent", "组件"], ["uinterface", "接口"],
	["ustruct", "结构体"], ["uenum", "枚举"], ["lifecycle_step", "生命周期"],
]);

function scopeIdForGroup(group: string): string {
	return group.normalize("NFKC").toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "group";
}

/** 分组 → 稳定路由 id 的单一构造点：slug 归一化是有损压缩（大小写/分隔符差异会
 *  碰撞），碰撞时追加稳定序号去重——不同分组不得坍缩成同一个深链 id / React key。 */
function buildScopeIds(groups: readonly string[]): Map<string, string> {
	const ids = new Map<string, string>();
	const used = new Set<string>(["root"]);
	for (const group of groups) {
		const base = scopeIdForGroup(group);
		let id = base;
		for (let suffix = 2; used.has(id); suffix += 1) id = `${base}-${suffix}`;
		used.add(id);
		ids.set(group, id);
	}
	return ids;
}

function groupLabel(group: string): string {
	if (group === "Engine") return "引擎层";
	if (group === "Sabotage") return "项目层";
	return group;
}

function counted(values: string[]): Array<[string, number]> {
	const counts = new Map<string, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"));
}

function ArchitectureScopeOverview({ entry, scopes, onSelect, onOpenRelations, onOpenApi }: {
	entry: GraphCatalogEntry;
	scopes: PreviewScope[];
	onSelect: (scopeId: string) => void;
	onOpenRelations: () => void;
	onOpenApi: () => void;
}) {
	const overview = scopes[0];
	return <div className="architecture-overview" aria-label="当前代码架构范围总览">
		<header className="architecture-overview-hero">
			<div><span className="architecture-overview-eyebrow"><AppIcon name="route" size={16} /> CATALOG PREVIEW · CURRENT FACTS</span><h1>先选边界，再读关系</h1><p>这里按活动代码图已有的 group 字段组织入口。进入范围后会保留直接相连的外部节点，筛选不会切断理解所需的一跳上下文。</p></div>
			<div className="architecture-overview-total" aria-label={`${overview.nodes} 个节点，${overview.edges} 条关系`}><small>当前投影</small><strong>{overview.nodes}</strong><span>节点</span><b>{overview.edges} 关系 · {Math.max(0, scopes.length - 1)} 分组</b></div>
		</header>

		<section className="architecture-scope-grid" aria-label="可浏览范围">
			{scopes.slice(1).map((scope, index) => <button type="button" className="architecture-scope-card" data-scope-id={scope.id} data-tone={index % 4} onClick={() => onSelect(scope.id)} key={scope.id}>
				<span className="architecture-scope-card-index">{String(index + 1).padStart(2, "0")}</span>
				<span className="architecture-scope-card-kind">活动图分组</span>
				<AppIcon className="architecture-scope-card-icon" name="graph" size={18} />
				<strong>{scope.title}</strong>
				<span className="architecture-scope-card-metrics"><b>{scope.nodes}</b> 节点 <i>·</i> <b>{scope.edges}</b> 内部关系</span>
				<span className="architecture-scope-card-types">{scope.types.slice(0, 3).map(([type, count]) => <i key={type}>{TYPE_LABELS.get(type) ?? type} {count}</i>)}</span>
				<span className="architecture-scope-card-relations">{scope.relations.length > 0 ? scope.relations.slice(0, 2).map(([relation, count]) => <i key={relation}>{relationPresentation(relation).label} {count}</i>) : <i>暂无内部关系</i>}</span>
				<span className="architecture-scope-card-open">进入范围 <AppIcon name="arrow" size={14} /></span>
			</button>)}
		</section>

		<footer className="architecture-overview-footer">
			<div><EvidenceStatusBadge entry={entry} /><span>范围、类型和关系计数均来自 catalog-preview-v1；旧策展参考图不参与运行时。</span></div>
			<span className="architecture-overview-shortcuts"><button type="button" onClick={onOpenRelations}>直接查看关系图</button><button type="button" onClick={onOpenApi}>查询类型与函数</button></span>
		</footer>
	</div>;
}

export default function ArchitectureWorkspace({
	catalog,
	scopeId,
	onScopeChange,
	onOpenRelations,
	onOpenApi,
	onBack,
	backLabel,
	onOpenSpec,
}: Props) {
	const entry = useMemo(() => catalog.find((item) => item.domain === "ue5_code" && item.subsystem === "project" && item.preview?.format_version === 1) ?? null, [catalog]);
	const scopes = useMemo<PreviewScope[]>(() => {
		if (!entry?.preview) return [{ id: "root", group: null, title: "当前代码事实", nodes: 0, edges: 0, types: [], relations: [] }];
		const counts = new Map<string, number>();
		for (const node of entry.preview.nodes) if (node.group) counts.set(node.group, (counts.get(node.group) ?? 0) + 1);
		const summary = (group: string | null): Pick<PreviewScope, "edges" | "types" | "relations"> => {
			const ids = new Set(entry.preview!.nodes.filter((node) => group === null || node.group === group).map((node) => node.id));
			const edges = entry.preview!.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
			return {
				edges: edges.length,
				types: counted(entry.preview!.nodes.filter((node) => ids.has(node.id)).map((node) => node.type ?? "unknown")),
				relations: counted(edges.map((edge) => edge.type ?? "related")),
			};
		};
		return [
			{ id: "root", group: null, title: "范围总览", nodes: entry.preview.nodes.length, ...summary(null) },
			...(() => {
				const sorted = [...counts].sort(([left], [right]) => left.localeCompare(right));
				const idsByGroup = buildScopeIds(sorted.map(([group]) => group));
				return sorted.map(([group, nodes]) => ({ id: idsByGroup.get(group)!, group, title: groupLabel(group), nodes, ...summary(group) }));
			})(),
		];
	}, [entry]);
	const activeScope = scopes.find((scope) => scope.id === scopeId) ?? scopes[0];
	const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
	const [openPanel, setOpenPanel] = useState<ArchitecturePanel | null>(null);
	const [treeFocusId, setTreeFocusId] = useState(activeScope.id);
	const panelRef = useDialogFocus<HTMLElement>(Boolean(openPanel), () => setOpenPanel(null), openPanel === "scopes" ? '[role="treeitem"][aria-current="page"]' : '[data-dialog-close="true"]');
	const visibleTreeItems = useMemo<VisibleTreeItem[]>(() => scopes.map((scope) => ({ id: scope.id, parentId: scope.id === "root" ? undefined : "root" })), [scopes]);
	const rawElements = useMemo(() => entry?.preview && activeScope.group !== null ? architectureScopeElements(entry.preview, activeScope.group) : null, [activeScope.group, entry]);
	const elements = useMemo(() => rawElements ? buildLayeredArchitectureGraph(rawElements) : null, [rawElements]);
	const contextNodes = rawElements?.nodes.filter((node) => node.data.architectureContext === true).length ?? 0;
	const isOverview = activeScope.group === null;

	useEffect(() => {
		if (activeScope.id !== scopeId) onScopeChange(activeScope.id);
	}, [activeScope.id, onScopeChange, scopeId]);
	useEffect(() => {
		setSelected(null);
		setOpenPanel(null);
		setTreeFocusId(activeScope.id);
	}, [activeScope.id]);

	const selectScope = (next: string) => {
		if (!scopes.some((scope) => scope.id === next)) return;
		setOpenPanel(null);
		onScopeChange(next);
	};
	const onTreeKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
		const tree = event.currentTarget;
		const current = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
		if (!current) return;
		const currentIndex = visibleTreeItems.findIndex((item) => item.id === current.dataset.scopeId);
		const nextIndex = nextTreeItemIndex(visibleTreeItems, currentIndex, event.key);
		if (nextIndex === null) return;
		event.preventDefault();
		const nextId = visibleTreeItems[nextIndex].id;
		setTreeFocusId(nextId);
		requestAnimationFrame(() => tree.querySelector<HTMLElement>(`[data-scope-id="${CSS.escape(nextId)}"]`)?.focus());
	};
	const openSelected = (node: Record<string, unknown>) => {
		if (SPEC_NODE_TYPES.has(String(node.type ?? ""))) onOpenSpec(node);
	};

	return <section className={`architecture-workspace mindmap-code architecture-current-projection${isOverview ? " is-overview" : " is-scope"}`} aria-labelledby="architecture-workspace-title">
		<main className="architecture-stage" data-active-scope={activeScope.id} data-projection-format="catalog-preview-v1">
			<div className={`mindmap-canvas${isOverview ? " is-overview" : ""}`}>
				{!entry ? <div className="mm-error" role="alert">没有可验证的活动项目图；架构视图不会回退到已归档参考图。</div> : null}
				{entry && isOverview ? <ArchitectureScopeOverview entry={entry} scopes={scopes} onSelect={selectScope} onOpenRelations={onOpenRelations} onOpenApi={onOpenApi} /> : null}
				{entry && !isOverview && elements ? <AsyncSurface label="正在排列当前代码事实" detail="当前代码架构投影没有成功显示。" icon="graph" variant="workspace" resetKey={`catalog-preview:${entry.file}:${activeScope.id}`} onExit={onBack}>
					<GraphView elements={elements} domain="ue5_code" onSelect={setSelected} onNodeDblTap={openSelected} viewportKey={`catalog-preview:${entry.file}:${activeScope.id}`} layoutMode="hierarchy" compactNodes />
				</AsyncSurface> : null}
			</div>

			<header className="architecture-commandbar">
				<div className="architecture-title-lockup"><AppIcon name="graph" size={19} /><span><small>活动源码投影</small><h2 id="architecture-workspace-title">架构浏览器</h2></span></div>
				<button type="button" className={`architecture-scope-trigger${openPanel === "scopes" ? " is-open" : ""}`} aria-expanded={openPanel === "scopes"} aria-controls="architecture-scope-panel" aria-haspopup="dialog" onClick={(event) => { event.currentTarget.focus(); setOpenPanel((value) => value === "scopes" ? null : "scopes"); }}>
					<AppIcon name="route" size={17} /><span><small>当前范围</small><b>{activeScope.title}</b></span><i aria-hidden="true">⌄</i>
				</button>
				<div className="architecture-compact-metrics" aria-label="当前范围摘要">{isOverview ? <><span><b>{activeScope.nodes}</b> 节点</span><span><b>{activeScope.edges}</b> 关系</span><span><b>{Math.max(0, scopes.length - 1)}</b> 分组</span></> : <><span><b>{activeScope.nodes}</b> 范围节点</span><span><b>{contextNodes}</b> 外部上下文</span><span><b>{rawElements?.edges.length ?? 0}</b> 关系</span></>}</div>
				<div className="architecture-explore-switch" role="tablist" aria-label="探索方式" onKeyDown={handleRovingTabKeyDown}>
					<button type="button" role="tab" aria-selected="true" tabIndex={rovingTabStop(true)} className="active">架构</button>
					<button type="button" role="tab" aria-selected="false" tabIndex={-1} onClick={onOpenRelations}>关系</button>
					<button type="button" role="tab" aria-selected="false" tabIndex={-1} onClick={onOpenApi}>API</button>
				</div>
				<div className="architecture-command-actions">
					<button type="button" className={`architecture-tool-button${openPanel === "legend" ? " is-open" : ""}`} aria-label="打开关系图例" aria-expanded={openPanel === "legend"} aria-controls="architecture-legend-panel" aria-haspopup="dialog" onClick={(event) => { event.currentTarget.focus(); setOpenPanel((value) => value === "legend" ? null : "legend"); }}><AppIcon name="link" size={16} /><span>图例</span></button>
					<button type="button" className="architecture-tool-button architecture-back" aria-label={backLabel} onClick={onBack}><AppIcon name="back" size={16} /><span>{backLabel}</span></button>
				</div>
			</header>

			{!isOverview ? <div className="architecture-current-source" role="note"><strong>{activeScope.title}</strong><span>{activeScope.nodes} 个范围节点 · {contextNodes} 个直接外部上下文；关系仍来自活动 catalog-preview-v1。</span></div> : null}
			{openPanel ? <button type="button" className="architecture-overlay-dismiss" aria-hidden="true" tabIndex={-1} onClick={() => setOpenPanel(null)} /> : null}
			{openPanel === "scopes" ? <section ref={panelRef} id="architecture-scope-panel" className="architecture-overlay-panel architecture-scope-panel" role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby="architecture-scope-panel-title">
				<header className="architecture-panel-head"><div><small>来自已有 group 字段</small><h3 id="architecture-scope-panel-title">选择浏览范围</h3></div><button type="button" data-dialog-close="true" aria-label="关闭范围面板" onClick={() => setOpenPanel(null)}>×</button></header>
				<p className="architecture-scope-description">范围只筛选已有节点与关系，不创建新的架构事实。</p>
				<nav className="architecture-scope-tree" aria-label="全部架构范围" role="tree" onKeyDown={onTreeKeyDown}>
					{scopes.map((scope) => <button key={scope.id} type="button" className={scope.id === activeScope.id ? "current" : ""} aria-current={scope.id === activeScope.id ? "page" : undefined} aria-level={scope.id === "root" ? 1 : 2} aria-expanded={scope.id === "root" ? true : undefined} tabIndex={scope.id === treeFocusId ? 0 : -1} data-scope-id={scope.id} data-depth={scope.id === "root" ? 0 : 1} data-has-children={scope.id === "root" ? "true" : "false"} role="treeitem" onFocus={() => setTreeFocusId(scope.id)} onClick={() => selectScope(scope.id)}><i className="architecture-scope-node-icon" aria-hidden="true">{scope.id === "root" ? "▾" : "·"}</i><span>{scope.title}</span><small>{scope.nodes}</small></button>)}
				</nav>
			</section> : null}
			{openPanel === "legend" ? <section ref={panelRef} id="architecture-legend-panel" className="architecture-overlay-panel architecture-legend-panel" role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby="architecture-legend-title">
				<header className="architecture-panel-head"><div><small>规范化关系</small><h3 id="architecture-legend-title">关系语义</h3></div><button type="button" data-dialog-close="true" aria-label="关闭关系图例" onClick={() => setOpenPanel(null)}>×</button></header>
				<div className="mindmap-relation-legend"><span className="is-hold"><b>◆</b>持有 / 组合</span><span className="is-flow"><b>▶</b>生命周期</span><span className="is-wire"><b>◇</b>依赖</span><span className="is-type"><b>△</b>继承 / 实现</span></div>
			</section> : null}
			{selected ? <aside className="architecture-selection-card" aria-label="所选架构节点详情"><button type="button" className="architecture-selection-close" aria-label="关闭节点详情" onClick={() => setSelected(null)}>×</button><div className="mindmap-selection"><b>{String(selected.label ?? selected.id)}</b><span>{String(selected.group ?? selected.type ?? "代码事实")}</span>{SPEC_NODE_TYPES.has(String(selected.type ?? "")) ? <button type="button" onClick={() => openSelected(selected)}>打开只读类详情</button> : null}</div></aside> : null}
		</main>
	</section>;
}
