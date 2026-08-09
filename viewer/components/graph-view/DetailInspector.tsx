// Read-only code fact inspector. Annotations are the only retained authored layer.
import NodeDetail from "../detail/NodeDetail";
import ApiDetailCard from "../api-view/ApiDetailCard";
import AnnotationPanel from "../annotation-panel/AnnotationPanel";
import type { GraphElements } from "./GraphView";
import type { MermaidEntry } from "../mermaid/MermaidModal";

export interface DetailInspectorProps {
	selected: Record<string, unknown>;
	isProjectGraph: boolean;
	graphElements: GraphElements;
	domain: string;
	subsystem: string;
	favIds: Set<string>;
	mermaidFor: (ids: (string | null)[]) => MermaidEntry[];
	onToggleFav: (id: string) => void;
	onLocateFn: (fnId: string, parentId: string) => void;
	onShowInApi: (fnId: string) => void;
	onJumpToNode: (id: string) => void;
	onOpenMermaid: (entry: MermaidEntry) => void;
}

export default function DetailInspector({
	selected,
	isProjectGraph,
	graphElements,
	domain,
	subsystem,
	favIds,
	mermaidFor,
	onToggleFav,
	onLocateFn,
	onShowInApi,
	onJumpToNode,
	onOpenMermaid,
}: DetailInspectorProps) {
	return <>
		<div className="panel-eyebrow">代码事实检视器</div>
		<div className="detail-swap" key={String(selected.id)}>
			<h2>{String(selected.label ?? selected.id)}</h2>
			{isProjectGraph && selected.type === "file" ? <p className="hint">双击文件查看其中的 C++ 类型。</p> : null}
			{isProjectGraph && selected.type === "folder" ? <p className="hint">双击文件夹折叠或展开源码树。</p> : null}
			<NodeDetail data={selected} />
			{mermaidFor([String(selected.id)]).map((entry) => <button key={entry.file} className="mermaid-open" onClick={() => onOpenMermaid(entry)}>📊 {entry.title}</button>)}
			{selected.type === "ufunction" ? <ApiDetailCard
				elements={graphElements}
				fnId={String(selected.id)}
				favIds={favIds}
				onToggleFav={onToggleFav}
				onJumpFn={onLocateFn}
				onShowInApi={onShowInApi}
			/> : null}
			<AnnotationPanel nodeId={String(selected.id)} domain={domain} subsystem={subsystem} onJumpToNode={onJumpToNode} />
		</div>
	</>;
}
