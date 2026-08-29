// Graph Brain / viewer - Graph Explorer View：Cytoscape.js 渲染 + Focus 聚焦 + 悬停邻域高亮
// ue5_code 类图默认"规范卡片视图"：按 UE5 编码规范类交互图的组织思路，持有对象/函数/
// 数据资产收进类卡片三分区，图上只保留继承/接口/生命周期等外部关系边
import cytoscape, {
	type Core,
	type EdgeDefinition,
	type NodeDefinition,
} from "cytoscape";
import { useEffect, useRef, useState } from "react";
import { ANIM, pulseNode, REDUCED_MOTION } from "../../src/motion";
import { loadPref, savePref } from "../../src/uiPrefs";
import { resolveGraphShortcut } from "../../src/appShortcuts";
import {
	completeProjectionInteractive,
	hasActiveProjectionTrace,
	recordViewerPerformance,
	VIEWER_PERFORMANCE_NAMES,
} from "../../src/viewerPerformance";
import { stylesheetFor } from "../../styles/stylesheets";
import ContextMenu, { type MenuEntry } from "../common/ContextMenu";
import { deterministicSeedPositions } from "./deterministicLayout";
import { applyNeighborhoodHighlight, clearNeighborhoodHighlight, createHoverHighlightController } from "./graphHighlight";
import resolveNodeOverlaps from "./resolveOverlaps";
import { loadViewport, saveViewport } from "./viewportStore";
import ViewportZoomControl from "./ViewportZoomControl";
import { buildUeSpecCardSvg } from "./ueSpecCard";
import { buildUmlSvg, type UmlNodeData } from "./umlNode";
import {
	ASSET_TYPE_RE,
	bindSemanticRelationMotion,
	decorateSemanticRelationEdge,
	HOLD_RELATIONS,
	orientCodeTypeRelationForReading,
} from "./relationPresentation";
import {
	boundedFocusZoom,
	boundedLocateZoom,
	clampManualZoom,
	clampOverviewZoom,
	fitZoomForBounds,
	shouldRecenterTappedNode,
	VIEWPORT_POLICY,
} from "./viewportPolicy";
import { UE_SPEC_NODE_TYPES } from "../../../core/schema/ue-naming";
import { diffGraphElementsDetailed } from "../../../core/query/graph-diff";

export { relationMotionFrame as architectureRelationFrame } from "./relationPresentation";

// F9：类切换样式过渡的性能门控——超过此节点数的图悬停会全量翻转 dimmed 类，
// 逐元素过渡有掉帧风险，保持瞬时切换
const MOTION_NODE_BUDGET = 400;

function collectionFitZoom(cy: Core, elements: cytoscape.CollectionArgument, padding: number): number {
	const bounds = elements.boundingBox({ includeLabels: true, includeOverlays: false });
	return fitZoomForBounds(cy.width(), cy.height(), bounds.w, bounds.h, padding);
}

function setOverviewViewport(cy: Core, elements: cytoscape.CollectionArgument, padding: number): void {
	cy.zoom(clampOverviewZoom(collectionFitZoom(cy, elements, padding)));
	cy.center(elements);
}

function animateOverviewViewport(cy: Core, elements: cytoscape.CollectionArgument, padding: number): void {
	cy.stop();
	cy.animate({
		center: { eles: elements },
		zoom: clampOverviewZoom(collectionFitZoom(cy, elements, padding)),
		duration: ANIM(200),
		easing: "ease-out",
	});
}

export interface GraphElements {
	nodes: NodeDefinition[];
	edges: EdgeDefinition[];
}

export interface HeatmapEntry {
	id: string;
	intensity: number;
}

interface Props {
	elements: GraphElements;
	domain?: string;
	onSelect: (data: Record<string, unknown> | null) => void;
	onNodeDblTap?: (data: Record<string, unknown>) => void;
	/** 分层职责树使用自上而下的确定性布局；普通图继续使用 fCoSE。 */
	layoutMode?: "default" | "hierarchy";
	/** 架构脑图使用紧凑节点，不套用类 Spec 卡片。 */
	compactNodes?: boolean;
	/** 外部聚焦请求（如森林搜索定位）：seq 递增触发，复用点击 Focus 的高亮+居中 */
	focusRequest?: { id: string; seq: number } | null;
	/** F5U2：视口保持键——重建图时若键相同则恢复 zoom/pan（编辑写回/fork 换文件名不丢视口）；
	 * 键变化（切换到别的图谱）则正常 fit */
	viewportKey?: string;
	/** Semantic disclosure changes rebuild and refit the forest hierarchy. */
	layoutRevision?: string;
	/** P6U3：耦合热力图着色（空数组=不着色） */
	heatmap?: HeatmapEntry[];
	/** P6U3：热力色阶函数（0→1 → CSS 色值） */
	heatmapColor?: (t: number) => string;
	/** P6U3：参与回路的节点 id 集（红色虚线描边标记） */
	cycleNodeIds?: Set<string>;
}


// F5U2 增量更新：elements 数据变化（编辑写回/时间轴 sweep）→ diff 局部应用。
// working 变换与视觉应用从主构建 effect 提取为纯函数，主构建与增量通道共用，
// 保证两侧对同一 elements 产出完全一致的图元（id 集与 data 字段）。
interface WorkingDeps {
	specActive: boolean;
	showFunctions: boolean;
	domain?: string;
}

function buildGraphWorking(elements: GraphElements, deps: WorkingDeps): GraphElements {
	const { specActive, showFunctions, domain } = deps;
	let working: GraphElements = elements;
	if (specActive) {
		working = toSpecCardElements(elements);
	} else if (!showFunctions) {
		const nodes = elements.nodes.filter((n) => (n.data as { type?: string }).type !== "ufunction");
		const ids = new Set(nodes.map((n) => String(n.data.id)));
		working = {
			nodes,
			edges: elements.edges.filter(
				(e) => ids.has(String(e.data.source)) && ids.has(String(e.data.target)),
			),
		};
	}
	working = {
		...working,
		edges: working.edges.map((edge) => decorateSemanticRelationEdge(orientCodeTypeRelationForReading(edge, domain))),
	};

	// JSON stylesheet 无法内嵌计算逻辑：无预设尺寸的节点按度数预计算 data.size
	const nodes = working.nodes.map((n) => {
		const data = n.data as { width?: number; metrics?: { in_degree?: number; out_degree?: number } };
		if (data.width !== undefined) return n;
		const degree = (data.metrics?.in_degree ?? 0) + (data.metrics?.out_degree ?? 0);
		return { ...n, data: { ...n.data, size: 30 + Math.min(degree, 20) * 3 } };
	});
	return { ...working, nodes };
}

/** SVG 背景节点：规范卡片（specSvg）与 UML 分栏（members）。 */
function applyNodeVisuals(node: cytoscape.NodeSingular): void {
	const specSvg = node.data("specSvg") as string | undefined;
	const members = node.data("members") as UmlNodeData["members"];
	if (specSvg) {
		node.style({
			"background-image": specSvg,
			"background-fit": "cover",
			"background-opacity": 1,
			label: "",
			"text-opacity": 0,
			"border-width": 0,
			"background-color": "transparent",
			padding: 0,
		});
	} else if (members && (members.fields?.length || members.methods?.length)) {
		node.style({
			"background-image": buildUmlSvg(node.data() as UmlNodeData),
			"background-fit": "cover",
			"background-opacity": 1,
			label: "",
			"text-opacity": 0,
			"border-width": 0,
			"background-color": "transparent",
			padding: 0,
		});
	}
}

/** 增量新增节点布局：邻居位置平均 + 确定性抖动；无邻居 → 沿图包围盒右缘展开 */
function placeAddedNodes(cy: Core, addedIds: string[]): void {
	const addedSet = new Set(addedIds);
	// 已知位置的节点（排除同为新增的）包围盒
	let bb = null;
	for (const node of cy.nodes()) {
		if (addedSet.has(node.id())) continue;
		const p = node.position();
		if (bb === null) bb = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
		else {
			if (p.x < bb.x1) bb.x1 = p.x;
			if (p.y < bb.y1) bb.y1 = p.y;
			if (p.x > bb.x2) bb.x2 = p.x;
			if (p.y > bb.y2) bb.y2 = p.y;
		}
	}
	const hash = (t: string) => { let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return h; };
	let orphan = 0;
	cy.batch(() => {
		for (const id of addedIds) {
			const node = cy.getElementById(id);
			if (node.empty() || node.isParent()) continue;
			const neighbors = node.neighborhood("node").filter((n) => !addedSet.has(n.id()));
			if (neighbors.length > 0) {
				let x = 0;
				let y = 0;
				neighbors.forEach((n) => { const p = n.position(); x += p.x; y += p.y; });
				const h = hash(id);
				node.position({ x: x / neighbors.length + (h % 60) - 30, y: y / neighbors.length + ((h >> 4) % 60) - 30 });
			} else if (bb) {
				orphan += 1;
				node.position({ x: bb.x2 + 100 + Math.floor(orphan / 8) * 30, y: bb.y1 + 40 + (orphan % 8) * 34 });
			} else {
				orphan += 1;
				node.position({ x: 80 + orphan * 26, y: 80 + orphan * 26 });
			}
		}
	});
}

const CLASS_TYPES = new Set<string>(UE_SPEC_NODE_TYPES);

/** 规范卡片视图的元素变换：持有物件收进卡片，函数收进卡片，overrides 边重定向到类 */
function toSpecCardElements(elements: GraphElements): GraphElements {
	const nodeById = new Map(elements.nodes.map((n) => [String(n.data.id), n]));
	const fnByParent = new Map<string, NodeDefinition[]>();
	for (const n of elements.nodes) {
		const d = n.data as { type?: string; parent?: string };
		if (d.type === "ufunction" && d.parent) {
			const list = fnByParent.get(d.parent) ?? [];
			list.push(n);
			fnByParent.set(d.parent, list);
		}
	}

	// —— 边变换 ——
	const edges: EdgeDefinition[] = [];
	const seen = new Set<string>();
	for (const e of elements.edges) {
		const d = e.data as { id: string; source: string; target: string; relation?: string };
		if (HOLD_RELATIONS.has(d.relation ?? "")) continue; // 持有关系收进卡片
		const srcNode = nodeById.get(d.source);
		const srcData = srcNode?.data as { type?: string; parent?: string } | undefined;
		if (srcData?.type === "ufunction") {
			// 函数出边（如 overrides → lifecycle_step）重定向到所属类
			if (!srcData.parent) continue;
			const id = `${srcData.parent}--${d.relation}-->${d.target}`;
			if (seen.has(id)) continue;
			seen.add(id);
			edges.push({ data: { ...e.data, id, source: srcData.parent } });
		} else {
			seen.add(d.id);
			edges.push(e);
		}
	}

	// —— 节点变换 ——
	const referenced = new Set<string>();
	for (const e of edges) {
		referenced.add(String(e.data.source));
		referenced.add(String(e.data.target));
	}

	const nodes: NodeDefinition[] = [];
	for (const n of elements.nodes) {
		const d = n.data as Record<string, unknown> & { id: string; type?: string; layer?: string };
		if (d.type === "ufunction") continue;

		if (d.layer === "project" && CLASS_TYPES.has(d.type ?? "")) {
			// 汇集卡片内容：持有对象 / 函数 / 数据资产
			const held: string[] = [];
			const assets: string[] = [];
			for (const e of elements.edges) {
				const ed = e.data as { source: string; target: string; relation?: string };
				if (ed.source !== d.id || !HOLD_RELATIONS.has(ed.relation ?? "")) continue;
				if (ASSET_TYPE_RE.test(ed.target)) assets.push(`[D] ${ed.target}`);
				else held.push(`[C] ${ed.target}`);
			}
			const functions = (fnByParent.get(d.id) ?? []).map((fn) => {
				const fd = fn.data as { label?: string; tags?: string[]; api?: { blueprint_exposable?: boolean } };
				return {
					name: fd.label ?? "",
					bp: !!fd.api?.blueprint_exposable,
					override: !!fd.tags?.includes("override"),
				};
			});
			const card = buildUeSpecCardSvg({
				id: d.id,
				tags: d.tags as string[] | undefined,
				held,
				functions,
				assets,
			});
			nodes.push({
				...n,
				data: { ...n.data, specCard: true, specSvg: card.svg, width: card.width, height: card.height },
			});
			continue;
		}

		// 只被持有关系引用的引擎节点已无边可挂，随卡片收纳一并隐藏
		const isLifecycle = d.type === "lifecycle_step";
		if (!isLifecycle && d.layer === "engine" && !referenced.has(d.id)) continue;
		nodes.push(n);
	}

	return { nodes, edges };
}

export default function GraphView({ elements, domain, onSelect, onNodeDblTap, layoutMode = "default", compactNodes = false, focusRequest, viewportKey, layoutRevision, heatmap, heatmapColor, cycleNodeIds }: Props) {
	const containerRef = useRef<HTMLDivElement>(null);
	const layersButtonRef = useRef<HTMLButtonElement>(null);
	const cyRef = useRef<Core | null>(null);
	// F6：缩放百分比指示 + 右键菜单状态
	const [zoomPct, setZoomPct] = useState(100);
	// F9：扫描线序号——keyed div 重放一次扫掠动画。
	// F22 门控：只在勘测对象（viewportKey）变化时播放；森林折叠/函数开关等
	// 同图重建不再重复扫掠（"重新勘测"的语义是换了对象，不是换了视角）
	const [sweepSeq, setSweepSeq] = useState(0);
	const lastSweepKeyRef = useRef<string | null>(null);
	const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
	// F24B：图层浮出面板——跳数/规范卡片/函数节点从常驻工具条收进按需面板
	const [layersOpen, setLayersOpen] = useState(false);
	// F5U2/F6：同 viewportKey 的 elements 变化走增量；viewportKey 变化代表换图/换 scope，
	// 必须重建布局并在对应 key 下恢复视口，禁止把旧范围 zoom/pan 套给新范围。
	// 记忆上提到模块级 viewportStore：进出 Spec 页会卸载本组件，组件内 ref 存不住
	// F5U2 增量更新：主构建 effect 只依赖结构（不依赖 elements），数据变化走增量通道
	const elementsRef = useRef(elements);
	elementsRef.current = elements;
	const lastWorkingRef = useRef<GraphElements | null>(null);
	const viewportKeyRef = useRef(viewportKey);
	viewportKeyRef.current = viewportKey;
	const onSelectRef = useRef(onSelect);
	onSelectRef.current = onSelect;
	const onDblTapRef = useRef(onNodeDblTap);
	onDblTapRef.current = onNodeDblTap;
	const applyFocusRef = useRef<(id: string, centerSelf?: boolean) => void>(() => {});
	// P3U4：Focus 跳数（1–3）与聚焦态。跳数经 ref 供 cy 闭包读取（改跳数不重建图）
	// F6：跳数持久化
	const [hops, setHopsState] = useState(() => {
		const v = loadPref("hops", 1);
		return v >= 1 && v <= 3 ? v : 1;
	});
	const setHops = (n: number) => {
		setHopsState(n);
		savePref("hops", n);
	};
	const hopsRef = useRef(hops);
	const [focusedInfo, setFocusedInfo] = useState<{ id: string; label: string } | null>(null);
	const focusedIdRef = useRef<string | null>(null);
	const clearFocusRef = useRef<() => void>(() => {});
	const viewportModeRef = useRef<"overview" | "focus" | "manual">("overview");

	const hasClasses = elements.nodes.some((n) => {
		const d = n.data as { type?: string; layer?: string };
		return d.layer === "project" && CLASS_TYPES.has(d.type ?? "");
	});
	const hasFunctions = elements.nodes.some((n) => (n.data as { type?: string }).type === "ufunction");
	// F6：规范卡片开关持久化
	const [specMode, setSpecModeState] = useState<boolean>(() => loadPref("specMode", true));
	const setSpecMode = (v: boolean) => {
		setSpecModeState(v);
		savePref("specMode", v);
	};
	const [showFunctions, setShowFunctions] = useState(false);
	const specActive = !compactNodes && specMode && domain === "ue5_code" && hasClasses;
	const sourceHasPositions = elements.nodes.some((node) => node.position);
	const sourceIsForest = elements.nodes.length > 0 && elements.nodes.every((node) => {
		const type = (node.data as { type?: string }).type;
		return type === "folder" || type === "file";
	});
	const requiresFcose = elements.nodes.length > 0 && !sourceHasPositions && !sourceIsForest && layoutMode !== "hierarchy";
	const [fcoseReady, setFcoseReady] = useState(false);
	const [fcoseError, setFcoseError] = useState<Error | null>(null);

	useEffect(() => {
		if (!requiresFcose || fcoseReady) return;
		let active = true;
		void import("./registerFcose")
			.then(({ registerFcose }) => {
				registerFcose();
				if (active) setFcoseReady(true);
			})
			.catch((reason) => {
				if (active) setFcoseError(reason instanceof Error ? reason : new Error(String(reason)));
			});
		return () => { active = false; };
	}, [fcoseReady, requiresFcose]);

	if (fcoseError) throw fcoseError;

	useEffect(() => {
		if (!containerRef.current) return;
		if (requiresFcose && !fcoseReady) return;
		const keyboardSurface = containerRef.current;

		// F5U2 增量：主构建依赖结构和文档身份（viewportKey）；同一文档内的 elements
		// 变化由下方增量 effect 就地应用，切换文档或架构 scope 则重新布局。
		const elements = elementsRef.current;
		const working = buildGraphWorking(elements, { specActive, showFunctions, domain });
		const nodes = working.nodes;
		lastWorkingRef.current = null; // 结构重建 → 增量通道重新 baseline

		// 布局选择：elk 坐标 → preset；纯文件森林 → 树状 breadthfirst；其余 → 力导向
		const hasPositions = nodes.some((n) => n.position);
		const isForest = working.nodes.length > 0 && working.nodes.every((n) => {
			const t = (n.data as { type?: string }).type;
			return t === "folder" || t === "file";
		});
		const tracesProjection = isForest && hasActiveProjectionTrace();
		const isHierarchy = layoutMode === "hierarchy";
		const cy = cytoscape({
			container: keyboardSurface,
			elements: { nodes, edges: working.edges },
			style: stylesheetFor(domain, !REDUCED_MOTION && nodes.length <= MOTION_NODE_BUDGET),
			// 真正的布局在下方手动 run（同步），布局完成后接重叠分离再统一 fit
			layout: { name: "preset", fit: false },
			wheelSensitivity: VIEWPORT_POLICY.wheelSensitivity,
			minZoom: VIEWPORT_POLICY.hardMinZoom,
			maxZoom: VIEWPORT_POLICY.hardMaxZoom,
		});
		cyRef.current = cy;
		viewportModeRef.current = "overview";
		setCtxMenu(null);

		// F6：缩放百分比指示（rAF 节流，缩放事件高频）
		let zoomRaf = 0;
		const syncZoom = () => {
			cancelAnimationFrame(zoomRaf);
			zoomRaf = requestAnimationFrame(() => setZoomPct(Math.round(cy.zoom() * 100)));
		};
		cy.on("zoom", syncZoom);
		const markManualViewport = (event: cytoscape.EventObject) => {
			if (event.originalEvent) viewportModeRef.current = "manual";
		};
		cy.on("pan zoom", markManualViewport);

		// SVG 背景节点：规范卡片（specSvg）与 UML 分栏（members）
		cy.nodes().forEach(applyNodeVisuals);

		// —— 布局（同步 run）→ 重叠检测分离 → fit ——
		// 分离在 fit 之前：先保证卡片/标签互不叠压，再整体适配视口
		const layoutOpts = hasPositions
			? { name: "preset", fit: false }
			: isForest
			? { name: "breadthfirst", directed: true, spacingFactor: 1.4, fit: false }
			: isHierarchy
			? {
					name: "breadthfirst",
					directed: true,
					circle: false,
					grid: true,
					spacingFactor: 1.75,
					avoidOverlap: true,
					fit: false,
				}
			: (() => {
					// 大图规模感知（D）：fcose 参数按节点数缩放——>250 逐步放大斥力/间距防拥挤，
					// >400 降级 quality 保帧率（proof 是 publish 级质量，大图俯瞰收益低、成本高）
					const nodeCount = nodes.length;
					const scale = Math.max(0, nodeCount - 250) / 250; // 250→1.0, 500→1.0, 750→2.0…
					return {
					name: "fcose",
					quality: nodeCount > 400 ? "draft" : "proof",
					animate: false,
					fit: false,
					randomize: false,
					// 孤立连通分量打包排布，不再飞散成远处孤岛
					packComponents: true,
					nodeSeparation: Math.min(160, 90 + scale * 55),
					nodeRepulsion: () => Math.min(16000, 5200 + scale * 8000),
					gravity: 0.28,
					gravityCompound: 1.2,
					tile: true,
					// 按语义定边长：持有关系（组件/资产挂在类身上）收短贴近主人，
					// 继承/覆写保持距离体现层级
					idealEdgeLength: (edge: cytoscape.EdgeSingular) => {
						const relation = edge.data("relation") as string;
						if (relation === "composes" || relation === "aggregates" || relation === "depends_on") return 55;
						if (relation === "lifecycle_sequence") return 65;
						if (relation === "inherits" || relation === "implements") return 150;
						return 100;
					},
					};
				})();
		// 所有节点从 (0,0) 起步会迫使力导向用随机力打破重叠，导致每次加载职责域换位。
		// 先按 id/compound 分组放置稳定种子，再让 fcose（randomize:false）做局部松弛——
		// 布局只由图结构决定，跨加载与时间轴刻度间保持空间记忆。
		if (!hasPositions && !isForest && !isHierarchy) {
			const seeds = deterministicSeedPositions(nodes.map((definition) => ({
				id: String(definition.data.id),
				parent: definition.data.parent ? String(definition.data.parent) : undefined,
			})));
			cy.nodes().filter((node) => !node.isParent()).positions((node) => seeds.get(node.id()) ?? node.position());
		}
		const layoutElements = isHierarchy
			? cy.nodes().union(cy.edges().filter((edge) => !edge.data("forestSecondary")))
			: cy.elements();
		const layoutStartedAt = performance.now();
		layoutElements.layout(layoutOpts as cytoscape.LayoutOptions).run();
		resolveNodeOverlaps(cy, { margin: isHierarchy ? 28 : 10 });
		setOverviewViewport(cy, cy.elements(), hasPositions || isForest ? 60 : 50);
		if (tracesProjection) {
			recordViewerPerformance(
				VIEWER_PERFORMANCE_NAMES.projectionLayout,
				layoutStartedAt,
				performance.now(),
				{ nodes: nodes.length, edges: working.edges.length },
			);
		}
		// 中小型知识图优先保证标签可读：全览缩得过小时提升到语义阅读下限；
		// 用户仍可点击百分比按钮回到严格的“适配全图”。
		if (!isForest && nodes.length <= 40 && cy.zoom() < 0.52) {
			cy.zoom(0.52);
			cy.center();
		}
		// F22 大图首屏：fit 全图后标签完全不可读（2600 节点图 ≈38%）。混合层大图
		// 默认把首屏对准项目层（用户自己的代码），引擎星云留给缩放/聚焦去探索；
		// F / 双击空白仍是严格“适配全图”。有视口记忆时下方 loadViewport 会覆盖。
		if (!isForest && !hasPositions && nodes.length > 150) {
			const projectNodes = cy.nodes('[layer = "project"]');
			if (projectNodes.nonempty() && projectNodes.length < nodes.length) {
				setOverviewViewport(cy, projectNodes, 80);
			}
		}
		// F9+F22：重新勘测的扫描线反馈——勘测对象变化时扫掠一次
		const sweepKey = viewportKeyRef.current ?? null;
		if (!REDUCED_MOTION && (sweepKey === null || sweepKey !== lastSweepKeyRef.current)) {
			lastSweepKeyRef.current = sweepKey;
			setSweepSeq((s) => s + 1);
		}

		// 同键恢复上次视口（编辑写回/fork 重建、从 Spec 页返回、切视图往返），
		// 避免每次都跳回全图适配；无记忆时保持上面的 fit（确定性入口）。
		// key 在构建时捕获：卸载清理阶段 ref 已被父组件刷成新 key，用 ref 会把
		// 旧图视口错存到新图名下
		const vpKey = viewportKeyRef.current;
		if (vpKey) {
			const saved = loadViewport(vpKey);
			if (saved) {
				cy.viewport({ zoom: clampManualZoom(saved.zoom), pan: saved.pan });
				viewportModeRef.current = "manual";
			}
		}
		setZoomPct(Math.round(cy.zoom() * 100));

		// —— Focus 聚焦：点击节点 → 高亮 N 跳邻域并把邻域动画适配到视口 ——
		// 重建图（数据/视图切换）时聚焦态自然失效，同步清 UI 指示
		focusedIdRef.current = null;
		setFocusedInfo((prev) => (prev ? null : prev));
		let focused = false;
		const clearFocus = () => {
			focused = false;
			focusedIdRef.current = null;
			viewportModeRef.current = "manual";
			setFocusedInfo(null);
			clearNeighborhoodHighlight(cy);
		};
		clearFocusRef.current = clearFocus;
		const focusNode = (node: cytoscape.NodeSingular, centerSelf = false) => {
			onSelectRef.current(node.data());
			focused = true;
			focusedIdRef.current = node.id();
			viewportModeRef.current = "focus";
			setFocusedInfo({ id: node.id(), label: String(node.data("label") ?? node.id()) });
			const hood = applyNeighborhoodHighlight(cy, node, hopsRef.current);
			if (centerSelf) {
				// 搜索定位始终把目标带回可读范围；异常放大的旧视口也会在这里收敛。
				const zoom = boundedLocateZoom(cy.zoom());
				cy.stop();
				cy.animate({ center: { eles: node }, zoom, duration: ANIM(280), easing: "ease-out" });
			} else {
				const fitZoom = collectionFitZoom(cy, hood, 90);
				const zoom = boundedFocusZoom(cy.zoom(), fitZoom);
				cy.stop();
				const renderedBounds = node.renderedBoundingBox({ includeLabels: true, includeOverlays: false });
				if (shouldRecenterTappedNode(renderedBounds, cy.width(), cy.height())) {
					// 节点明显被裁切时才补位；已大部分可见的节点保持屏幕坐标稳定，
					// 避免第一次 tap 把节点移走，导致紧随其后的第二次 tap 无法形成 dbltap。
					cy.animate({ center: { eles: node }, zoom, duration: ANIM(280), easing: "ease-out" });
				}
			}
			pulseNode(node);
		};
		applyFocusRef.current = (id: string, centerSelf = false) => {
			const node = cy.getElementById(id);
			if (node.nonempty() && node.isNode()) focusNode(node, centerSelf);
		};
		const focusKeyboardSurface = () => keyboardSurface.focus({ preventScroll: true });
		const openCanvasMenu = (x: number, y: number) => setCtxMenu({
			x,
			y,
			items: [
				{
					label: "适配全图",
					icon: "⊞",
					hint: "F",
					onClick: () => {
						viewportModeRef.current = "overview";
						animateOverviewViewport(cy, cy.elements(), 50);
					},
				},
				{
					label: "重置缩放 100%",
					icon: "𝟙",
					onClick: () =>
						cy.zoom({ level: 1, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }),
				},
				{
					label: "整理节点与连线",
					icon: "🧹",
					onClick: () => resolveNodeOverlaps(cy, { margin: 10, timeBudgetMs: 800 }),
				},
			],
		});
		cy.on("tap", "node", (evt) => {
			focusKeyboardSurface();
			focusNode(evt.target);
		});
		cy.on("tap", "edge", (evt) => {
			focusKeyboardSurface();
			onSelectRef.current(evt.target.data());
		});
		cy.on("tap", (evt) => {
			if (evt.target === cy) {
				focusKeyboardSurface();
				onSelectRef.current(null);
				clearFocus();
			}
		});
		cy.on("dbltap", "node", (evt) => onDblTapRef.current?.(evt.target.data()));
		// F6：双击空白处适配全图
		cy.on("dbltap", (evt) => {
			if (evt.target === cy) {
				viewportModeRef.current = "overview";
				animateOverviewViewport(cy, cy.elements(), 50);
			}
		});

		// 右键空白处只提供只读画布操作。
		cy.on("cxttap", (evt) => {
			if (evt.target !== cy) return;
			const oe = evt.originalEvent as MouseEvent;
			focusKeyboardSurface();
			openCanvasMenu(oe.clientX, oe.clientY);
		});

		// 键盘归画布焦点所有：不会从顶栏、选择器或弹层穿透到后台视口。
		const onKeyDown = (e: KeyboardEvent) => {
			const action = resolveGraphShortcut({
				key: e.key,
				altKey: e.altKey,
				ctrlKey: e.ctrlKey,
				metaKey: e.metaKey,
				shiftKey: e.shiftKey,
				defaultPrevented: e.defaultPrevented,
			});
			if (action === "exit" && focused) {
				e.preventDefault();
				e.stopPropagation();
				clearFocus();
				onSelectRef.current(null);
				return;
			}
			if (action === "open" && focusedIdRef.current && onDblTapRef.current) {
				e.preventDefault();
				e.stopPropagation();
				const focusedNode = cy.getElementById(focusedIdRef.current);
				if (focusedNode.nonempty() && focusedNode.isNode()) onDblTapRef.current(focusedNode.data());
			} else if (action === "fit") {
				e.preventDefault();
				e.stopPropagation();
				viewportModeRef.current = "overview";
				animateOverviewViewport(cy, cy.elements(), 50);
			} else if (action === "zoomIn") {
				e.preventDefault();
				e.stopPropagation();
				zoomBy(VIEWPORT_POLICY.zoomStep);
			} else if (action === "zoomOut") {
				e.preventDefault();
				e.stopPropagation();
				zoomBy(1 / VIEWPORT_POLICY.zoomStep);
			} else if (action === "menu") {
				e.preventDefault();
				e.stopPropagation();
				const rect = keyboardSurface.getBoundingClientRect();
				openCanvasMenu(rect.left + rect.width / 2, rect.top + rect.height / 2);
			}
		};
		keyboardSurface.addEventListener("keydown", onKeyDown);

		// 悬停邻域高亮（未处于 Focus 时生效）。控制器延后一帧清理，避免 compound
		// 父子节点交错的 mouseout 把刚建立的直接邻域立即清掉。
		const hoverHighlight = createHoverHighlightController(cy, { isEnabled: () => !focused });
		cy.on("mouseover", "node", (evt) => hoverHighlight.enter(evt.target));
		cy.on("mouseout", "node", (evt) => hoverHighlight.leave(evt.target));

		// 所有领域共用同一套语义关系流水线；关系族决定速度、分段和端点脉冲。
		const clearRelationMotion = bindSemanticRelationMotion(cy, REDUCED_MOTION);
		let interactiveFrame = 0;
		let interactivePaintFrame = 0;
		if (tracesProjection) {
			interactiveFrame = requestAnimationFrame(() => {
				interactivePaintFrame = requestAnimationFrame(() => {
					completeProjectionInteractive({ nodes: nodes.length, edges: working.edges.length });
				});
			});
		}

		let resizeFrame = 0;
		let previousSize = { width: cy.width(), height: cy.height() };
		const resizeObserver = new ResizeObserver(() => {
			cancelAnimationFrame(resizeFrame);
			resizeFrame = requestAnimationFrame(() => {
				const nextSize = { width: cy.width(), height: cy.height() };
				if (Math.abs(nextSize.width - previousSize.width) < 1 && Math.abs(nextSize.height - previousSize.height) < 1) return;
				if (viewportModeRef.current === "overview") {
					setOverviewViewport(cy, cy.elements(), hasPositions || isForest ? 60 : 50);
					setZoomPct(Math.round(cy.zoom() * 100));
				} else if (viewportModeRef.current === "focus" && focusedIdRef.current) {
					const focusedNode = cy.getElementById(focusedIdRef.current);
					if (focusedNode.nonempty()) cy.center(focusedNode);
				} else {
					const zoom = cy.zoom();
					const pan = cy.pan();
					const modelCenter = {
						x: (previousSize.width / 2 - pan.x) / zoom,
						y: (previousSize.height / 2 - pan.y) / zoom,
					};
					cy.pan({
						x: nextSize.width / 2 - modelCenter.x * zoom,
						y: nextSize.height / 2 - modelCenter.y * zoom,
					});
				}
				previousSize = nextSize;
			});
		});
		resizeObserver.observe(keyboardSurface);

		return () => {
			keyboardSurface.removeEventListener("keydown", onKeyDown);
			cancelAnimationFrame(zoomRaf);
			cancelAnimationFrame(interactiveFrame);
			cancelAnimationFrame(interactivePaintFrame);
			cancelAnimationFrame(resizeFrame);
			resizeObserver.disconnect();
			cy.off("pan zoom", markManualViewport);
			if (vpKey) {
				saveViewport(vpKey, { zoom: cy.zoom(), pan: cy.pan() });
			}
			hoverHighlight.destroy();
			clearRelationMotion();
			cyRef.current = null;
			cy.destroy();
		};
	}, [domain, fcoseReady, layoutMode, layoutRevision, requiresFcose, showFunctions, specActive, viewportKey]);

	// F5U2 增量：elements 数据变化（编辑写回/时间轴 sweep/图文件切换）→ diff 局部应用。
	// 结构依赖（showFunctions/specActive/domain/layoutMode）变化由主 effect 重建，
	// 重建时 lastWorkingRef 置 null，本通道在此后首跑只记 baseline 不应用。
	useEffect(() => {
		const cy = cyRef.current;
		if (!cy) return;
		const prev = lastWorkingRef.current;
		const curr = buildGraphWorking(elements, { specActive, showFunctions, domain });
		lastWorkingRef.current = curr;
		if (!prev) return;

		const d = diffGraphElementsDetailed(prev, curr);
		const total =
			d.addedNodes.length + d.removedNodeIds.length + d.addedEdges.length +
			d.removedEdgeIds.length + d.changedNodes.length + d.changedEdges.length;
		if (total === 0) return;

		cy.batch(() => {
			// 先删边再删节点（避免 dangling 引用），就地更新数据，最后补新增
			for (const id of d.removedEdgeIds) {
				const edge = cy.getElementById(id);
				if (edge.nonempty()) edge.remove();
			}
			for (const id of d.removedNodeIds) {
				const node = cy.getElementById(id);
				if (node.nonempty()) node.remove();
			}
			for (const c of d.changedNodes) {
				const node = cy.getElementById(c.id);
				if (node.empty()) continue;
				node.data(c.data);
				applyNodeVisuals(node);
			}
			for (const c of d.changedEdges) {
				const edge = cy.getElementById(c.id);
				if (edge.empty()) continue;
				edge.data(c.data);
			}
			const addedNodes = cy.add(d.addedNodes as unknown as cytoscape.ElementDefinition[]);
			if (d.addedEdges.length > 0) {
				cy.add(d.addedEdges as unknown as cytoscape.ElementDefinition[]);
			}
			addedNodes.forEach(applyNodeVisuals);
		});

		// 增量布局：新增节点用邻居平均/包围盒启发式放置，不重跑 fCoSE（保视口、保既有位置）
		placeAddedNodes(cy, d.addedNodes.map((n) => String(n.data.id)));
		if (d.addedNodes.length > 0) resolveNodeOverlaps(cy, { margin: 10, timeBudgetMs: 40 });

		// 聚焦目标被移除 → 清聚焦态（重建路径在主 effect 里同步清）
		if (focusedIdRef.current && cy.getElementById(focusedIdRef.current).empty()) {
			clearFocusRef.current?.();
		}
	}, [elements, specActive, showFunctions, domain]);

	// 外部聚焦请求（搜索/跳转定位）：依赖 seq，同一目标可重复触发；centerSelf 保证
	// 目标本身居中（构建 effect 在前保证 cy 已就绪）
	useEffect(() => {
		if (focusRequest) applyFocusRef.current(focusRequest.id, true);
	}, [focusRequest]);

	// P3U4：跳数变化 → 若正处于聚焦态，以新跳数就地重聚焦（不重建图、不丢视口状态）
	useEffect(() => {
		hopsRef.current = hops;
		if (focusedIdRef.current) applyFocusRef.current(focusedIdRef.current);
	}, [hops]);

	// P6U3：热力图/回路标记——叠加层样式（不重建图，只改节点样式）
	useEffect(() => {
		const cy = cyRef.current;
		if (!cy) return;
		cy.batch(() => {
			cy.nodes().forEach((node) => {
				node.removeClass("heatmap-colored cycle-member");
				node.removeData("heatColor");
			});
			if (heatmap && heatmap.length > 0 && heatmapColor) {
				const map = new Map(heatmap.map((h) => [h.id, h.intensity]));
				cy.nodes().forEach((node) => {
					const val = map.get(node.id());
					if (val !== undefined && val > 0) {
						node.data("heatColor", heatmapColor(val));
						node.addClass("heatmap-colored");
					}
				});
			}
			if (cycleNodeIds && cycleNodeIds.size > 0) {
				cy.nodes().forEach((node) => {
					if (cycleNodeIds.has(node.id())) node.addClass("cycle-member");
				});
			}
		});
	}, [heatmap, heatmapColor, cycleNodeIds]);

	const zoomBy = (factor: number) => {
		const cy = cyRef.current;
		if (!cy) return;
		viewportModeRef.current = "manual";
		cy.stop();
		cy.animate({
			zoom: {
				level: clampManualZoom(cy.zoom() * factor),
				renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
			},
			duration: ANIM(120),
		});
	};
	const setZoomPercent = (nextZoomPct: number) => {
		const cy = cyRef.current;
		if (!cy) return;
		viewportModeRef.current = "manual";
		cy.stop();
		cy.animate({
			zoom: {
				level: clampManualZoom(nextZoomPct / 100),
				renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
			},
			duration: ANIM(120),
		});
	};

	const fitAll = () => {
		const cy = cyRef.current;
		if (!cy) return;
		viewportModeRef.current = "overview";
		animateOverviewViewport(cy, cy.elements(), 50);
	};
	const closeLayers = (restoreFocus = false) => {
		setLayersOpen(false);
		if (restoreFocus) requestAnimationFrame(() => layersButtonRef.current?.focus());
	};

	return (
		<div className="graph-wrap" data-rendered-nodes={elements.nodes.length} data-layout-revision={layoutRevision ?? "stable"} data-layout-capability={requiresFcose ? fcoseReady ? "fcose" : "loading-fcose" : sourceIsForest ? "forest" : "builtin"} onKeyDown={(event) => {
			if (event.key !== "Escape" || !layersOpen) return;
			event.preventDefault();
			event.stopPropagation();
			closeLayers(true);
		}}>
			{/* 阻止浏览器原生右键菜单（cxttap 自定义菜单接管） */}
			<div
				className="graph-canvas"
				ref={containerRef}
				role="region"
				tabIndex={0}
				aria-label={layoutMode === "hierarchy" ? "交互式代码架构图" : "交互式代码关系图"}
				aria-keyshortcuts="Enter Escape Shift+F10 F Home + = - _"
				aria-haspopup="menu"
				aria-controls={ctxMenu ? "graph-canvas-menu" : undefined}
				onContextMenu={(e) => e.preventDefault()}
			/>
			{elements.nodes.length === 0 ? (
				<div className="graph-empty-state" role="status">
					<span aria-hidden="true">◇</span>
					<strong>当前图谱没有节点</strong>
					<p>调整筛选条件，或从工作台打开另一份图谱。</p>
				</div>
			) : null}
			{/* F9：重新勘测扫描线（keyed 重放，动画结束即隐形，不拦截指针） */}
			{sweepSeq > 0 ? <div key={sweepSeq} className="scan-sweep" aria-hidden="true" /> : null}
			{ctxMenu ? (
				<ContextMenu id="graph-canvas-menu" x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />
			) : null}
			<div className="graph-controls" data-zoom-pct={zoomPct}>
				<button title="适配全图（F / 双击空白处）" aria-label="适配全图" onClick={fitAll}>⊞</button>
				<button title="缩小（−）" aria-label="缩小" onClick={() => zoomBy(1 / VIEWPORT_POLICY.zoomStep)}>－</button>
				<ViewportZoomControl zoomPct={zoomPct} onChange={setZoomPercent} />
				<button title="放大（+）" aria-label="放大" onClick={() => zoomBy(VIEWPORT_POLICY.zoomStep)}>＋</button>
				<button
					title="整理节点与连线（自动避让节点、连线穿越与交叉）"
					aria-label="整理节点与连线"
					onClick={() => cyRef.current && resolveNodeOverlaps(cyRef.current, { margin: 10, timeBudgetMs: 800 })}
				>🧹</button>
				<button
					ref={layersButtonRef}
					className={`layers-btn${hops !== 1 || showFunctions ? " engaged" : ""}`}
					title="图层与显示：聚焦跳数 / 规范卡片 / 函数节点"
					aria-label="图层与显示选项"
					aria-expanded={layersOpen}
					aria-controls="graph-layers-popover"
					onClick={() => setLayersOpen((o) => !o)}
				>▤</button>
			</div>
			{layersOpen ? (
				<>
					{/* 背景关闭与 Escape 走同一条恢复焦点的路径：焦点落在被移除的背景上会丢失键盘位置。 */}
					<div className="popover-backdrop" onClick={() => closeLayers(true)} />
					<div id="graph-layers-popover" className="graph-popover layers-pop" role="dialog" data-app-shortcuts="block" aria-labelledby="graph-layers-popover-title">
						<h4 id="graph-layers-popover-title">聚焦跳数</h4>
						<div className="pop-seg" title="点击节点后高亮 N 跳邻域">
							{[1, 2, 3].map((n) => (
								<button key={n} className={hops === n ? "active" : ""} onClick={() => setHops(n)}>
									{n} 跳
								</button>
							))}
						</div>
						{!compactNodes && domain === "ue5_code" && hasClasses ? (
							<label className="pop-switch">
								<input type="checkbox" checked={specMode} onChange={(e) => setSpecMode(e.target.checked)} />
								<span>
									<b>规范卡片视图</b>
									<em>持有对象与函数收进类卡片，图上只留外部关系</em>
								</span>
							</label>
						) : null}
						{hasFunctions && !specActive ? (
							<label className="pop-switch">
								<input
									type="checkbox"
									checked={showFunctions}
									onChange={(e) => setShowFunctions(e.target.checked)}
								/>
								<span>
									<b>显示函数节点</b>
									<em>展开每个类的全部函数（大图会显著变密）</em>
								</span>
							</label>
						) : null}
					</div>
				</>
			) : null}
			{focusedInfo ? (
				<div className="graph-toggles">
					<button
						className="graph-toggle focus-exit"
						title="退出聚焦（Esc / 点击空白处同效）"
						onClick={() => {
							clearFocusRef.current();
							onSelectRef.current(null);
						}}
					>
						✕ 聚焦中：{focusedInfo.label}（{hops} 跳）<kbd>Enter</kbd> 打开
					</button>
				</div>
			) : null}
		</div>
	);
}
