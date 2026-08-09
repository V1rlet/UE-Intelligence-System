import { useMemo } from "react";
import { ueSpecTypeLabel } from "../../../core/schema/ue-naming";
import NodeDetail from "../detail/NodeDetail";
import AnnotationPanel from "../annotation-panel/AnnotationPanel";
import ApiDetailCard from "../api-view/ApiDetailCard";
import AppIcon from "../common/AppIcon";
import type { MermaidEntry } from "../mermaid/MermaidModal";
import type { GraphElements } from "./GraphView";
import { FN_PAGE_SIZE, type SpecTarget } from "./specModel";

interface Props {
	elements: GraphElements;
	target: SpecTarget;
	domain: string;
	subsystem: string;
	selectedId: string | null;
	fnPage: number;
	onFnPage: (page: number) => void;
	onSelect: (id: string) => void;
	onJump: (target: SpecTarget) => void;
	favIds: Set<string>;
	onToggleFav: (id: string) => void;
	onJumpFn: (fnId: string, parentId: string) => void;
	onShowInApi: (fnId: string) => void;
	mermaidEntries: MermaidEntry[];
	onOpenMermaid: (entry: MermaidEntry) => void;
	onJumpToNode: (nodeId: string) => void;
	onClose: () => void;
}

export default function ReadonlySpecPanel({
	elements,
	target,
	domain,
	subsystem,
	selectedId,
	fnPage,
	onFnPage,
	onSelect,
	onJump,
	favIds,
	onToggleFav,
	onJumpFn,
	onShowInApi,
	mermaidEntries,
	onOpenMermaid,
	onJumpToNode,
	onClose,
}: Props) {
	const nodes = useMemo(() => new Map(elements.nodes.map((node) => [String(node.data.id), node.data as Record<string, unknown>])), [elements.nodes]);
	const classData = nodes.get(target.id) ?? { id: target.id, label: target.id };
	const functions = elements.nodes
		.map((node) => node.data as Record<string, unknown>)
		.filter((data) => data.type === "ufunction" && String(data.parent ?? "") === target.id)
		.sort((left, right) => String(left.label ?? left.id).localeCompare(String(right.label ?? right.id)));
	const pageCount = Math.max(1, Math.ceil(functions.length / FN_PAGE_SIZE));
	const page = Math.min(Math.max(fnPage, 0), pageCount - 1);
	const visibleFunctions = functions.slice(page * FN_PAGE_SIZE, (page + 1) * FN_PAGE_SIZE);
	const selected = selectedId ? nodes.get(selectedId) : undefined;
	const relations = elements.edges.flatMap((edge) => {
		const data = edge.data as Record<string, unknown>;
		if (String(data.source) === target.id) return [{ direction: "→", relation: String(data.relation ?? data.type ?? "关联"), peer: String(data.target) }];
		if (String(data.target) === target.id) return [{ direction: "←", relation: String(data.relation ?? data.type ?? "关联"), peer: String(data.source) }];
		return [];
	});
	const chain = Array.isArray(classData.inheritance_chain) ? classData.inheritance_chain.map(String) : target.chain ?? [];

	return <section className="spec-panel readonly-spec-panel" aria-label={`${target.id} 代码事实`}>
		<header className="spec-panel-head">
			<div><small>{ueSpecTypeLabel(classData.type, target.id, classData.cpp_kind)}</small><h2>{String(classData.label ?? target.id)}</h2></div>
			<button type="button" className="spec-close" onClick={onClose} aria-label="关闭类详情"><AppIcon name="back" size={16} /></button>
		</header>

		<div className="spec-panel-scroll">
			<NodeDetail data={classData} />

			{chain.length > 1 ? <section className="spec-section"><h3>继承链</h3><div className="spec-chain">{chain.map((id, index) => <span key={id}>{index > 0 ? " → " : ""}<button type="button" onClick={() => onJump({ id })}>{id}</button></span>)}</div></section> : null}

			{relations.length ? <section className="spec-section"><h3>架构关系</h3><ul className="spec-rel-list">{relations.slice(0, 80).map((item, index) => <li key={`${item.direction}:${item.relation}:${item.peer}:${index}`}><span>{item.direction} {item.relation}</span><button type="button" onClick={() => nodes.has(item.peer) && onJump({ id: item.peer })}>{item.peer}</button></li>)}</ul></section> : null}

			<section className="spec-section"><h3>函数 <small>{functions.length}</small></h3>
				{visibleFunctions.length ? <div className="spec-fn-list">{visibleFunctions.map((fn) => <button type="button" key={String(fn.id)} className={selectedId === String(fn.id) ? "active" : ""} onClick={() => onSelect(String(fn.id))}><code>{String((fn.api as { signature?: string } | undefined)?.signature ?? fn.label ?? fn.id)}</code><small>{String(fn.description ?? "")}</small></button>)}</div> : <p className="hint">没有提取到函数事实。</p>}
				{pageCount > 1 ? <div className="spec-zone-pager"><button disabled={page === 0} onClick={() => onFnPage(page - 1)}>上一页</button><span>{page + 1} / {pageCount}</span><button disabled={page + 1 >= pageCount} onClick={() => onFnPage(page + 1)}>下一页</button></div> : null}
			</section>

			{selected?.type === "ufunction" ? <ApiDetailCard elements={elements} fnId={String(selected.id)} favIds={favIds} onToggleFav={onToggleFav} onJumpFn={onJumpFn} onShowInApi={onShowInApi} /> : null}
			{mermaidEntries.map((entry) => <button key={entry.file} className="mermaid-open" onClick={() => onOpenMermaid(entry)}>📊 {entry.title}</button>)}
			<AnnotationPanel nodeId={selectedId ?? target.id} domain={domain} subsystem={subsystem} onJumpToNode={onJumpToNode} />
		</div>
	</section>;
}
