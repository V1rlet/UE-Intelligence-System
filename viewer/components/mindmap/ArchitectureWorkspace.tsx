// Graph Brain / viewer - 代码分区内可钻取、可深链恢复的架构工作页。
// 当前画布只展示当前 scope 的直接子系统与本层关系；双击子系统进入内部。
import { lazy, useEffect, useMemo, useState, type CSSProperties } from "react";
import AppIcon from "../common/AppIcon";
import type { GraphElements } from "../graph-view/GraphView";
import type { GraphCatalogEntry } from "../../src/graphCatalog";
import { loadGraphFile } from "../../src/loadGraphFile";
import { buildLayeredArchitectureGraph, mindmapRelationLabel } from "./mindmapForest";
import { AsyncSurface } from "../common/AsyncSurface";
import "../../styles/architecture-workspace.css";

const GraphView = lazy(() => import("../graph-view/GraphView"));

interface InterfacePoint {
	direction: "in" | "out";
	relation: string;
	peerScope: string;
	peerNode: string;
	peerLabel: string;
}

interface SourceEvidence {
	path: string;
	symbol: string;
	line: number;
	claim: string;
}

interface ArchitectureScope {
	id: string;
	title: string;
	description?: string;
	parentScope?: string;
	domain?: string;
	sourceDocuments?: string[];
	elements: GraphElements;
}

interface MindmapFile {
	meta?: {
		title?: string;
		rootScope?: string;
		scopes?: Record<string, ArchitectureScope>;
	};
	elements: GraphElements;
}

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

function scopeTrail(scopes: Record<string, ArchitectureScope>, scopeId: string): ArchitectureScope[] {
	const trail: ArchitectureScope[] = [];
	const seen = new Set<string>();
	let current: ArchitectureScope | undefined = scopes[scopeId];
	while (current && !seen.has(current.id)) {
		trail.unshift(current);
		seen.add(current.id);
		current = current.parentScope ? scopes[current.parentScope] : undefined;
	}
	return trail;
}

interface ScopeNavigationItem {
	scope: ArchitectureScope;
	depth: number;
	childCount: number;
	/** 每一项对应从根到当前节点的分支；true 表示该层后面还有兄弟节点。 */
	branchContinuations: boolean[];
}

function scopeNavigation(scopes: Record<string, ArchitectureScope>, rootScopeId: string): ScopeNavigationItem[] {
	const children = new Map<string, ArchitectureScope[]>();
	const compareScopes = (a: ArchitectureScope, b: ArchitectureScope) => a.title.localeCompare(b.title, "zh-CN") || a.id.localeCompare(b.id);
	for (const scope of Object.values(scopes)) {
		if (!scope.parentScope || !scopes[scope.parentScope]) continue;
		children.set(scope.parentScope, [...(children.get(scope.parentScope) ?? []), scope]);
	}
	for (const [parentId, childScopes] of children) children.set(parentId, childScopes.sort(compareScopes));

	const result: ScopeNavigationItem[] = [];
	const visited = new Set<string>();
	const append = (scope: ArchitectureScope, depth: number, branchContinuations: boolean[] = []) => {
		if (visited.has(scope.id)) return;
		visited.add(scope.id);
		const childScopes = children.get(scope.id) ?? [];
		result.push({ scope, depth, childCount: childScopes.length, branchContinuations });
		childScopes.forEach((childScope, index) => {
			append(childScope, depth + 1, [...branchContinuations, index < childScopes.length - 1]);
		});
	};
	if (scopes[rootScopeId]) append(scopes[rootScopeId], 0);
	for (const scope of Object.values(scopes).sort(compareScopes)) append(scope, 0);
	return result;
}

function relationLabel(relation: string): string {
	return mindmapRelationLabel(relation);
}

const SPEC_NODE_TYPES = new Set(["uclass", "uactor", "ucomponent", "uinterface", "ustruct", "uenum"]);
type ArchitecturePanel = "scopes" | "legend";

export default function ArchitectureWorkspace({ catalog, scopeId, onScopeChange, onOpenRelations, onOpenApi, onBack, backLabel, onOpenSpec }: Props) {
	const file = useMemo(
		() => catalog
			.filter((entry) => entry.kind === "mindmap" && entry.domain === "ue5_code")
			.sort((a, b) => b.file.localeCompare(a.file))[0]?.file ?? null,
		[catalog],
	);
	const [data, setData] = useState<MindmapFile | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
	const [openPanel, setOpenPanel] = useState<ArchitecturePanel | null>(null);

	useEffect(() => {
		setData(null);
		setSelected(null);
		setError(null);
		if (!file) {
			setError("还没有架构脑图数据。运行 npm run build:mindmap 生成分层职责树。");
			return;
		}
		const controller = new AbortController();
		loadGraphFile<MindmapFile>(file, { signal: controller.signal, context: "架构脑图" })
			.then((payload: MindmapFile) => {
				if (!payload.meta?.scopes) throw new Error("脑图仍是旧版平铺数据，请重新运行 npm run build:mindmap");
				setData(payload);
			})
			.catch((reason) => {
				if ((reason as Error).name !== "AbortError") setError(`加载脑图失败：${String((reason as Error).message ?? reason)}`);
			});
		return () => controller.abort();
	}, [file]);

	const scopes = data?.meta?.scopes ?? {};
	const rootScopeId = data?.meta?.rootScope ?? "root";
	const activeScopeId = scopes[scopeId] ? scopeId : rootScopeId;
	const scope = scopes[activeScopeId];
	const trail = useMemo(() => scopeTrail(scopes, activeScopeId), [scopes, activeScopeId]);
	const navigationItems = useMemo(() => scopeNavigation(scopes, rootScopeId), [rootScopeId, scopes]);
	const childScopeCount = navigationItems.find((item) => item.scope.id === activeScopeId)?.childCount ?? 0;
	const interfaces = (selected?.interfaces as InterfacePoint[] | undefined) ?? [];
	const evidence = (selected?.sourceEvidence as SourceEvidence[] | undefined) ?? [];
	const isExecutionNode = Boolean(selected?.executionNode);
	const drillScope = selected?.drillScope ? String(selected.drillScope) : null;
	const selectedCanOpenSpec = selected ? SPEC_NODE_TYPES.has(String(selected.type ?? "")) : false;
	const title = "代码架构";
	const architectureElements = useMemo(() => scope ? buildLayeredArchitectureGraph(scope.elements) : null, [scope]);

	useEffect(() => {
		if (!data || !scopes[rootScopeId] || activeScopeId === scopeId) return;
		onScopeChange(activeScopeId);
	}, [activeScopeId, data, onScopeChange, rootScopeId, scopeId, scopes]);

	useEffect(() => {
		setSelected(null);
		setOpenPanel(null);
	}, [activeScopeId]);

	useEffect(() => {
		if (!openPanel) return;
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpenPanel(null);
		};
		window.addEventListener("keydown", closeOnEscape);
		return () => window.removeEventListener("keydown", closeOnEscape);
	}, [openPanel]);

	const enterScope = (nextScope: string) => {
		if (!scopes[nextScope]) return;
		setOpenPanel(null);
		onScopeChange(nextScope);
	};
	const togglePanel = (panel: ArchitecturePanel) => {
		setOpenPanel((current) => current === panel ? null : panel);
	};
	const openNode = (node: Record<string, unknown>) => {
		const next = node.drillScope ? String(node.drillScope) : "";
		if (next) enterScope(next);
		else if (SPEC_NODE_TYPES.has(String(node.type ?? ""))) onOpenSpec(node);
	};

	return (
			<section className="architecture-workspace mindmap-code" aria-labelledby="architecture-workspace-title">
				<main className="architecture-stage" data-active-scope={activeScopeId}>
						<div className="mindmap-canvas">
							{error ? <div className="mm-error" role="alert">{error}</div> : null}
							{!error && !scope ? <div className="mm-loading">正在加载分层架构…</div> : null}
							{scope && architectureElements ? (
								<AsyncSurface
									label="正在排列架构关系"
									detail="架构关系图没有成功显示。"
									icon="graph"
									variant="workspace"
									resetKey={`mindmap-graph:${activeScopeId}`}
									onExit={onBack}
								>
									<GraphView
										elements={architectureElements}
										domain={scope.domain ?? "ue5_code"}
										onSelect={setSelected}
										onNodeDblTap={openNode}
										viewportKey={`mindmap:code:${activeScopeId}:layered-relations-v2`}
										layoutMode="hierarchy"
										compactNodes
									/>
								</AsyncSurface>
							) : null}
						</div>

					<header className="architecture-commandbar">
						<div className="architecture-title-lockup">
							<AppIcon name="graph" size={19} />
							<span>
								<small>代码架构</small>
								<h2 id="architecture-workspace-title">架构浏览器</h2>
							</span>
						</div>
						<button
							type="button"
							className={`architecture-scope-trigger${openPanel === "scopes" ? " is-open" : ""}`}
							aria-expanded={openPanel === "scopes"}
							aria-controls="architecture-scope-panel"
							onClick={() => togglePanel("scopes")}
						>
							<AppIcon name="route" size={17} />
							<span><small>当前范围</small><b>{scope?.title ?? data?.meta?.title ?? title}</b></span>
							<i aria-hidden="true">⌄</i>
						</button>
						<div className="architecture-compact-metrics" aria-label="当前范围摘要">
							<span><b>{scope?.elements.nodes.length ?? 0}</b> 节点</span>
							<span><b>{scope?.elements.edges.length ?? 0}</b> 关系</span>
							<span><b>{childScopeCount}</b> 子范围</span>
							{scope?.sourceDocuments?.length ? <span title={scope.sourceDocuments.join("\n")}><b>{scope.sourceDocuments.length}</b> 来源</span> : null}
						</div>
						<div className="architecture-explore-switch" role="tablist" aria-label="探索方式">
							<button type="button" role="tab" aria-selected="true" className="active">架构</button>
							<button type="button" role="tab" aria-selected="false" onClick={onOpenRelations}>关系</button>
							<button type="button" role="tab" aria-selected="false" onClick={onOpenApi}>API</button>
						</div>
						<div className="architecture-command-actions">
							<button
								type="button"
								className={`architecture-tool-button${openPanel === "legend" ? " is-open" : ""}`}
								aria-expanded={openPanel === "legend"}
								aria-controls="architecture-legend-panel"
								onClick={() => togglePanel("legend")}
							>
								<AppIcon name="link" size={16} /><span>图例</span>
							</button>
							<button type="button" className="architecture-tool-button architecture-back" onClick={onBack}>
								<AppIcon name="back" size={16} /><span>{backLabel}</span>
							</button>
						</div>
					</header>

					{openPanel ? (
						<button
							type="button"
							className="architecture-overlay-dismiss"
							aria-label="关闭架构工具面板"
							tabIndex={-1}
							onClick={() => setOpenPanel(null)}
						/>
					) : null}

					{openPanel === "scopes" ? (
						<section id="architecture-scope-panel" className="architecture-overlay-panel architecture-scope-panel" aria-labelledby="architecture-scope-panel-title">
							<header className="architecture-panel-head">
								<div>
									<small>架构层级 · {navigationItems.length} 个职责范围</small>
									<h3 id="architecture-scope-panel-title">选择浏览范围</h3>
								</div>
								<button type="button" aria-label="关闭范围面板" onClick={() => setOpenPanel(null)}>×</button>
							</header>
							<nav className="mindmap-breadcrumb" aria-label="当前架构路径">
								{trail.map((item, index) => (
									<span key={item.id}>
										{index > 0 ? <i>›</i> : null}
										<button className={item.id === activeScopeId ? "current" : ""} onClick={() => enterScope(item.id)}>{item.title}</button>
									</span>
								))}
							</nav>
							<p className="architecture-scope-description">{scope?.description ?? "双击节点进入内部；当前层只维护本层关系。"}</p>
							<nav className="architecture-scope-tree" aria-label="全部架构范围" role="tree">
								{navigationItems.map((item) => (
									<button
										key={item.scope.id}
										type="button"
										className={item.scope.id === activeScopeId ? "current" : ""}
										aria-current={item.scope.id === activeScopeId ? "page" : undefined}
										aria-level={item.depth + 1}
										aria-expanded={item.childCount ? true : undefined}
										data-scope-id={item.scope.id}
										data-depth={item.depth}
										data-has-children={item.childCount ? "true" : "false"}
										role="treeitem"
										style={{
											"--scope-indent": `${16 + item.depth * 18}px`,
										} as CSSProperties}
										title={item.scope.description ?? item.scope.title}
										onClick={() => enterScope(item.scope.id)}
									>
										<span className="architecture-tree-branches" aria-hidden="true">
											{item.branchContinuations.map((continues, level) => {
												const isCurrentBranch = level === item.branchContinuations.length - 1;
												if (!isCurrentBranch && !continues) return null;
												return <i
													key={level}
													className={`architecture-tree-branch${isCurrentBranch ? " is-current" : ""}${continues ? " continues" : ""}`}
													data-segment={isCurrentBranch ? (continues ? "elbow-through" : "elbow-end") : "continuation"}
													data-tone={level % 4}
													style={{ "--branch-level": level } as CSSProperties}
												/>;
											})}
										</span>
										<i className="architecture-scope-node-icon" aria-hidden="true">{item.childCount ? "▾" : "·"}</i>
										<span>{item.scope.title}</span>
										<small>{item.scope.elements.nodes.length}</small>
									</button>
								))}
							</nav>
						</section>
					) : null}

					{openPanel === "legend" ? (
						<section id="architecture-legend-panel" className="architecture-overlay-panel architecture-legend-panel" aria-labelledby="architecture-legend-title">
							<header className="architecture-panel-head">
								<div><small>连线图例</small><h3 id="architecture-legend-title">关系语义</h3></div>
								<button type="button" aria-label="关闭关系图例" onClick={() => setOpenPanel(null)}>×</button>
							</header>
							<div className="mindmap-relation-legend">
								<span className="is-emit"><b>◆</b>创建 / 生成</span>
								<span className="is-hold"><b>⬡</b>持有 / 组合</span>
								<span className="is-flow"><b>▶</b>派发 / 流转</span>
								<span className="is-wire"><b>⚡</b>依赖 / 装配</span>
								<span className="is-type"><b>△</b>继承 / 实现</span>
							</div>
						</section>
					) : null}

					{selected ? (
						<aside className={`architecture-selection-card${isExecutionNode ? " is-execution" : ""}`} aria-label="所选架构节点详情">
							<button type="button" className="architecture-selection-close" aria-label="关闭节点详情" onClick={() => setSelected(null)}>×</button>
							<div className="mindmap-selection">
								<b>{String(selected.label ?? selected.id)}</b>
								<span>{String(selected.description ?? "")}</span>
								{isExecutionNode ? <div className="mindmap-execution-facts">
									<span><i>执行归属</i>{String(selected.affinity ?? "未指定")}</span>
									<span><i>安全边界</i>{String(selected.safetyBoundary ?? "")}</span>
									{evidence.slice(0, 2).map((item) => <code key={`${item.path}:${item.line}`} title={`${item.path}:${item.line}`}>
										{item.symbol} · L{item.line}
									</code>)}
								</div> : null}
							</div>
							<div className="mindmap-ports" aria-label="外部接口点">
								{interfaces.length ? interfaces.slice(0, 8).map((point, index) => (
									<span key={`${point.direction}-${point.relation}-${point.peerNode}-${index}`} className={`mm-port ${point.direction}`}>
										{point.direction === "in" ? "◁" : "▷"} {relationLabel(point.relation)} · {point.peerLabel}
									</span>
								)) : <span className="mm-no-port">本节点没有跨层接口</span>}
							</div>
							{drillScope ? <button className="mindmap-enter" onClick={() => enterScope(drillScope)}>进入内部 ↗</button> : null}
							{!drillScope && selectedCanOpenSpec ? <button className="mindmap-enter" onClick={() => onOpenSpec(selected)}>查看类详情 ↗</button> : null}
						</aside>
					) : null}
				</main>
			</section>
	);
}
