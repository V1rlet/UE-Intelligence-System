import { useEffect, useMemo, useState } from "react";
import type { ChangeReport, ChangeNodeSummary, ChangeEdgeSummary } from "../../../core/query/change-report";
import {
	normalizeChangeReportCatalogResponse,
	type ChangeReportCatalog,
} from "../../../core/query/change-report-catalog";
import {
	changeReportQueryIndex,
	type ChangeRelationEvidence,
} from "../../../core/query/change-report-query";
import { ueNodeTypeShortLabel } from "../../../core/schema/ue-naming";
import { apiFetchJson } from "../../src/apiFetch";
import {
	DEFAULT_CHANGE_EVIDENCE_ROUTE,
	normalizeChangeRouteForCatalog,
	normalizeChangeRouteForReport,
	type ChangeEvidenceRoute,
	type ChangeRouteDiagnostic,
	type ChangeRouteFact,
	type ChangeRouteResolution,
	type ChangeRouteScope,
	type ChangeRouteTab,
} from "../../src/appRoute";
import AppIcon from "../common/AppIcon";
import { orientCodeTypeRelationForReading, relationPresentation } from "../graph-view/relationPresentation";

type ChangeTab = ChangeRouteTab;
type FactKind = ChangeRouteFact;
type NodeScope = ChangeRouteScope;

interface Props {
	route: ChangeEvidenceRoute;
	diagnostics: ChangeRouteDiagnostic[];
	onRouteChange: (route: ChangeEvidenceRoute) => void;
	onRouteResolution: (resolution: ChangeRouteResolution) => void;
	onDismissDiagnostics: () => void;
	onExplore: () => void;
	onOpenNode: (id: string) => void;
}

const LIMIT = 120;
const EMPTY_CATALOG: ChangeReportCatalog = { format_version: 1, default_report: null, reports: [] };
const EMPTY_RELATION_EVIDENCE = new Map<string, readonly ChangeRelationEvidence[]>();
const EMPTY_NODE_LABELS = new Map<string, string>();
const FIELD_LABELS = new Map([
	["api", "API 声明"], ["description", "说明"], ["module", "模块"], ["parent", "所属类型"],
	["source_path", "源码路径"], ["inheritance_chain", "继承链"], ["data_members", "数据成员"], ["delegates", "委托"],
	["cpp_declarations", "C++ 声明"],
]);

function relationEvidencePresentation(edge: ChangeEdgeSummary, nodeLabels: ReadonlyMap<string, string>) {
	const oriented = orientCodeTypeRelationForReading({ data: { ...edge } }, "ue5_code");
	const semantic = relationPresentation(edge.relation);
	const source = String(oriented.data.source);
	const target = String(oriented.data.target);
	return {
		...semantic,
		label: String(oriented.data.label ?? semantic.label),
		source,
		target,
		sourceLabel: nodeLabels.get(source) ?? source,
		targetLabel: nodeLabels.get(target) ?? target,
	};
}

function dateTime(value: string | null): string {
	if (!value) return "时间未知";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function shortHash(value: string | null): string {
	return value ? `${value.slice(0, 10)}…${value.slice(-6)}` : "无可验证指纹";
}

function NodeRows({ nodes, removed, evidenceByNode, nodeLabels, expandedId, onToggleEvidence, onOpenNode }: {
	nodes: readonly ChangeNodeSummary[];
	removed?: boolean;
	evidenceByNode: ReadonlyMap<string, readonly ChangeRelationEvidence[]>;
	nodeLabels: ReadonlyMap<string, string>;
	expandedId: string | null;
	onToggleEvidence: (id: string) => void;
	onOpenNode: (id: string) => void;
}) {
	if (nodes.length === 0) return <p className="changes-empty">此类别没有节点变化。</p>;
	return <div className="change-rows">
		{nodes.slice(0, LIMIT).map((node) => {
			const relationEvidence = evidenceByNode.get(node.id) ?? [];
			const evidenceCount = relationEvidence.length + (node.changed_fields?.length ?? 0);
			const expanded = expandedId === node.id;
			return <article className={`change-row-card${expanded ? " expanded" : ""}`} key={node.id}>
				<div className="change-row">
					<span className="change-kind">{node.type}</span>
					<span className="change-identity"><strong>{node.label || node.id}</strong><code>{node.id}</code></span>
					<span className="change-meta">{node.module ?? "未归属模块"}{node.source_path ? ` · ${node.source_path}` : ""}</span>
					<span className="change-row-actions">
						<button type="button" aria-expanded={expanded} onClick={() => onToggleEvidence(node.id)}>证据{evidenceCount ? ` ${evidenceCount}` : ""}</button>
						<button type="button" disabled={removed} title={removed ? "该节点不在当前快照中" : "在关系图中查看规范一跳邻域"} onClick={() => onOpenNode(node.id)}>{removed ? "已移除" : "看一跳"}</button>
					</span>
				</div>
				{expanded ? <div className="change-row-evidence">
					<div><small>节点证据</small><strong>{node.module ?? "未归属模块"} · {ueNodeTypeShortLabel(node.type)}</strong><code>{node.source_path ?? node.id}</code></div>
					<div><small>变化字段</small>{node.changed_fields?.length ? <span className="change-evidence-chips">{node.changed_fields.map((field) => <i key={field}>{FIELD_LABELS.get(field) ?? field}</i>)}</span> : <span className="change-evidence-none">新增或移除节点没有字段级前后差异。</span>}</div>
					<div><small>变化关系</small>{relationEvidence.length ? <ul>{relationEvidence.slice(0, 8).map(({ kind, edge }) => {
						const presentation = relationEvidencePresentation(edge, nodeLabels);
						return <li data-motion={presentation.motion} title={`规范边 ${edge.id}`} key={`${kind}:${edge.id}`}>
							<em data-kind={kind}>{kind === "added" ? "新增" : kind === "removed" ? "移除" : "修改"}</em>
							<span className="change-relation-node"><strong>{presentation.sourceLabel}</strong>{presentation.sourceLabel !== presentation.source ? <code>{presentation.source}</code> : null}</span>
							<span className="change-relation-semantic"><i>{presentation.icon}</i><b>{presentation.label}</b><span>→</span></span>
							<span className="change-relation-node"><strong>{presentation.targetLabel}</strong>{presentation.targetLabel !== presentation.target ? <code>{presentation.target}</code> : null}</span>
						</li>;
					})}</ul> : <span className="change-evidence-none">本报告没有与该节点直接相连的变化关系；完整一跳由关系图从规范边解析。</span>}</div>
				</div> : null}
			</article>;
		})}
		{nodes.length > LIMIT ? <p className="changes-limit">为保持阅读性能，仅显示前 {LIMIT} 项；完整数据保留在版本化报告中。</p> : null}
	</div>;
}

function EdgeRows({ edges, nodeLabels }: { edges: ChangeEdgeSummary[]; nodeLabels: ReadonlyMap<string, string> }) {
	if (edges.length === 0) return <p className="changes-empty">此类别没有关系变化。</p>;
	return <div className="change-edge-rows">
		{edges.slice(0, LIMIT).map((edge) => {
			const presentation = relationEvidencePresentation(edge, nodeLabels);
			return <article className="change-edge-row" data-motion={presentation.motion} title={`规范边 ${edge.id}`} key={edge.id}>
				<span className="change-relation-node"><strong>{presentation.sourceLabel}</strong>{presentation.sourceLabel !== presentation.source ? <code>{presentation.source}</code> : null}</span>
				<span className="change-relation-semantic"><i>{presentation.icon}</i><b>{presentation.label}</b><span>→</span></span>
				<span className="change-relation-node"><strong>{presentation.targetLabel}</strong>{presentation.targetLabel !== presentation.target ? <code>{presentation.target}</code> : null}</span>
				{edge.changed_fields?.length ? <small>{edge.changed_fields.map((field) => FIELD_LABELS.get(field) ?? field).join("、")}</small> : null}
			</article>;
		})}
		{edges.length > LIMIT ? <p className="changes-limit">仅显示前 {LIMIT} 条关系；完整数据保留在报告中。</p> : null}
	</div>;
}

export default function ChangesView({ route, diagnostics, onRouteChange, onRouteResolution, onDismissDiagnostics, onExplore, onOpenNode }: Props) {
	const [catalog, setCatalog] = useState<ChangeReportCatalog>(EMPTY_CATALOG);
	const [reportSnapshot, setReportSnapshot] = useState<{ file: string; value: ChangeReport } | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const selectedFile = catalog.reports.length > 0
		? route.report && catalog.reports.some((entry) => entry.file === route.report) ? route.report : catalog.default_report ?? ""
		: "";
	const report = reportSnapshot?.file === selectedFile ? reportSnapshot.value : null;
	const reportIndex = useMemo(() => report ? changeReportQueryIndex(report) : null, [report]);
	const tab: ChangeTab = route.tab;
	const factKind: FactKind = route.fact;
	const nodeScope: NodeScope = route.scope;
	const nodeTypeFilter = route.nodeType ?? "";
	const expandedEvidenceId = route.node;
	const updateRoute = (patch: Partial<ChangeEvidenceRoute>) => onRouteChange({
		...route,
		report: selectedFile || route.report,
		module: route.module ?? (reportIndex ? reportIndex.preferredModule || "*" : null),
		...patch,
	});

	useEffect(() => {
		const controller = new AbortController();
		setLoading(true);
		void apiFetchJson<unknown>("/api/change-reports", { signal: controller.signal }, { context: "读取变化目录" })
			.then((response) => {
				const nextCatalog = normalizeChangeReportCatalogResponse(response);
				setCatalog(nextCatalog);
				if (nextCatalog.reports.length === 0) setLoading(false);
			})
			.catch((reason) => {
				if ((reason as Error).name !== "AbortError") { setError((reason as Error).message); setLoading(false); }
			});
		return () => controller.abort();
	}, []);

	useEffect(() => {
		if (catalog.reports.length === 0) return;
		const resolution = normalizeChangeRouteForCatalog(route, catalog);
		if (resolution.route !== route || resolution.diagnostics.length > 0) onRouteResolution(resolution);
	}, [catalog, onRouteResolution, route]);

	useEffect(() => {
		if (!selectedFile) { setReportSnapshot(null); return; }
		const controller = new AbortController();
		setLoading(true);
		setError("");
		void apiFetchJson<ChangeReport>(`/api/change-reports/${encodeURIComponent(selectedFile)}`, { signal: controller.signal }, { context: "读取变化报告" })
			.then((value) => {
				setReportSnapshot({ file: selectedFile, value });
				setLoading(false);
			})
			.catch((reason) => {
				if ((reason as Error).name !== "AbortError") { setError((reason as Error).message); setLoading(false); }
			});
		return () => controller.abort();
	}, [selectedFile]);

	useEffect(() => {
		if (!reportIndex) return;
		const resolution = normalizeChangeRouteForReport(route, reportIndex);
		if (resolution.route !== route || resolution.diagnostics.length > 0) onRouteResolution(resolution);
	}, [onRouteResolution, reportIndex, route]);

	const selectedEntry = useMemo(() => catalog.reports.find((entry) => entry.file === selectedFile) ?? null, [catalog, selectedFile]);
	const moduleFilter = route.module === "*" ? "" : route.module ?? reportIndex?.preferredModule ?? "";
	const tabData = report ? {
		added: { nodes: report.changes.added_nodes, edges: report.changes.added_edges },
		changed: { nodes: report.changes.changed_nodes, edges: report.changes.changed_edges },
		removed: { nodes: report.changes.removed_nodes, edges: report.changes.removed_edges },
	} : null;
	const changeData = tab !== "impact" ? tabData?.[tab] ?? null : null;
	const moduleOptions = reportIndex?.modules ?? [];
	const nodeSelection = useMemo(() => reportIndex?.selectNodes({ tab, scope: nodeScope, module: route.module, nodeType: route.nodeType }) ?? {
		scopedNodes: [], visibleNodes: [], nodeTypeCounts: [], changedFieldCounts: [],
	}, [nodeScope, reportIndex, route.module, route.nodeType, tab]);
	const { scopedNodes, visibleNodes, nodeTypeCounts, changedFieldCounts } = nodeSelection;
	const relationEvidenceByNode = reportIndex?.relationEvidenceByNode ?? EMPTY_RELATION_EVIDENCE;
	const nodeLabels = reportIndex?.nodeLabels ?? EMPTY_NODE_LABELS;

	const selectTab = (nextTab: ChangeTab) => {
		updateRoute({ tab: nextTab, nodeType: null, node: null });
	};

	return <section className="changes-view" aria-labelledby="changes-title">
		<header className="changes-hero">
			<div>
				<span className="changes-eyebrow"><AppIcon name="history" size={16} /> VERSIONED EVIDENCE · READ ONLY</span>
				<h1 id="changes-title">代码变化</h1>
				<p>比较两份提取后的代码事实快照；不是 Git 文本差异，也不持有计划、任务或实现状态。</p>
			</div>
			<div className="changes-actions">
				{catalog.reports.length > 1 ? <label><span>比较报告</span><select value={selectedFile} onChange={(event) => onRouteChange({ ...DEFAULT_CHANGE_EVIDENCE_ROUTE, report: event.target.value })}>{catalog.reports.map((entry) => <option value={entry.file} key={entry.file}>{entry.subsystem} · {dateTime(entry.generated_at)}</option>)}</select></label> : null}
				<button type="button" className="changes-explore" onClick={onExplore}><AppIcon name="graph" size={16} />进入探索</button>
			</div>
		</header>

		{diagnostics.length > 0 ? <aside className="changes-route-diagnostics" role="status" aria-live="polite">
			<AppIcon name="warning" size={18} />
			<div><strong>变化链接已安全校正</strong>{diagnostics.map((item) => <p key={`${item.code}:${item.requested}`}><b>{item.title}</b><span>{item.detail}</span><code>{item.requested}</code></p>)}</div>
			<button type="button" onClick={onDismissDiagnostics}>知道了</button>
		</aside> : null}

		{loading ? <div className="changes-state"><span className="loading-spinner" />正在整理变化证据…</div> : null}
		{error ? <div className="changes-state error" role="alert"><AppIcon name="warning" />{error}</div> : null}
		{!loading && !error && catalog.reports.length === 0 ? <div className="changes-state empty"><AppIcon name="history" size={28} /><strong>还没有版本化变化报告</strong><p>先保留一份基线快照，再运行 <code>npm run build:change-report</code>。报告只读，不会改写代码图。</p></div> : null}

		{report && selectedEntry && !loading ? <>
			<section className="changes-provenance" aria-label="比较来源">
				<div className={report.baseline.fingerprint ? "verified" : "unverified"}><span>基线</span><strong>{report.baseline.file}</strong><code>{shortHash(report.baseline.fingerprint)}</code><small>{dateTime(report.baseline.generated_at)}{report.baseline.fingerprint ? " · 来源指纹可追溯" : " · 旧格式基线，不能证明来源完整性"}</small></div>
				<AppIcon name="arrow" size={22} />
				<div className={report.current.fingerprint ? "verified" : "unverified"}><span>当前</span><strong>{report.current.file}</strong><code>{shortHash(report.current.fingerprint)}</code><small>{dateTime(report.current.generated_at)}{report.current.fingerprint ? " · 与活动图指纹一致" : " · 来源未验证"}</small></div>
			</section>

			<section className="changes-summary" aria-label="变化摘要">
				<article><span>节点</span><strong><i>+{report.summary.nodes.added}</i><i>~{report.summary.nodes.changed}</i><i>−{report.summary.nodes.removed}</i></strong><small>直接事实变化</small></article>
				<article><span>关系</span><strong><i>+{report.summary.edges.added}</i><i>~{report.summary.edges.changed}</i><i>−{report.summary.edges.removed}</i></strong><small>规范化边变化</small></article>
				<article><span>直接节点</span><b>{report.summary.direct_nodes.toLocaleString()}</b><small>新增、修改或移除</small></article>
				<article><span>一跳影响</span><b>{report.summary.affected_nodes.toLocaleString()}</b><small>{report.summary.affected_modules} 个模块；关系推导，非实现结论</small></article>
			</section>

			<div className="changes-tabs" role="tablist" aria-label="变化类别">
				{([
					{ id: "added", label: "新增", nodes: report.summary.nodes.added, edges: report.summary.edges.added },
					{ id: "changed", label: "修改", nodes: report.summary.nodes.changed, edges: report.summary.edges.changed },
					{ id: "removed", label: "移除", nodes: report.summary.nodes.removed, edges: report.summary.edges.removed },
				] as Array<{ id: ChangeTab; label: string; nodes: number; edges: number }>).map((item) => <button type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? "active" : ""} onClick={() => selectTab(item.id)} key={item.id}><span>{item.label}</span><small>{item.nodes} 节点 · {item.edges} 关系</small></button>)}
				<button type="button" role="tab" aria-selected={tab === "impact"} className={tab === "impact" ? "active" : ""} onClick={() => selectTab("impact")}><span>影响</span><small>{report.summary.affected_nodes} 个一跳节点</small></button>
			</div>

			<section className="changes-detail">
				{changeData ? <>
					<div className="changes-fact-toolbar" aria-label="变化事实筛选">
						<div className="changes-fact-switch" role="group" aria-label="事实种类">
							<button type="button" className={factKind === "nodes" ? "active" : ""} aria-pressed={factKind === "nodes"} onClick={() => updateRoute({ fact: "nodes", node: null })}>节点 <b>{changeData.nodes.length}</b></button>
							<button type="button" className={factKind === "edges" ? "active" : ""} aria-pressed={factKind === "edges"} onClick={() => updateRoute({ fact: "edges", node: null })}>关系 <b>{changeData.edges.length}</b></button>
						</div>
						{factKind === "nodes" ? <>
							<div className="changes-scope-switch" role="group" aria-label="节点范围">
								{([['code', '代码'], ['structure', '结构'], ['all', '全部']] as Array<[NodeScope, string]>).map(([id, label]) => <button type="button" className={nodeScope === id ? "active" : ""} aria-pressed={nodeScope === id} onClick={() => updateRoute({ scope: id, nodeType: null, node: null })} key={id}>{label}</button>)}
							</div>
							{moduleOptions.length > 1 ? <label className="changes-module-filter"><span>模块</span><select value={moduleFilter} onChange={(event) => updateRoute({ module: event.target.value || "*", nodeType: null, node: null })}><option value="">全部模块</option>{moduleOptions.map((module) => <option value={module} key={module}>{module}</option>)}</select></label> : null}
						</> : <span className="changes-toolbar-note">关系由稳定 source / relation / target 表达</span>}
					</div>
					{factKind === "nodes" ? <>
						{nodeTypeCounts.length > 1 ? <div className="changes-type-facets" role="group" aria-label="节点类型切片"><button type="button" className={!nodeTypeFilter ? "active" : ""} aria-pressed={!nodeTypeFilter} onClick={() => updateRoute({ nodeType: null, node: null })}>全部 <b>{scopedNodes.length}</b></button>{nodeTypeCounts.map(([type, count]) => <button type="button" className={nodeTypeFilter === type ? "active" : ""} aria-pressed={nodeTypeFilter === type} onClick={() => updateRoute({ nodeType: type, node: null })} key={type}>{ueNodeTypeShortLabel(type)} <b>{count}</b></button>)}</div> : null}
						{tab === "changed" && changedFieldCounts.length ? <div className="changes-field-summary" aria-label="字段变化摘要"><small>字段变化</small>{changedFieldCounts.map(([field, count]) => <span key={field}>{FIELD_LABELS.get(field) ?? field}<b>{count}</b></span>)}</div> : null}
						<div className="changes-section-head"><div><span>节点变化</span><small>默认聚焦类型与函数；目录和文件收进“结构”范围</small></div><b>{visibleNodes.length}{visibleNodes.length !== changeData.nodes.length ? ` / ${changeData.nodes.length}` : ""}</b></div>
						<NodeRows nodes={visibleNodes} removed={tab === "removed"} evidenceByNode={relationEvidenceByNode} nodeLabels={nodeLabels} expandedId={expandedEvidenceId} onToggleEvidence={(id) => updateRoute({ node: expandedEvidenceId === id ? null : id })} onOpenNode={onOpenNode} />
					</> : <>
						<div className="changes-section-head"><div><span>关系变化</span><small>source / relation / target</small></div><b>{changeData.edges.length}</b></div>
						<EdgeRows edges={changeData.edges} nodeLabels={nodeLabels} />
					</>}
				</> : null}
				{tab === "impact" ? <div className="impact-layout">
					<section><div className="changes-section-head"><div><span>模块影响</span><small>直接变化与一跳邻居分开计数</small></div><b>{report.impact.modules.length}</b></div><div className="impact-modules">{report.impact.modules.map((item) => <article key={item.module}><strong>{item.module}</strong><span><b>{item.direct}</b> 直接</span><span><b>{item.affected}</b> 一跳</span></article>)}</div></section>
					<section><div className="changes-section-head"><div><span>一跳节点</span><small>由当前与基线的规范化关系共同推导</small></div><b>{report.impact.affected_node_ids.length}</b></div><div className="impact-nodes">{report.impact.affected_node_ids.slice(0, LIMIT).map((id) => <button type="button" onClick={() => onOpenNode(id)} key={id}><code>{id}</code><span>定位</span></button>)}</div></section>
				</div> : null}
			</section>
		</> : null}
	</section>;
}
