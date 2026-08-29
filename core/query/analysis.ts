// Graph Brain / core/query - 图分析算法库（P5U3）：回路检测 + 耦合度报告 + 变更影响面
//
// 纯函数，无 I/O（CLI 外壳在 analyze.ts；hook 经 CLI 调用）。
//
// DECISION: 分析在"类级依赖投影"上进行——函数级端点（Cls::Fn）归并到所属类，
//           结构性边（contains/lifecycle_sequence/overrides→lifecycle_step 等）排除
// REASON: 回路/耦合/影响面回答的是"架构单元之间"的问题；函数级边（uses_member）
//         是类依赖的证据而非独立分析对象，折叠后一条 Cls→Target 依赖不重复计数；
//         森林 contains 与生命周期叠加层是展示结构，混入会制造假回路/假耦合。
// DATE: 2026-07-06
//
// DECISION: 影响面 = 依赖边的**反向**可达闭包（X→seed 表示 X 依赖 seed，改 seed 波及 X）
// REASON: 与边语义一致（inherits/composes/depends_on 的 source 都是依赖方）；
//         正向闭包（seed 依赖谁）不是"改动波及"，是"改动需要读懂什么"，不在本单元。
// DATE: 2026-07-06

import { resolveCodeModule, UNASSIGNED_MODULE_LABEL } from "./code-module.js";

// ████████████████████████████████████████████████████████████████████████████
//  类型与投影
// ████████████████████████████████████████████████████████████████████████████

interface AnyNode {
	data: {
		id: string;
		type?: string;
		module?: string;
		system?: string;
		layer?: string;
		parent?: string;
		metrics?: { in_degree?: number; out_degree?: number; betweenness?: number };
		[k: string]: unknown;
	};
}
interface AnyEdge {
	data: { id: string; source: string; target: string; relation: string; [k: string]: unknown };
}
export interface GraphShape {
	meta?: Record<string, unknown>;
	elements: { nodes: AnyNode[]; edges: AnyEdge[] };
}

/** 依赖语义边（参与分析）；结构/展示边一律排除 */
export const DEPENDENCY_RELATIONS = new Set([
	"inherits", "implements", "composes", "aggregates", "depends_on",
	"uses_member", "calls", "delegates", "binds_event",
	// Code dependency, execution and runtime ownership relations.
	"owns", "creates", "possesses", "configures", "loads", "activates", "injects",
	"grants", "replicates_to", "binds_as_owner", "binds_as_avatar", "observes",
	"publishes", "dispatches_to", "enqueues_to", "submits_to", "synchronizes_with",
	"completes_on", "feeds",
]);

/** 不作为分析单元的节点类型（函数经 parent 归并；展示性节点直接剔除） */
const NON_UNIT_TYPES = new Set(["ufunction", "lifecycle_step", "folder", "file", "meta_group"]);

export interface ProjectedGraph {
	/** 分析单元 id（保序） */
	units: string[];
	unitSet: Set<string>;
	nodeById: Map<string, AnyNode>;
	/** 类级邻接：out[u] = u 依赖的单元们；in[u] = 依赖 u 的单元们 */
	out: Map<string, Set<string>>;
	in: Map<string, Set<string>>;
	/** 投影后仍保留的边数（去重后的单元对数不等于原始边数） */
	pairCount: number;
}

function owningUnit(id: string, nodeById: Map<string, AnyNode>): string {
	const node = nodeById.get(id);
	if (node && node.data.type === "ufunction" && node.data.parent) return String(node.data.parent);
	const cut = id.indexOf("::");
	return cut === -1 ? id : id.slice(0, cut);
}

/** 图 → 类级依赖投影 */
export function projectGraph(graph: GraphShape, relations: Set<string> = DEPENDENCY_RELATIONS): ProjectedGraph {
	const nodeById = new Map(graph.elements.nodes.map((n) => [n.data.id, n]));
	const units: string[] = [];
	const unitSet = new Set<string>();
	for (const n of graph.elements.nodes) {
		if (NON_UNIT_TYPES.has(String(n.data.type))) continue;
		if (!unitSet.has(n.data.id)) {
			unitSet.add(n.data.id);
			units.push(n.data.id);
		}
	}
	const out = new Map<string, Set<string>>();
	const inn = new Map<string, Set<string>>();
	let pairCount = 0;
	for (const e of graph.elements.edges) {
		if (!relations.has(e.data.relation)) continue;
		const s = owningUnit(e.data.source, nodeById);
		const t = owningUnit(e.data.target, nodeById);
		// 自依赖（含函数级边归并回自身类）不是架构问题（递归/内聚都正常），投影时丢弃
		if (s === t || !unitSet.has(s) || !unitSet.has(t)) continue;
		let so = out.get(s);
		if (!so) out.set(s, (so = new Set()));
		if (!so.has(t)) {
			so.add(t);
			pairCount++;
			let ti = inn.get(t);
			if (!ti) inn.set(t, (ti = new Set()));
			ti.add(s);
		}
	}
	return { units, unitSet, nodeById, out, in: inn, pairCount };
}

// ████████████████████████████████████████████████████████████████████████████
//  回路检测（Tarjan SCC + 每个环取一条最短示例路径）
// ████████████████████████████████████████████████████████████████████████████

export interface CycleFinding {
	/** 强连通分量内的全部单元 */
	nodes: string[];
	/** 一条代表性最短环路（首尾同点） */
	exampleCycle: string[];
}

export function findCycles(pg: ProjectedGraph): CycleFinding[] {
	// Tarjan（迭代版，防深图爆栈）
	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	const sccs: string[][] = [];
	let counter = 0;

	for (const root of pg.units) {
		if (index.has(root)) continue;
		const work: { node: string; iter: Iterator<string> }[] = [];
		const push = (v: string) => {
			index.set(v, counter);
			low.set(v, counter);
			counter++;
			stack.push(v);
			onStack.add(v);
			work.push({ node: v, iter: (pg.out.get(v) ?? new Set<string>())[Symbol.iterator]() });
		};
		push(root);
		while (work.length > 0) {
			const frame = work[work.length - 1];
			const next = frame.iter.next();
			if (!next.done) {
				const w = next.value;
				if (!index.has(w)) push(w);
				else if (onStack.has(w)) low.set(frame.node, Math.min(low.get(frame.node)!, index.get(w)!));
				continue;
			}
			work.pop();
			const v = frame.node;
			if (work.length > 0) {
				const parent = work[work.length - 1].node;
				low.set(parent, Math.min(low.get(parent)!, low.get(v)!));
			}
			if (low.get(v) === index.get(v)) {
				const comp: string[] = [];
				let w: string;
				do {
					w = stack.pop()!;
					onStack.delete(w);
					comp.push(w);
				} while (w !== v);
				sccs.push(comp);
			}
		}
	}

	const findings: CycleFinding[] = [];
	for (const comp of sccs) {
		// 自环在投影层已丢弃（见 projectGraph），单节点分量必然无环
		if (comp.length < 2) continue;
		findings.push({ nodes: [...comp].sort(), exampleCycle: shortestCycleIn(pg, new Set(comp)) });
	}
	return findings.sort((a, b) => a.nodes[0].localeCompare(b.nodes[0]));
}

/** 分量内从字典序最小的节点出发，BFS 找一条回到自身的最短环 */
function shortestCycleIn(pg: ProjectedGraph, comp: Set<string>): string[] {
	const start = [...comp].sort()[0];
	const prev = new Map<string, string>();
	const queue: string[] = [start];
	const seen = new Set<string>([start]);
	// 用递增头索引代替 shift()：shift 是 O(n)，大图上的 BFS/Brandes 会退化出 O(n²) 分量。
	for (let head = 0; head < queue.length; head++) {
		const cur = queue[head];
		for (const nxt of pg.out.get(cur) ?? []) {
			if (!comp.has(nxt)) continue;
			if (nxt === start) {
				// 回溯 prev 链：cur → … → start，反转后得 [start, …, cur]，闭合回 start
				const path: string[] = [];
				for (let p: string | undefined = cur; p !== undefined; p = prev.get(p)) path.push(p);
				path.reverse();
				return [...path, start];
			}
			if (!seen.has(nxt)) {
				seen.add(nxt);
				prev.set(nxt, cur);
				queue.push(nxt);
			}
		}
	}
	return [start, start];
}

// ████████████████████████████████████████████████████████████████████████████
//  介数中心性（Brandes，有向图，归一化到 [0,1]）
// ████████████████████████████████████████████████████████████████████████████

export function computeBetweenness(pg: ProjectedGraph): Map<string, number> {
	const bc = new Map<string, number>(pg.units.map((u) => [u, 0]));
	for (const s of pg.units) {
		const stack: string[] = [];
		const pred = new Map<string, string[]>();
		const sigma = new Map<string, number>([[s, 1]]);
		const dist = new Map<string, number>([[s, 0]]);
		const queue: string[] = [s];
		for (let head = 0; head < queue.length; head++) {
			const v = queue[head];
			stack.push(v);
			for (const w of pg.out.get(v) ?? []) {
				if (!dist.has(w)) {
					dist.set(w, dist.get(v)! + 1);
					queue.push(w);
				}
				if (dist.get(w) === dist.get(v)! + 1) {
					sigma.set(w, (sigma.get(w) ?? 0) + sigma.get(v)!);
					const ps = pred.get(w) ?? [];
					ps.push(v);
					pred.set(w, ps);
				}
			}
		}
		const delta = new Map<string, number>();
		while (stack.length > 0) {
			const w = stack.pop()!;
			for (const v of pred.get(w) ?? []) {
				const add = (sigma.get(v)! / sigma.get(w)!) * (1 + (delta.get(w) ?? 0));
				delta.set(v, (delta.get(v) ?? 0) + add);
			}
			if (w !== s) bc.set(w, bc.get(w)! + (delta.get(w) ?? 0));
		}
	}
	const n = pg.units.length;
	const scale = n > 2 ? 1 / ((n - 1) * (n - 2)) : 0;
	for (const [k, v] of bc) bc.set(k, v * scale);
	return bc;
}

// ████████████████████████████████████████████████████████████████████████████
//  耦合度报告（节点级 fan-in/out/betweenness + 分组级 Ca/Ce/不稳定度）
// ████████████████████████████████████████████████████████████████████████████

export interface NodeCoupling {
	id: string;
	group: string;
	fanIn: number;
	fanOut: number;
	betweenness: number;
}

export interface GroupCoupling {
	group: string;
	unitCount: number;
	internalPairs: number;
	/** 传入耦合 Ca：组外单元 → 组内单元 的依赖对数 */
	afferent: number;
	/** 传出耦合 Ce：组内单元 → 组外单元 的依赖对数 */
	efferent: number;
	/** 不稳定度 I = Ce / (Ca + Ce)，1 = 全依赖别人，0 = 全被依赖 */
	instability: number | null;
}

export interface CouplingReport {
	groupBy: string;
	nodes: NodeCoupling[];
	groups: GroupCoupling[];
}

/** 分析单元的分组归属（单一实现，耦合/影响/正向闭包共用）：module 轴走
 *  canonical 解析器（显式声明 > source_path 推断），system 轴只认显式声明，
 *  无归属落 UNASSIGNED_MODULE_LABEL（与 change-report/evidence 同一口径，
 *  见 code-module.ts 的三处消费关系说明）。不回退 layer——那是 project/engine
 *  分层不是模块，混入后同一份事实在 change-report / evidence / 分析报告里
 *  出现多种分组口径。 */
function unitGroupOf(pg: ProjectedGraph, id: string, groupBy: "module" | "system"): string {
	const data = pg.nodeById.get(id)?.data;
	if (groupBy === "system") {
		return typeof data?.system === "string" && data.system ? data.system : UNASSIGNED_MODULE_LABEL;
	}
	return resolveCodeModule((data ?? {}) as Record<string, unknown>) ?? UNASSIGNED_MODULE_LABEL;
}

export function couplingReport(pg: ProjectedGraph, groupBy: "module" | "system" = "module"): CouplingReport {
	const groupOf = (id: string): string => unitGroupOf(pg, id, groupBy);
	const bc = computeBetweenness(pg);
	const nodes: NodeCoupling[] = pg.units
		.map((id) => ({
			id,
			group: groupOf(id),
			fanIn: pg.in.get(id)?.size ?? 0,
			fanOut: pg.out.get(id)?.size ?? 0,
			betweenness: bc.get(id) ?? 0,
		}))
		.sort((a, b) => b.betweenness - a.betweenness || b.fanIn + b.fanOut - (a.fanIn + a.fanOut));

	const groups = new Map<string, GroupCoupling>();
	const ensure = (g: string): GroupCoupling => {
		let entry = groups.get(g);
		if (!entry) {
			entry = { group: g, unitCount: 0, internalPairs: 0, afferent: 0, efferent: 0, instability: null };
			groups.set(g, entry);
		}
		return entry;
	};
	for (const u of pg.units) ensure(groupOf(u)).unitCount++;
	for (const [s, targets] of pg.out) {
		for (const t of targets) {
			const gs = groupOf(s);
			const gt = groupOf(t);
			if (gs === gt) ensure(gs).internalPairs++;
			else {
				ensure(gs).efferent++;
				ensure(gt).afferent++;
			}
		}
	}
	for (const g of groups.values()) {
		const denom = g.afferent + g.efferent;
		g.instability = denom > 0 ? g.efferent / denom : null;
	}
	return {
		groupBy,
		nodes,
		groups: [...groups.values()].sort((a, b) => b.afferent + b.efferent - (a.afferent + a.efferent)),
	};
}

// ████████████████████████████████████████████████████████████████████████████
//  变更影响面（反向可达闭包，按跳数分层）
// ████████████████████████████████████████████████████████████████████████████

export interface ImpactReport {
	seeds: string[];
	/** 未在图中命中的种子输入 */
	unknownSeeds: string[];
	byDepth: { depth: number; nodes: string[] }[];
	affectedGroups: { group: string; count: number }[];
	totalAffected: number;
}

/** 反向/正向闭包共用实现：仅邻接方向不同（in = 改动波及谁，out = 改动需要读懂什么）。
 *  分层填充、分组归属等易漂移细节只此一份。 */
function closureByDirection(
	pg: ProjectedGraph,
	seedIds: string[],
	groupBy: "module" | "system",
	adjacency: "in" | "out",
): { seeds: string[]; unknownSeeds: string[]; byDepth: { depth: number; nodes: string[] }[]; affectedGroups: { group: string; count: number }[]; totalAffected: number } {
	const seeds = [...new Set(seedIds)].filter((s) => pg.unitSet.has(s));
	const unknownSeeds = [...new Set(seedIds)].filter((s) => !pg.unitSet.has(s));
	const depth = new Map<string, number>(seeds.map((s) => [s, 0]));
	let frontier = [...seeds];
	let level = 0;
	while (frontier.length > 0) {
		level++;
		const next: string[] = [];
		for (const u of frontier) {
			for (const dep of (adjacency === "in" ? pg.in : pg.out).get(u) ?? []) {
				if (!depth.has(dep)) {
					depth.set(dep, level);
					next.push(dep);
				}
			}
		}
		frontier = next;
	}
	const byDepth: { depth: number; nodes: string[] }[] = [];
	for (const [id, d] of depth) {
		if (d === 0) continue;
		while (byDepth.length < d) byDepth.push({ depth: byDepth.length + 1, nodes: [] });
		byDepth[d - 1].nodes.push(id);
	}
	for (const layer of byDepth) layer.nodes.sort();

	const groupCounts = new Map<string, number>();
	for (const [id, d] of depth) {
		if (d === 0) continue;
		const group = unitGroupOf(pg, id, groupBy);
		groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
	}
	return {
		seeds,
		unknownSeeds,
		byDepth,
		affectedGroups: [...groupCounts.entries()]
			.map(([group, count]) => ({ group, count }))
			.sort((a, b) => b.count - a.count),
		totalAffected: depth.size - seeds.length,
	};
}

export function impactAnalysis(
	pg: ProjectedGraph,
	seedIds: string[],
	groupBy: "module" | "system" = "module",
): ImpactReport {
	return closureByDirection(pg, seedIds, groupBy, "in");
}

// ████████████████████████████████████████████████████████████████████████████
//  正向闭包（P6U3："改动需要读懂什么"——种子的依赖传递闭包，正向 BFS）
// ████████████████████████████████████████████████████████████████████████████

export interface ForwardClosureReport {
	seeds: string[];
	unknownSeeds: string[];
	byDepth: { depth: number; nodes: string[] }[];
	affectedGroups: { group: string; count: number }[];
	totalAffected: number;
}

export function forwardClosure(
	pg: ProjectedGraph,
	seedIds: string[],
	groupBy: "module" | "system" = "module",
): ForwardClosureReport {
	return closureByDirection(pg, seedIds, groupBy, "out");
}

// ████████████████████████████████████████████████████████████████████████████
//  跨域影响传播（P6U3：代码类变更 → 跨域链接 → 波及叙事/关卡/任务域节点）
// ████████████████████████████████████████████████████████████████████████████

// ████████████████████████████████████████████████████████████████████████████
//  回路基线比较（P6U3：新增/消失回路检测，供 hook 告警）
// ████████████████████████████████████████████████████████████████████████████

export interface CycleBaselineDiff {
	added: CycleFinding[];
	removed: CycleFinding[];
	unchanged: CycleFinding[];
}

export function diffCycles(baseline: CycleFinding[], current: CycleFinding[]): CycleBaselineDiff {
	// JSON 序列化做键：节点 id 含逗号时 join(",") 会产生碰撞，误判 add/remove。
	const key = (c: CycleFinding) => JSON.stringify(c.nodes);
	const baseKeys = new Set(baseline.map(key));
	const currKeys = new Set(current.map(key));
	return {
		added: current.filter((c) => !baseKeys.has(key(c))),
		removed: baseline.filter((c) => !currKeys.has(key(c))),
		unchanged: current.filter((c) => baseKeys.has(key(c))),
	};
}

/** 回路基线文件的单一解析边界：BOM 剥离 + 逐条形状校验，畸形输入稳定报错而非
 *  在 diffCycles 里以裸 TypeError 崩溃。缺 cycles 字段按空基线处理（旧报告兼容）。 */
export function parseCycleBaseline(content: string): CycleFinding[] {
	const parsed: unknown = JSON.parse(content.replace(/^\uFEFF/, ""));
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("回路基线必须是 JSON 对象");
	const cycles = (parsed as { cycles?: unknown }).cycles ?? [];
	if (!Array.isArray(cycles)) throw new Error("回路基线的 cycles 字段必须是数组");
	const findings: CycleFinding[] = [];
	for (const [index, entry] of cycles.entries()) {
		if (entry === null || typeof entry !== "object") throw new Error(`回路基线 cycles[${index}] 必须是对象`);
		const nodes = (entry as { nodes?: unknown }).nodes;
		const exampleCycle = (entry as { exampleCycle?: unknown }).exampleCycle;
		if (!Array.isArray(nodes) || nodes.some((item) => typeof item !== "string")) {
			throw new Error(`回路基线 cycles[${index}].nodes 必须是字符串数组`);
		}
		if (!Array.isArray(exampleCycle) || exampleCycle.some((item) => typeof item !== "string")) {
			throw new Error(`回路基线 cycles[${index}].exampleCycle 必须是字符串数组`);
		}
		findings.push({ nodes: nodes as string[], exampleCycle: exampleCycle as string[] });
	}
	return findings;
}

/** 变更文件清单 → 种子单元（按 source_path 尾段匹配；.cpp 归并同名 .h 的类） */
export function resolveSeedsFromFiles(graph: GraphShape, files: string[]): string[] {
	const wanted = new Set(
		files
			.map((f) => f.replaceAll("\\", "/").split("/").pop() ?? "")
			.filter(Boolean)
			.map((base) => base.replace(/\.cpp$/i, ".h").toLowerCase()),
	);
	const seeds: string[] = [];
	for (const n of graph.elements.nodes) {
		if (NON_UNIT_TYPES.has(String(n.data.type))) continue;
		const sp = String(n.data.source_path ?? "").replaceAll("\\", "/").split("/").pop()?.toLowerCase();
		if (sp && wanted.has(sp)) seeds.push(n.data.id);
	}
	return seeds;
}
