// Graph Brain / viewer - API 详情卡片（P3U3）：Graph/Spec 页点击 ufunction 时在侧边栏展示
// 签名/参数/companions（可点击跳转）+ ★ 收藏（与 API View 同源）+ 反向切到 API 速查
import { useMemo } from "react";
import type { GraphElements } from "../graph-view/GraphView";

interface ApiInfo {
	signature?: string;
	return_type?: string;
	params?: { name: string; type: string; note?: string }[];
	companions?: string[];
	cpp_only?: boolean;
	blueprint_exposable?: boolean;
	is_static?: boolean;
}

interface FnData {
	id: string;
	label: string;
	parent: string;
	module?: string;
	description?: string;
	api?: ApiInfo;
}

interface Props {
	elements: GraphElements;
	fnId: string;
	favIds: Set<string>;
	onToggleFav: (id: string) => void;
	/** companion 点击：跳到该函数（所属类 Spec + 选中函数） */
	onJumpFn: (fnId: string, parentId: string) => void;
	/** 切到 API Reference View 并展开该条目 */
	onShowInApi?: (fnId: string) => void;
}

export default function ApiDetailCard({ elements, fnId, favIds, onToggleFav, onJumpFn, onShowInApi }: Props) {
	const fns = useMemo<FnData[]>(
		() =>
			elements.nodes
				.map((n) => n.data as Record<string, unknown>)
				.filter((d) => d.type === "ufunction")
				.map((d) => ({
					id: String(d.id),
					label: String(d.label ?? d.id),
					parent: String(d.parent ?? ""),
					module: d.module ? String(d.module) : undefined,
					description: d.description ? String(d.description) : undefined,
					api: d.api as ApiInfo | undefined,
				})),
		[elements],
	);

	const fn = fns.find((f) => f.id === fnId);
	if (!fn) return null;

	// companion 解析：完整 id / `Class::Name` 尾缀 / 裸函数名（与 ApiReferenceView 同规则）
	const resolveCompanion = (name: string): FnData | undefined =>
		fns.find((f) => f.id === name) ??
		fns.find((f) => f.id.endsWith(`::${name}`)) ??
		fns.find((f) => f.label === name);

	const isFav = favIds.has(fn.id);
	return (
		<div className="api-detail-card">
			<div className="api-detail-head">
				<button
					className={`api-star${isFav ? " faved" : ""}`}
					title={isFav ? "移出常用库" : "加入常用库"}
					onClick={() => onToggleFav(fn.id)}
				>
					{isFav ? "★" : "☆"}
				</button>
				{fn.api?.blueprint_exposable ? <span className="spec-bp" title="Blueprint 可调用">ⓑ</span> : null}
				{fn.api?.cpp_only ? <span className="api-cpp" title="纯 C++">c++</span> : null}
				{fn.api?.is_static ? <span className="spec-static-badge" title="静态函数">static</span> : null}
				<code className="api-sig">{fn.api?.signature ?? fn.label}</code>
			</div>
			{fn.description ? <p className="spec-desc">{fn.description}</p> : null}
			<p className="spec-meta">
				{fn.parent}
				{fn.module ? ` · ${fn.module}` : ""}
				{fn.api?.return_type ? ` · 返回 ${fn.api.return_type}` : ""}
			</p>
			{(fn.api?.params?.length ?? 0) > 0 ? (
				<table className="api-params">
					<tbody>
						{fn.api!.params!.map((p) => (
							<tr key={p.name}>
								<td className="field-name">{p.name}</td>
								<td><code>{p.type}</code></td>
								<td className="spec-dim">{p.note ?? ""}</td>
							</tr>
						))}
					</tbody>
				</table>
			) : null}
			{(fn.api?.companions?.length ?? 0) > 0 ? (
				<p className="api-companions">
					搭配：
					{fn.api!.companions!.map((c) => {
						const targetFn = resolveCompanion(c);
						return targetFn ? (
							// button 而非无 href 的 <a>：锚点不可聚焦、无 Enter 激活路径（键盘可达性）。
							<button type="button" key={c} className="api-companion" onClick={() => onJumpFn(targetFn.id, targetFn.parent)}>{c}</button>
						) : (
							<span key={c} className="api-companion missing" title="不在当前图谱中">{c}</span>
						);
					})}
				</p>
			) : null}
			{onShowInApi ? (
				<button className="api-locate" onClick={() => onShowInApi(fn.id)}>
					📑 在 API 速查中查看
				</button>
			) : null}
		</div>
	);
}
