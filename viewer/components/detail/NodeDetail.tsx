// Graph Brain / viewer - 节点详情卡（F6）：精选字段卡片化 + 原始数据折叠
//
// 详情面板信息架构：用户关心的字段（描述/路径/标签/度量）以适配的控件呈现，
// 其余内部字段收进「全部字段」折叠区——原来的裸 key/value 平铺仅作兜底。

import { useMemo, useState, type ReactNode } from "react";
import { ueTypeLabel } from "../../../core/schema/ue-naming";
import { loadPref, savePref } from "../../src/uiPrefs";
import { toast } from "../common/Toast";

interface Props {
	data: Record<string, unknown>;
}

/** 已被精选区呈现、无需再进原始表的键 */
const CURATED_KEYS = new Set([
	"id", "label", "type", "layer", "module", "domain", "description",
	"source_path", "tags", "metrics", "visibility", "size", "origin", "category",
	"network_scope", "lifetime_scope", "responsibilities", "common_mistakes",
]);

const VISIBILITY_LABELS: Record<string, string> = {
	fog: "迷雾态",
	silhouette: "轮廓态",
	explored: "已探索",
};

function DetailSection({ id, title, warning = false, children }: { id: string; title: string; warning?: boolean; children: ReactNode }) {
	const [open, setOpen] = useState(() => loadPref<boolean>(`nodeDetail.section.${id}`, true));
	return (
		<details
			className={`nd-list-section nd-collapsible${warning ? " nd-list-warning" : ""}`}
			open={open}
			onToggle={(event) => {
				const next = event.currentTarget.open;
				setOpen(next);
				savePref(`nodeDetail.section.${id}`, next);
			}}
		>
			<summary><h4>{title}</h4></summary>
			{children}
		</details>
	);
}

export default function NodeDetail({ data }: Props) {
	const tags = Array.isArray(data.tags) ? (data.tags as string[]) : [];
	const responsibilities = Array.isArray(data.responsibilities) ? (data.responsibilities as string[]) : [];
	const commonMistakes = Array.isArray(data.common_mistakes) ? (data.common_mistakes as string[]) : [];
	const metrics = (data.metrics ?? null) as
		| { in_degree?: number; out_degree?: number; betweenness?: number }
		| null;

	const restEntries = useMemo(
		() =>
			Object.entries(data).filter(
				([k, v]) => !CURATED_KEYS.has(k) && v !== undefined && v !== null && v !== "",
			),
		[data],
	);

	const copyPath = async () => {
		try {
			await navigator.clipboard.writeText(String(data.source_path));
			toast("路径已复制", "success", 2000);
		} catch {
			toast("复制失败（浏览器未授权剪贴板）", "error");
		}
	};

	return (
		<div className="node-detail">
			<div className="nd-badges">
				{data.type ? <span className="nd-badge nd-badge-type">{ueTypeLabel(data.type)}</span> : null}
				{data.layer ? <span className={`nd-badge nd-badge-layer-${String(data.layer)}`}>{String(data.layer)}</span> : null}
				{data.module ? <span className="nd-badge">{String(data.module)}</span> : null}
				{data.origin ? <span className="nd-badge">来源 · {String(data.origin)}</span> : null}
				{data.network_scope ? <span className="nd-badge">网络 · {String(data.network_scope)}</span> : null}
				{data.lifetime_scope ? <span className="nd-badge">生命周期 · {String(data.lifetime_scope)}</span> : null}
				{data.visibility && data.visibility !== "explored" ? (
					<span className="nd-badge nd-badge-vis">{VISIBILITY_LABELS[String(data.visibility)] ?? String(data.visibility)}</span>
				) : null}
			</div>
			{data.description ? <p className="nd-desc">{String(data.description)}</p> : null}
			{data.source_path ? (
				<div className="nd-path">
					<code title={String(data.source_path)}>{String(data.source_path)}</code>
					<button title="复制路径" aria-label="复制源文件路径" onClick={copyPath}>⧉</button>
				</div>
			) : null}
			{tags.length > 0 ? (
				<div className="nd-tags">
					{tags.map((t) => (
						<span key={t} className={`nd-tag${t.startsWith("#") ? " nd-tag-scene" : ""}`}>{t}</span>
					))}
				</div>
			) : null}
			{responsibilities.length > 0 ? (
				<DetailSection id="responsibilities" title="核心职责">
					<ul>{responsibilities.map((item) => <li key={item}>{item}</li>)}</ul>
				</DetailSection>
			) : null}
			{commonMistakes.length > 0 ? (
				<DetailSection id="common-mistakes" title="常见误区" warning>
					<ul>{commonMistakes.map((item) => <li key={item}>{item}</li>)}</ul>
				</DetailSection>
			) : null}
			{metrics && (metrics.in_degree !== undefined || metrics.out_degree !== undefined) ? (
				<div className="nd-metrics" title="传入度 / 传出度 / 中介中心性">
					<span>↓入 {metrics.in_degree ?? 0}</span>
					<span>↑出 {metrics.out_degree ?? 0}</span>
					{metrics.betweenness !== undefined ? <span>◈中介 {Number(metrics.betweenness).toFixed(2)}</span> : null}
				</div>
			) : null}
			{restEntries.length > 0 ? (
				<details className="nd-raw">
					<summary>全部字段（{restEntries.length}）</summary>
					<table>
						<tbody>
							{restEntries.map(([k, v]) => (
								<tr key={k}>
									<td className="field-name">{k}</td>
									<td>{typeof v === "object" ? JSON.stringify(v) : String(v)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</details>
			) : null}
		</div>
	);
}
