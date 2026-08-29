// Read-only code fact inspector. Annotations are the only retained authored layer.
import NodeDetail from "../detail/NodeDetail";
import ApiDetailCard from "../api-view/ApiDetailCard";
import AnnotationPanel from "../annotation-panel/AnnotationPanel";
import type { GraphElements } from "./GraphView";

export interface DetailInspectorProps {
	selected: Record<string, unknown>;
	isProjectGraph: boolean;
	graphElements: GraphElements;
	domain: string;
	subsystem: string;
	favIds: Set<string>;
	onToggleFav: (id: string) => void;
	onLocateFn: (fnId: string, parentId: string) => void;
	onShowInApi: (fnId: string) => void;
	onJumpToNode: (id: string) => void;
}

export default function DetailInspector({
	selected,
	isProjectGraph,
	graphElements,
	domain,
	subsystem,
	favIds,
	onToggleFav,
	onLocateFn,
	onShowInApi,
	onJumpToNode,
}: DetailInspectorProps) {
	return <>
		<div className="panel-eyebrow">代码事实检视器</div>
		{/* 不对 detail-swap 用 key 重挂：key 变化会连带卸载 AnnotationPanel，
		    使其未保存草稿守卫（nodeId 变化确认）永远来不及触发——草稿被静默丢弃。
		    切换动画需要的视觉重置由内部各子组件自行处理。 */}
		<div className="detail-swap">
			<h2>{String(selected.label ?? selected.id)}</h2>
			{isProjectGraph && selected.type === "file" ? <p className="hint">双击文件查看其中的 C++ 类型。</p> : null}
			{isProjectGraph && selected.type === "folder" ? <p className="hint">双击文件夹折叠或展开源码树。</p> : null}
			<NodeDetail data={selected} />
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
