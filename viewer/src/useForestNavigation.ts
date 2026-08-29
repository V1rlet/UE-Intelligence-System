/**
 * useForestNavigation — 项目图文件森林的导航状态与派生视图。
 *
 * 从 App.tsx 拆出的第二块（Step 2）：森林折叠/搜索/聚焦状态、
 * 结构索引（contains 边 → 父子映射 + 文件计数）、折叠过滤后的图元素、
 * 以及「展开祖先 + 聚焦」定位操作。纯数据/计算逻辑，无 JSX。
 *
 * 输入约定：
 * - graph：当前事实图（搜索索引基于最新图；时间轴回放时搜索框隐藏，索引自然闲置）
 * - displayGraph：显示用图（时间轴激活时为历史快照，否则同 graph；
 *   P6U2 的「折叠/索引作用在历史快照上」语义由 App 的 displayGraph 决定，
 *   本 hook 只消费其结果）
 *
 * App 仍是唯一消费者（单组件拥有者）。后续 Context 化时此 hook 可直接提升。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { isUeForestNodeType } from "../../core/schema/ue-naming";
import type { GraphElements } from "../components/graph-view/GraphView";
import type { FocusRequest } from "../components/graph-view/specModel";
import type { GraphFile } from "./useGraphDocument";

// ── 共享类型（原 App.tsx 内联） ────────────────────────────────
export interface ForestIndex {
	childrenOf: Map<string, string[]>;
	parentOf: Map<string, string>;
	typeOf: Map<string, string>;
	fileCounts: Map<string, number>;
}

export interface ForestSearchResult {
	id: string;
	label: string;
	kind: string;
	via?: string;
}

// ── Hook 参数 ──────────────────────────────────────────────────
export interface UseForestNavigationOptions {
	/** 当前事实图（搜索索引基于最新图） */
	graph: GraphFile | null;
	/** 显示用图（时间轴激活时为历史快照，否则同 graph） */
	displayGraph: GraphFile | null;
	/** Canonical document identity; projection → full upgrades keep the same navigation state. */
	graphKey: string | null;
	/** Versioned route state: one stable folder/file id, never presentation coordinates. */
	branch?: string | null;
	onBranchChange?: (branch: string | null) => void;
}

// ── Hook 返回值 ────────────────────────────────────────────────
export interface ForestNavigationState {
	/** 项目图（含文件森林）判定；App 其他分区（搜索框显示、URL、图例等）复用 */
	isProjectGraph: boolean;

	// 折叠
	collapsed: Set<string>;
	/** 折叠/展开单个文件夹（右键菜单与双击共用） */
	toggleFolder: (id: string) => void;
	/** Restore semantic root disclosure (roots visible, every nested folder collapsed). */
	collapseToRoots: () => void;

	// 聚焦
	forestFocus: FocusRequest | null;
	setForestFocus: React.Dispatch<React.SetStateAction<FocusRequest | null>>;

	// 搜索
	forestQuery: string;
	setForestQuery: React.Dispatch<React.SetStateAction<string>>;
	searchSel: number;
	setSearchSel: React.Dispatch<React.SetStateAction<number>>;
	searchResults: ForestSearchResult[];

	// 派生视图
	forestElements: GraphElements | null;
	forestTotalNodes: number;
	forestVisibleNodes: number;
	forestCollapsedFolders: number;
	forestViewKey: string;

	/** 展开目标全部折叠祖先 → 聚焦 + 清空搜索（extraParents：增量边尚未进索引时补充） */
	locateInForest: (id: string, extraParents?: Map<string, string>) => void;
}

export function useForestNavigation({ graph, displayGraph, graphKey, branch = null, onBranchChange }: UseForestNavigationOptions): ForestNavigationState {
	// 森林状态：折叠的文件夹集合 + 搜索定位（searchSel：键盘 ↑↓ 挑选的结果索引）
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const [forestFocus, setForestFocus] = useState<FocusRequest | null>(null);
	const [forestQuery, setForestQuery] = useState("");
	const [searchSel, setSearchSel] = useState(-1);
	const initializedGraphKeyRef = useRef<string | null>(null);
	const appliedRouteBranchRef = useRef<string | null>(null);
	const emittedBranchRef = useRef<string | null | undefined>(undefined);

	// 项目图（含文件森林）默认进森林导航；其余图保持原视图
	// （P6U2：源取 displayGraph——时间轴激活时森林折叠/索引作用在历史快照上）
	const isProjectGraph = useMemo(
		() => displayGraph?.elements.nodes.some((n) => isUeForestNodeType((n.data as { type?: string }).type)) ?? false,
		[displayGraph],
	);

	// 森林结构索引：contains 边 → 父子映射 + 各文件夹子树的文件数（折叠计数用）
	const forestIndex = useMemo<ForestIndex>(() => {
		const childrenOf = new Map<string, string[]>();
		const parentOf = new Map<string, string>();
		const typeOf = new Map<string, string>();
		if (displayGraph && isProjectGraph) {
			for (const n of displayGraph.elements.nodes) {
				const d = n.data as { id: string; type?: string };
				if (isUeForestNodeType(d.type)) typeOf.set(String(d.id), d.type);
			}
			for (const e of displayGraph.elements.edges) {
				const d = e.data as { source: string; target: string; relation?: string };
				if (d.relation !== "contains" || !typeOf.has(String(d.source)) || !typeOf.has(String(d.target))) continue;
				const list = childrenOf.get(String(d.source)) ?? [];
				list.push(String(d.target));
				childrenOf.set(String(d.source), list);
				parentOf.set(String(d.target), String(d.source));
			}
		}
		const fileCounts = new Map<string, number>();
		const visiting = new Set<string>();
		const countFiles = (id: string): number => {
			const cached = fileCounts.get(id);
			if (cached !== undefined) return cached;
			// contains 关系来自外部图数据：出现环时按 0 计而不是无限递归挂起标签页。
			if (visiting.has(id)) return 0;
			visiting.add(id);
			let n = 0;
			for (const c of childrenOf.get(id) ?? []) {
				n += typeOf.get(c) === "file" ? 1 : countFiles(c);
			}
			visiting.delete(id);
			fileCounts.set(id, n);
			return n;
		};
		for (const id of typeOf.keys()) if (typeOf.get(id) === "folder") countFiles(id);
		return { childrenOf, parentOf, typeOf, fileCounts };
	}, [displayGraph, isProjectGraph]);

	const rootCollapsed = useMemo(() => new Set([...forestIndex.typeOf.entries()]
		.filter(([id, type]) => type === "folder" && forestIndex.parentOf.has(id))
		.map(([id]) => id)), [forestIndex]);
	const usesInitializedCollapse = initializedGraphKeyRef.current === graphKey;
	const activeCollapsed = usesInitializedCollapse ? collapsed : rootCollapsed;

	useEffect(() => {
		if (!graphKey || !isProjectGraph || forestIndex.typeOf.size === 0 || initializedGraphKeyRef.current === graphKey) return;
		initializedGraphKeyRef.current = graphKey;
		setCollapsed(rootCollapsed);
		setForestFocus(null);
	}, [forestIndex.typeOf.size, graphKey, isProjectGraph, rootCollapsed]);

	useEffect(() => {
		if (!graphKey || !isProjectGraph || forestIndex.typeOf.size === 0) return;
		const routeKey = `${graphKey}\u0000${branch ?? ""}`;
		if (emittedBranchRef.current === branch) {
			emittedBranchRef.current = undefined;
			appliedRouteBranchRef.current = routeKey;
			return;
		}
		if (appliedRouteBranchRef.current === routeKey) return;
		appliedRouteBranchRef.current = routeKey;
		if (!branch || !forestIndex.typeOf.has(branch)) {
			setCollapsed(rootCollapsed);
			setForestFocus(null);
			return;
		}
		setCollapsed(() => {
			const next = new Set(rootCollapsed);
			const seen = new Set<string>();
			let current: string | undefined = branch;
			while (current && !seen.has(current)) {
				seen.add(current);
				next.delete(current);
				current = forestIndex.parentOf.get(current);
			}
			return next;
		});
		setForestFocus((previous) => ({ id: branch, seq: (previous?.seq ?? 0) + 1 }));
	}, [branch, forestIndex, graphKey, isProjectGraph, rootCollapsed]);

	const emitBranch = (nextBranch: string | null) => {
		emittedBranchRef.current = nextBranch;
		onBranchChange?.(nextBranch);
	};

	const forestElements = useMemo<GraphElements | null>(() => {
		if (!displayGraph || !isProjectGraph) return null;
		// 折叠文件夹的子树隐藏，文件夹自身保留为「▸ 名称（N 文件）」占位节点——
		// 它是单击展开的交互锚点；把折叠文件夹一并藏掉会让占位标签成为死代码，
		// 且折叠根文件夹时整个根凭空消失。（contains 环由 hide 的去重终止。）
		const hidden = new Set<string>();
		const hide = (id: string) => {
			// 已隐藏即返回：既是去重，也是 contains 环的终止条件。
			if (hidden.has(id)) return;
			hidden.add(id);
			for (const c of forestIndex.childrenOf.get(id) ?? []) hide(c);
		};
		for (const id of activeCollapsed) for (const c of forestIndex.childrenOf.get(id) ?? []) hide(c);

		const nodes = displayGraph.elements.nodes
			.filter((n) => {
				const d = n.data as { id: string; type?: string };
				return isUeForestNodeType(d.type) && !hidden.has(String(d.id));
			})
			.map((n) => {
				const d = n.data as {
					id: string; type?: string; label?: string; classes?: string[]; file_kind?: string;
				};
				if (d.type === "folder" && activeCollapsed.has(String(d.id))) {
					const count = forestIndex.fileCounts.get(String(d.id)) ?? 0;
					return {
						...n,
						data: { ...n.data, collapsed: true, children_count: count, label: `▸ ${d.label}（${count} 文件）` },
					};
				}
				if (d.type === "folder") return { ...n, data: { ...n.data, label: `▾ ${d.label}` } };
				// 模块入口文件叶：⚙ 徽标；多类文件叶：×N 徽标
				if (d.type === "file" && d.file_kind === "module_entry") {
					return { ...n, data: { ...n.data, label: `⚙ ${d.label}` } };
				}
				if (d.type === "file" && (d.classes?.length ?? 0) > 1) {
					return { ...n, data: { ...n.data, label: `${d.label} ×${d.classes!.length}` } };
				}
				return n;
			});
		const ids = new Set(nodes.map((n) => String(n.data.id)));
		return {
			nodes,
			edges: displayGraph.elements.edges.filter(
				(e) => ids.has(String(e.data.source)) && ids.has(String(e.data.target)),
			),
		};
	}, [activeCollapsed, displayGraph, forestIndex, isProjectGraph]);

	// 森林搜索：匹配文件/文件夹名与文件叶内的类名（含被折叠隐藏的——定位时自动展开）
	const searchResults = useMemo<ForestSearchResult[]>(() => {
		const q = forestQuery.trim().toLowerCase();
		if (!q || !graph || !isProjectGraph) return [];
		const out: ForestSearchResult[] = [];
		for (const n of graph.elements.nodes) {
			if (out.length >= 12) break;
			const d = n.data as { id: string; type?: string; label?: string; classes?: string[] };
			if (d.type !== "folder" && d.type !== "file") continue;
			const label = String(d.label ?? d.id);
			if (label.toLowerCase().includes(q)) {
				out.push({ id: String(d.id), label, kind: d.type });
			} else if (d.type === "file") {
				const hit = (d.classes ?? []).find((c) => c.toLowerCase().includes(q));
				if (hit) out.push({ id: String(d.id), label, kind: "file", via: hit });
			}
		}
		return out;
	}, [forestQuery, graph, isProjectGraph]);

	// 折叠/展开单个文件夹（右键菜单与双击共用）
	const toggleFolder = (id: string) => {
		const expanding = activeCollapsed.has(id);
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (!next.delete(id)) next.add(id);
			return next;
		});
		emitBranch(expanding ? id : forestIndex.parentOf.get(id) ?? null);
	};
	const collapseToRoots = () => {
		setCollapsed(rootCollapsed);
		setForestFocus(null);
		emitBranch(null);
	};

	// 搜索定位：展开目标的全部折叠祖先 → 高亮 + 居中
	// extraParents：刚合并、尚未进入 forestIndex 的增量父子关系（同帧 setGraph 后索引未重算）
	const locateInForest = (id: string, extraParents?: Map<string, string>) => {
		const parentOf = (x: string) => extraParents?.get(x) ?? forestIndex.parentOf.get(x);
		setCollapsed((prev) => {
			let changed = false;
			const next = new Set(prev);
			const seen = new Set<string>();
			let cur = parentOf(id);
			while (cur && !seen.has(cur)) {
				seen.add(cur);
				if (next.delete(cur)) changed = true;
				cur = parentOf(cur);
			}
			return changed ? next : prev;
		});
		setForestFocus((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }));
		emitBranch(id);
		setForestQuery("");
		setSearchSel(-1);
	};

	return {
		isProjectGraph,
		collapsed,
		toggleFolder,
		collapseToRoots,
		forestFocus,
		setForestFocus,
		forestQuery,
		setForestQuery,
		searchSel,
		setSearchSel,
		searchResults,
		forestElements,
		forestTotalNodes: forestIndex.typeOf.size,
		forestVisibleNodes: forestElements?.nodes.length ?? 0,
		forestCollapsedFolders: activeCollapsed.size,
		forestViewKey: [...activeCollapsed].sort().join("|"),
		locateInForest,
	};
}
