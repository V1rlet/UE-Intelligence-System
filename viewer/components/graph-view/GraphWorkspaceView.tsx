// Read-only UE code architecture workspace. GraphBrain owns no planning or design state.
import { lazy } from "react";
import { AsyncSurface } from "../common/AsyncSurface";
import Legend from "./Legend";
import DetailInspector from "./DetailInspector";
import type { GraphFile } from "../../src/useGraphDocument";
import type { PanelWidthState } from "../../src/usePanelWidth";
import type { GraphElements } from "./GraphView";
import type { FocusRequest, SpecTarget, SpecZoneKey, SpecZonePages } from "./specModel";
import type { MermaidEntry } from "../mermaid/MermaidModal";
import type { CodeSource } from "../../src/codeWorkspaceModel";
import type { EngineCatalogState } from "../../src/useEngineCatalog";

const GraphView = lazy(() => import("./GraphView"));
const EngineSpecBrowser = lazy(() => import("./EngineSpecBrowser"));
const ReadonlySpecPanel = lazy(() => import("./ReadonlySpecPanel"));
const SpecView = lazy(() => import("./SpecView"));

export interface GraphWorkspaceData {
	graph: GraphFile;
	currentFile: string | null;
	domain: "ue5_code";
	subsystem: string;
	displayElements: GraphElements | null;
	legend: { types: Set<string>; relations: Set<string>; layers: Set<string> };
	isProjectGraph: boolean;
	forestFocus: FocusRequest | null;
	forest?: {
		visibleNodes: number;
		totalNodes: number;
		collapsedFolders: number;
		viewKey: string;
		onCollapseToRoots: () => void;
	};
	codeSource: CodeSource;
}

export interface GraphWorkspaceSpec {
	specTarget: SpecTarget | null;
	hoverId: string | null;
	specSelectedId: string | null;
	fnPage: number;
	specZonePages: SpecZonePages;
	focusRequest: FocusRequest | null;
	onFnPage: (page: number) => void;
	onZonePage: (zone: SpecZoneKey, page: number) => void;
	onHover: (id: string | null) => void;
	onSelectSpecNode: (id: string | null) => void;
	onOpenSpec: (target: SpecTarget) => void;
	onCloseSpec: () => void;
	onRequestFocus: (id: string) => void;
	favIds: Set<string>;
	onToggleFav: (id: string) => void;
	onLocateFn: (fnId: string, parentId: string) => void;
	onShowInApi: (fnId: string) => void;
	mermaidFor: (ids: (string | null)[]) => MermaidEntry[];
	onOpenMermaid: (entry: MermaidEntry) => void;
	onJumpToNode: (id: string) => void;
}

export interface GraphWorkspaceCanvas {
	selected: Record<string, unknown> | null;
	onSelect: (data: Record<string, unknown> | null) => void;
	onGraphDblTap: (data: Record<string, unknown>) => void;
}

export interface GraphWorkspaceViewProps {
	data: GraphWorkspaceData;
	spec: GraphWorkspaceSpec;
	canvas: GraphWorkspaceCanvas;
	engine: {
		busy: boolean;
		elements: GraphElements;
		catalogState: EngineCatalogState;
		sourceRoot?: string;
		onOpenClass: (name: string, sourcePath?: string) => void | Promise<void>;
	};
	panels: { specPanel: PanelWidthState; detailPanel: PanelWidthState };
	onExit: () => void;
}

function PanelResizer({ state, label }: { state: PanelWidthState; label: string }) {
	return <div
		className="panel-resizer"
		role="separator"
		tabIndex={0}
		aria-orientation="vertical"
		aria-label={label}
		aria-valuemin={state.min}
		aria-valuemax={state.max}
		aria-valuenow={state.width}
		title="拖动或使用方向键调整面板宽度"
		onMouseDown={state.onResizeStart}
		onKeyDown={state.onResizeKeyDown}
	/>;
}

export default function GraphWorkspaceView({ data, spec, canvas, engine, panels, onExit }: GraphWorkspaceViewProps) {
	const { graph, currentFile, domain, subsystem, displayElements, legend, isProjectGraph, forestFocus, forest, codeSource } = data;
	const {
		specTarget, hoverId, specSelectedId, fnPage, specZonePages, focusRequest,
		onFnPage, onZonePage, onHover, onSelectSpecNode, onOpenSpec, onCloseSpec,
		favIds, onToggleFav, onLocateFn, onShowInApi, mermaidFor, onOpenMermaid, onJumpToNode,
	} = spec;
	const { selected, onSelect, onGraphDblTap } = canvas;
	const showEngineLayer = !specTarget && codeSource === "engine";
	const specElements = codeSource === "engine" ? engine.elements : graph.elements;

	if (specTarget) return <>
		<div className="graph-wrap">
			<AsyncSurface label="正在打开类结构" detail="类结构图没有成功打开。" icon="graph" variant="workspace" resetKey={`spec-view:${currentFile ?? ""}:${specTarget.id}`} onExit={onCloseSpec}>
				<SpecView
					elements={specElements}
					target={specTarget}
					fnPage={fnPage}
					onFnPage={onFnPage}
					zonePages={specZonePages}
					onZonePage={onZonePage}
					hoverId={hoverId}
					focusRequest={focusRequest}
					onHover={onHover}
					onJump={onOpenSpec}
					onSelectNode={(item) => onSelectSpecNode(item ? String(item.id) : specTarget.id)}
					viewportKey={`spec:${currentFile ?? ""}:${specTarget.id}`}
				/>
			</AsyncSurface>
		</div>
		<PanelResizer state={panels.specPanel} label="调整类详情宽度" />
		<AsyncSurface label="正在打开类详情" detail="类详情面板没有成功打开。" icon="graph" variant="panel" style={{ width: panels.specPanel.width }} resetKey={`spec-panel:${currentFile ?? ""}:${specTarget.id}`} onExit={onCloseSpec}>
			<ReadonlySpecPanel
				elements={specElements}
				target={specTarget}
				domain={domain}
				subsystem={subsystem}
				selectedId={specSelectedId}
				fnPage={fnPage}
				onFnPage={onFnPage}
				onSelect={onSelectSpecNode}
				onJump={onOpenSpec}
				favIds={favIds}
				onToggleFav={onToggleFav}
				onJumpFn={onLocateFn}
				onShowInApi={onShowInApi}
				mermaidEntries={mermaidFor([specTarget.id, specSelectedId])}
				onOpenMermaid={onOpenMermaid}
				onJumpToNode={onJumpToNode}
				onClose={onCloseSpec}
			/>
		</AsyncSurface>
	</>;

	if (showEngineLayer) return <AsyncSurface label="正在打开引擎类资料" detail="引擎类资料界面没有成功打开。" icon="api" variant="workspace" resetKey={`engine:${currentFile ?? ""}`} onExit={onExit}>
		<EngineSpecBrowser busy={engine.busy} catalogState={engine.catalogState} sourceRoot={engine.sourceRoot} onOpenClass={engine.onOpenClass} />
	</AsyncSurface>;

	return <>
		<div className="graph-col">
			{forest ? <div className="forest-semantic-bar" role="status" aria-label="关系图分层浏览状态" data-visible-nodes={forest.visibleNodes} data-total-nodes={forest.totalNodes}>
				<span><small>分层浏览</small><b>{forest.visibleNodes} / {forest.totalNodes}</b></span>
				<em>双击文件夹逐层展开</em>
				<button type="button" onClick={forest.onCollapseToRoots}>回到根层</button>
			</div> : null}
			<AsyncSurface label="正在绘制代码图" loadingDetail="整理源码节点与关系" detail="代码图没有成功显示。" icon="graph" variant="workspace" resetKey={`graph:${currentFile ?? ""}`} onExit={onExit}>
				<GraphView
					elements={displayElements ?? graph.elements}
					domain={domain}
					onSelect={onSelect}
					onNodeDblTap={onGraphDblTap}
					focusRequest={forestFocus}
					viewportKey={isProjectGraph ? undefined : currentFile ?? undefined}
					layoutRevision={forest?.viewKey}
				/>
			</AsyncSurface>
			<Legend domain={domain} presentTypes={legend.types} presentRelations={legend.relations} presentLayers={legend.layers} />
		</div>
		{selected ? <><PanelResizer state={panels.detailPanel} label="调整代码事实详情宽度" />
		<aside className="detail-panel detail-panel-demand" style={{ width: panels.detailPanel.width }}>
			<button type="button" className="detail-panel-close" aria-label="关闭代码事实检视器" onClick={() => onSelect(null)}>×</button>
			<DetailInspector
				selected={selected}
				isProjectGraph={isProjectGraph}
				graphElements={graph.elements}
				domain={domain}
				subsystem={subsystem}
				favIds={favIds}
				mermaidFor={mermaidFor}
				onToggleFav={onToggleFav}
				onLocateFn={onLocateFn}
				onShowInApi={onShowInApi}
				onJumpToNode={onJumpToNode}
				onOpenMermaid={onOpenMermaid}
			/>
		</aside></> : null}
	</>;
}
