import { useMemo, useState } from "react";
import type { GraphCatalogEntry } from "../../src/graphCatalog";
import AppIcon from "../common/AppIcon";
import { GraphWorkspaceSnapshot, WorkspaceSnapshotPlaceholder } from "./WorkspaceSnapshot";

interface Props {
	catalog: GraphCatalogEntry[];
	loaded: boolean;
	error: string | null;
	onRefresh: () => void;
	openGraph: (file: string) => void;
	openArchitecture: () => void;
	openApi: () => void;
}

function relativeTime(iso: string): string {
	const ms = Date.now() - Date.parse(iso);
	if (!Number.isFinite(ms)) return "未知";
	const hours = Math.floor(ms / 3_600_000);
	if (hours < 1) return "刚刚";
	if (hours < 24) return `${hours} 小时前`;
	return `${Math.floor(hours / 24)} 天前`;
}

function extractionAge(entry: GraphCatalogEntry): string {
	return entry.generated_at ? relativeTime(entry.generated_at) : "未记录";
}

function freshnessLabel(entry: GraphCatalogEntry): string {
	if (entry.freshness === "current") return entry.coverage_status === "partial" ? "来源已验证 · 覆盖部分" : "来源已验证";
	return entry.freshness === "stale" ? "已过期" : "来源未验证";
}

function freshnessClass(entry: GraphCatalogEntry): string {
	if (entry.freshness === "stale") return "is-stale";
	if (entry.freshness === "current") return entry.coverage_status === "partial" ? "is-partial" : "is-current";
	return "is-unverified";
}

function freshnessReason(entry: GraphCatalogEntry): string {
	if (entry.freshness === "stale") {
		return entry.freshness_reason === "fingerprint-mismatch"
			? "当前源码内容指纹与图谱提取快照不一致"
			: `图谱提取后检测到 ${countFormatter.format(entry.source_files_newer ?? 0)} 个源码文件发生更新`;
	}
	if (entry.freshness === "current" && entry.coverage_status === "partial") {
		return `源码指纹一致，但有 ${countFormatter.format(entry.coverage_skipped_files ?? 0)} 个文件未被类提取器消费`;
	}
	if (entry.freshness === "current") return "当前源码内容指纹与图谱提取快照一致";
	return `当前 v${entry.format_version ?? 1} 图缺少可验证的源码指纹`;
}

function freshnessIcon(entry: GraphCatalogEntry): "warning" | "check" | "review" {
	return entry.freshness === "stale" ? "warning" : entry.freshness === "current" ? "check" : "review";
}

function graphKind(entry: GraphCatalogEntry): string {
	if (entry.kind === "mindmap") return "架构脑图";
	if (entry.kind === "reference") return "参考架构";
	if (entry.subsystem === "project") return "项目源码";
	return "代码事实";
}

const countFormatter = new Intl.NumberFormat("zh-CN");

export default function HomeView({ catalog, loaded, error, onRefresh, openGraph, openArchitecture, openApi }: Props) {
	const [query, setQuery] = useState("");
	const graphs = catalog.filter((entry) => entry.domain === "ue5_code");
	const browsable = graphs.filter((entry) => entry.kind !== "mindmap");
	const visibleGraphs = useMemo(() => {
		const needle = query.trim().toLocaleLowerCase();
		if (!needle) return browsable;
		return browsable.filter((entry) => [entry.title, entry.subsystem, entry.file, graphKind(entry)]
			.some((value) => value.toLocaleLowerCase().includes(needle)));
	}, [browsable, query]);
	const visibleProjectGraphs = visibleGraphs.filter((entry) => entry.subsystem === "project");
	const visibleReferenceGraphs = visibleGraphs.filter((entry) => entry.subsystem !== "project");
	const totalNodes = graphs.reduce((sum, entry) => sum + entry.nodes, 0);
	const totalEdges = graphs.reduce((sum, entry) => sum + entry.edges, 0);

	return (
		<div className="home home-code-viewer" role="region" aria-label="代码架构查看器">
			<header className="home-head home-viewer-head">
				<div className="home-head-main home-title-lockup">
					<span className="home-title-mark"><AppIcon name="graph" size={20} /> 只读代码事实</span>
					<h1>代码架构查看器</h1>
					<p className="home-head-summary">检索已经实现的 UE C++ 类型、调用关系和源码证据。GraphBrain 只负责阅读代码事实。</p>
					<p className="home-ownership-note">方案与实现工作流由 ClaudeGameStudios 持有。</p>
					<div className="home-primary-actions" aria-label="主要入口">
						<button type="button" onClick={openArchitecture}><AppIcon name="graph" size={17} /><span><b>浏览架构</b><small>按层级理解职责</small></span><AppIcon name="arrow" size={14} /></button>
						<button type="button" onClick={openApi}><AppIcon name="api" size={17} /><span><b>查询 API</b><small>定位类型与函数</small></span><AppIcon name="arrow" size={14} /></button>
					</div>
				</div>
				<div className="home-head-stats" aria-label="代码事实状态">
					<div><small>代码图</small><b>{loaded ? countFormatter.format(graphs.length) : "—"}</b><span>活动数据源</span></div>
					<div><small>节点</small><b>{loaded ? countFormatter.format(totalNodes) : "—"}</b><span>可定位事实</span></div>
					<div><small>关系</small><b>{loaded ? countFormatter.format(totalEdges) : "—"}</b><span>结构与调用</span></div>
				</div>
			</header>

			{error ? <div className="home-error" role="alert"><span>代码图目录读取失败：{error}</span><button onClick={onRefresh}>重试</button></div> : null}

			<div className="home-section-head">
				<div><small>由源码提取</small><h2>可查看的代码架构 <em>{loaded ? `${browsable.length} 项` : "同步中"}</em></h2></div>
				<div className="home-catalog-tools">
					<label className="home-catalog-search"><AppIcon name="search" size={16} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选标题、子系统或文件…" aria-label="筛选代码架构图" />{query ? <button type="button" onClick={() => setQuery("")} aria-label="清除筛选">清除</button> : null}</label>
					<button className="home-refresh" onClick={onRefresh}><AppIcon name="sync" size={17} /> 重新检查</button>
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
							{visibleProjectGraphs.map((entry, index) => <li className="home-catalog-entry" key={entry.file}>
							<button className="home-doc primary" onClick={() => openGraph(entry.file)} aria-label={`打开 ${entry.title || entry.subsystem}`}>
								<span className="home-row-index">{String(index + 1).padStart(2, "0")}</span>
								<span className="home-domain-chip d-ue5_code">{graphKind(entry)}</span>
								<span className={`home-card-state ${freshnessClass(entry)}`}>{freshnessLabel(entry)}</span>
								<GraphWorkspaceSnapshot file={entry.file} label={entry.title || entry.subsystem} preview={entry.preview} />
								<span className="home-doc-name">{entry.title || entry.subsystem}</span>
								<span className={`home-project-evidence ${freshnessClass(entry)}`} role="status">
									<span className="home-project-evidence-mark"><AppIcon name={freshnessIcon(entry)} size={15} /></span>
									<span><strong>{freshnessReason(entry)}</strong><small>{entry.file} · 提取于 {extractionAge(entry)}{entry.source_file_count !== null ? ` · 扫描 ${countFormatter.format(entry.source_file_count)} 个源码文件` : ""}</small></span>
								</span>
								<span className="home-card-metrics"><i>节点 {entry.nodes}</i><i>关系 {entry.edges}</i><i>提取 {extractionAge(entry)}</i></span>
								<span className="home-card-open">打开 <AppIcon name="arrow" size={14} /></span>
							</button>
						</li>)}
							</ul>
						</section> : null}
						{visibleReferenceGraphs.length ? <section className="home-reference-graphs" aria-labelledby="home-reference-title">
							<div className="home-catalog-group-head"><div><small>辅助阅读</small><h3 id="home-reference-title">参考架构</h3></div><span>{visibleReferenceGraphs.length} 份保存快照 · 不等同于活动源码事实</span></div>
							<ul className="home-reference-list gb-stagger">
								{visibleReferenceGraphs.map((entry) => <li className="home-catalog-entry" key={entry.file}>
									<button className="home-reference-entry" onClick={() => openGraph(entry.file)} aria-label={`打开 ${entry.title || entry.subsystem}`}>
										<span className="home-reference-icon"><AppIcon name="graph" size={17} /></span>
										<span className="home-reference-identity"><strong>{entry.title || entry.subsystem}</strong><small>{graphKind(entry)} · {entry.file}</small></span>
										<span className="home-reference-metrics"><i>{entry.nodes} 节点</i><i>{entry.edges} 关系</i></span>
										<span className={`home-reference-state ${freshnessClass(entry)}`}>{freshnessLabel(entry)}</span>
										<AppIcon name="arrow" size={14} />
									</button>
								</li>)}
							</ul>
						</section> : null}
					</div>
				)}
			</section>
		</div>
	);
}
