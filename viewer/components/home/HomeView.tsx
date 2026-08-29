import { useMemo, useState } from "react";
import type { GraphCatalogEntry } from "../../src/graphCatalog";
import { evidenceExtractionAge, resolveEvidenceStatus } from "../../src/evidenceStatus";
import { isBrowsableCodeGraph } from "../../src/workspaceModel";
import AppIcon from "../common/AppIcon";
import { GraphWorkspaceSnapshot, WorkspaceSnapshotPlaceholder } from "./WorkspaceSnapshot";

interface Props {
	catalog: GraphCatalogEntry[];
	loaded: boolean;
	refreshing: boolean;
	error: string | null;
	onRefresh: () => void;
	openGraph: (file: string) => void;
	openArchitecture: () => void;
	openApi: () => void;
}

function graphKind(entry: GraphCatalogEntry): string {
	if (entry.kind === "mindmap") return "架构脑图";
	if (entry.kind === "reference") return "参考架构";
	if (entry.subsystem === "project") return "项目源码";
	return "代码事实";
}

const countFormatter = new Intl.NumberFormat("zh-CN");

export default function HomeView({ catalog, loaded, refreshing, error, onRefresh, openGraph, openArchitecture, openApi }: Props) {
	const [query, setQuery] = useState("");
	const browsable = useMemo(() => catalog.filter(isBrowsableCodeGraph), [catalog]);
	const visibleGraphs = useMemo(() => {
		const needle = query.trim().toLocaleLowerCase();
		if (!needle) return browsable;
		return browsable.filter((entry) => [entry.title, entry.subsystem, entry.file, graphKind(entry)]
			.some((value) => value.toLocaleLowerCase().includes(needle)));
	}, [browsable, query]);
	const visibleProjectGraphs = visibleGraphs.filter((entry) => entry.subsystem === "project");
	const visibleReferenceGraphs = visibleGraphs.filter((entry) => entry.subsystem !== "project");
	const projectGraphs = browsable.filter((entry) => entry.subsystem === "project");
	const referenceGraphs = browsable.filter((entry) => entry.subsystem !== "project");
	const primaryProject = projectGraphs[0] ?? null;
	const primaryEvidence = primaryProject ? resolveEvidenceStatus(primaryProject) : null;
	const projectNodes = projectGraphs.reduce((sum, entry) => sum + entry.nodes, 0);
	const projectEdges = projectGraphs.reduce((sum, entry) => sum + entry.edges, 0);

	return (
		<div className="home home-code-viewer" role="region" aria-label="代码架构查看器">
			<header className="home-head home-viewer-head">
				<div className="home-head-main home-title-lockup">
					<span className="home-title-mark"><AppIcon name="graph" size={20} /> 当前代码证据</span>
					<h1>从边界进入代码事实</h1>
					<p className="home-head-summary">先浏览系统分组，再沿关系、类型和函数下钻到源码证据。GraphBrain 只读取已经实现的 UE C++ 事实。</p>
					{primaryProject && primaryEvidence ? <button type="button" className={`home-current-evidence is-${primaryEvidence.tone}`} data-evidence-status={primaryEvidence.tone} onClick={() => openGraph(primaryProject.file)}>
						<AppIcon name={primaryEvidence.icon} size={15} /><span><small>活动工作集</small><strong>{primaryProject.title || "项目源码"}</strong></span><b>{primaryEvidence.compactLabel}</b><AppIcon name="arrow" size={14} />
					</button> : <p className="home-ownership-note">方案与实现工作流由 ClaudeGameStudios 持有。</p>}
					<div className="home-primary-actions" aria-label="主要入口">
						<button type="button" className="primary" onClick={openArchitecture}><AppIcon name="route" size={17} /><span><b>浏览系统边界</b><small>按事实分组进入</small></span><AppIcon name="arrow" size={14} /></button>
						{primaryProject ? <button type="button" onClick={() => openGraph(primaryProject.file)}><AppIcon name="graph" size={17} /><span><b>查看关系</b><small>文件、类型与一跳</small></span><AppIcon name="arrow" size={14} /></button> : null}
						<button type="button" onClick={openApi}><AppIcon name="api" size={17} /><span><b>查询 API</b><small>定位类型与函数</small></span><AppIcon name="arrow" size={14} /></button>
					</div>
				</div>
				<div className="home-head-stats" aria-label="代码事实状态">
					<div className="home-stat-project-nodes"><small>项目节点</small><b>{loaded ? countFormatter.format(projectNodes) : "—"}</b><span>当前源码事实</span></div>
					<div className="home-stat-project-edges"><small>项目关系</small><b>{loaded ? countFormatter.format(projectEdges) : "—"}</b><span>结构与调用</span></div>
					<div className="home-stat-reference-graphs"><small>参考图</small><b>{loaded ? countFormatter.format(referenceGraphs.length) : "—"}</b><span>辅助阅读</span></div>
				</div>
			</header>

			{error ? <div className="home-error" role="alert"><span>代码图目录读取失败：{error}</span><button type="button" disabled={refreshing} onClick={onRefresh}>{refreshing ? "重试中…" : "重试"}</button></div> : null}

			<div className="home-section-head">
				<div><small>由源码提取</small><h2>活动代码证据 <em role="status" aria-live="polite">{!loaded ? "同步中" : query.trim() ? `${visibleGraphs.length} / ${browsable.length} 项` : `${browsable.length} 项`}</em></h2></div>
				<div className="home-catalog-tools">
					{browsable.length > 1 ? <label className="home-catalog-search"><AppIcon name="search" size={16} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选标题、子系统或文件…" aria-label="筛选代码架构图" />{query ? <button type="button" onClick={() => setQuery("")} aria-label="清除筛选">清除</button> : null}</label> : <span className="home-single-source"><AppIcon name="review" size={15} /> 单一活动事实源</span>}
					<button type="button" className="home-refresh" disabled={refreshing} aria-busy={refreshing} aria-label={refreshing ? "正在重新检查代码图目录" : "重新检查代码图目录"} onClick={onRefresh}><AppIcon name="sync" size={17} /> {refreshing ? "检查中…" : "重新检查"}</button>
				</div>
			</div>

			<section className="home-panel home-code-catalog" aria-label="代码架构图">
				{!loaded ? (
					<ul className="home-doc-list gb-stagger" aria-busy="true"><li><button className="home-doc primary" disabled>
						<span className="home-row-index">··</span><span className="home-domain-chip d-ue5_code">源码事实</span>
						<span className="home-card-state is-loading">读取中</span><WorkspaceSnapshotPlaceholder />
						<span className="home-doc-name">正在建立代码图索引…</span><span className="home-doc-meta">只读取 ue5_code 领域</span>
						<span className="home-card-metrics"><i>节点 —</i><i>关系 —</i><i>提取 —</i></span>
					</button></li></ul>
				) : browsable.length === 0 ? (
					<div className="home-empty-success"><AppIcon name="graph" size={22} /><span><b>还没有代码事实图</b><small>运行源码提取器后，项目架构会出现在这里。</small></span></div>
				) : visibleGraphs.length === 0 ? (
					<div className="home-empty-success home-filter-empty"><AppIcon name="search" size={22} /><span><b>没有匹配的代码图</b><small>换一个标题、子系统或文件名试试。</small></span><button type="button" onClick={() => setQuery("")}>清除筛选</button></div>
				) : (
					<div className="home-catalog-groups" aria-live="polite">
						{visibleProjectGraphs.length ? <section className="home-primary-graphs" aria-labelledby="home-primary-title">
							<div className="home-catalog-group-head"><div><small>当前事实</small><h3 id="home-primary-title">项目源码</h3></div><span>活动工作集</span></div>
							<ul className="home-doc-list home-primary-list gb-stagger">
							{visibleProjectGraphs.map((entry, index) => {
								const evidence = resolveEvidenceStatus(entry);
								const extractionAge = evidenceExtractionAge(entry);
								return <li className="home-catalog-entry" key={entry.file}>
							<button className="home-doc primary" data-evidence-status={evidence.tone} data-node-count={entry.nodes} data-edge-count={entry.edges} onClick={() => openGraph(entry.file)} aria-label={`打开 ${entry.title || entry.subsystem}`}>
								<span className="home-row-index">{String(index + 1).padStart(2, "0")}</span>
								<span className="home-domain-chip d-ue5_code">{graphKind(entry)}</span>
								<span className={`home-card-state is-${evidence.tone}`}>{evidence.label}</span>
								<GraphWorkspaceSnapshot file={entry.file} label={entry.title || entry.subsystem} preview={entry.preview} />
								<span className="home-doc-name">{entry.title || entry.subsystem}</span>
								<span className={`home-project-evidence is-${evidence.tone}`} role="status">
									<span className="home-project-evidence-mark"><AppIcon name={evidence.icon} size={15} /></span>
									<span><strong>{evidence.reason}</strong><small>{entry.file} · 提取于 {extractionAge}{entry.source_file_count !== null ? ` · 扫描 ${countFormatter.format(entry.source_file_count)} 个源码文件` : ""}</small></span>
								</span>
								<span className="home-card-metrics"><i>节点 {entry.nodes}</i><i>关系 {entry.edges}</i><i>提取 {extractionAge}</i></span>
								<span className="home-card-open">打开 <AppIcon name="arrow" size={14} /></span>
							</button>
						</li>;
							})}
							</ul>
						</section> : null}
						{visibleReferenceGraphs.length ? <section className="home-reference-graphs" aria-labelledby="home-reference-title">
							<div className="home-catalog-group-head"><div><small>辅助阅读</small><h3 id="home-reference-title">参考架构</h3></div><span>{visibleReferenceGraphs.length} 份保存快照 · 不等同于活动源码事实</span></div>
							<ul className="home-reference-list gb-stagger">
								{visibleReferenceGraphs.map((entry) => {
									const evidence = resolveEvidenceStatus(entry);
									return <li className="home-catalog-entry" key={entry.file}>
									<button className="home-reference-entry" onClick={() => openGraph(entry.file)} aria-label={`打开 ${entry.title || entry.subsystem}`}>
										<span className="home-reference-icon"><AppIcon name="graph" size={17} /></span>
										<span className="home-reference-identity"><strong>{entry.title || entry.subsystem}</strong><small>{graphKind(entry)} · {entry.file}</small></span>
										<span className="home-reference-metrics"><i>{entry.nodes} 节点</i><i>{entry.edges} 关系</i></span>
										<span className={`home-reference-state is-${evidence.tone}`}>{evidence.label}</span>
										<AppIcon name="arrow" size={14} />
									</button>
								</li>;
								})}
							</ul>
						</section> : null}
					</div>
				)}
			</section>
		</div>
	);
}
