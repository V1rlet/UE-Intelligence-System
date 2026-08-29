// Graph Brain / tools - archify-bridge：Evidence API → Archify architecture IR 映射器
//
// 方案 B（archify 协作报告）：Archify 是呈现层，GraphBrain 是证据层；本工具是两者之间
// 的薄映射。只消费 Evidence API（与外部消费者同一 fail-closed 通道），不直读 data/ 内部
// 状态；输出的 candidate JSON 交给 archify CLI validate/deliver，本工具不做渲染。
// 派生视图遵守宪法第 11 条：图必须携带 snapshot/freshness 声明（cards），不成为第二事实源。
//
// 用法：npm run archify:bridge -- --class ASabotageCharacter [--depth 1] [--out <dir>] [--base URL]
// 产物：<out>/archify-<Class>.candidate.json（schema_version 1 / architecture / showcase）

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ── 类型（只声明本工具消费的字段；API 是外部输入，字段全部防御式读取） ──
interface EvidenceStatus {
	snapshot_id?: unknown;
	freshness?: unknown;
	publication_revision?: unknown;
	evidence_revision?: unknown;
}
interface EvidenceSymbol {
	id?: unknown;
	label?: unknown;
	type?: unknown;
	module?: unknown;
	layer?: unknown;
	source?: { path?: unknown; span?: { start_line?: unknown } | null } | null;
	evidence?: { classification?: unknown; method?: unknown; confidence?: unknown } | null;
}
interface EvidenceRelation {
	source_id?: unknown;
	target_id?: unknown;
	relation?: unknown;
}
interface Neighborhood {
	center_id?: unknown;
	symbols?: unknown;
	relations?: unknown;
}

export interface ArchifyComponent {
	id: string;
	type: string;
	label: string;
	sublabel?: string;
	/** layout.mode=grid 时 schema 要求的网格坐标（由桥按确定性顺序摆放）。 */
	row: number;
	col: number;
}
export interface ArchifyConnection {
	from: string;
	to: string;
	label?: string;
	/** 标签偏移：沿边方向把标签推出组件矩形（showcase 几何诊断）。 */
	labelDx?: number;
	labelDy?: number;
	/** 自愈轮次由 validator 诊断回填的绝对标签位。 */
	labelAt?: [number, number];
}
export interface ArchifyCard {
	dot: string;
	title: string;
	items: string[];
}
export interface ArchifyArchitectureIR {
	schema_version: 1;
	diagram_type: "architecture";
	meta: { title: string; quality_profile: "showcase" };
	/** archify v2.16 architecture 自动布局（schema enum 仅 grid）；桥不手摆坐标。 */
	layout: { mode: "grid"; cols: number };
	components: ArchifyComponent[];
	connections: ArchifyConnection[];
	cards: ArchifyCard[];
}

// UE 类型 → archify 组件类型（研究报告实证映射）
const TYPE_MAP: Record<string, string> = {
	uclass: "backend", uactor: "backend", ucomponent: "backend", uinterface: "backend",
	ufunction: "backend", ustruct: "database", uenum: "database", module: "cloud",
	blueprint: "external",
};
const REL_LABEL: Record<string, string> = {
	inherits: "inherits", composes: "composes", depends_on: "depends on", calls: "calls",
	delegates: "delegates", owns: "owns", creates: "creates", implements: "implements",
	uses_member: "uses", binds_event: "binds", aggregates: "aggregates", loads: "loads",
};
/** showcase 质量档的节点上限（archify 作者契约：≤12 主节点） */
export const MAX_COMPONENTS = 12;

function str(value: unknown, fallback = ""): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return fallback;
}

function asSymbolArray(value: unknown): EvidenceSymbol[] {
	if (!Array.isArray(value)) throw new Error("neighborhood.symbols 不是数组");
	return value.filter((item): item is EvidenceSymbol => Boolean(item && typeof item === "object" && typeof (item as EvidenceSymbol).id === "string"));
}

function asRelationArray(value: unknown): EvidenceRelation[] {
	if (!Array.isArray(value)) throw new Error("neighborhood.relations 不是数组");
	return value.filter((item): item is EvidenceRelation => Boolean(item && typeof item === "object"));
}

/**
 * 邻域 → archify architecture IR。
 * 节点选择：中心必选；其余按 项目层优先 → id 字典序 排序，总数封顶 MAX_COMPONENTS。
 * 关系只保留两端都入选的；自环丢弃。
 */
export function mapNeighborhoodToArchitectureIR(
	centerId: string,
	status: EvidenceStatus,
	neighborhood: Neighborhood,
	options?: { title?: string; labels?: boolean },
): ArchifyArchitectureIR {
	const symbols = asSymbolArray(neighborhood.symbols);
	const relations = asRelationArray(neighborhood.relations);
	if (symbols.length === 0) throw new Error(`邻域为空：${centerId} 不在当前证据快照中，或证据已失效（freshness gate）`);

	const center = symbols.find((s) => s.id === centerId) ?? symbols[0];
	const others = symbols
		.filter((s) => s.id !== center.id)
		.sort((a, b) =>
			Number(str(b.layer) === "project") - Number(str(a.layer) === "project")
			|| str(a.id).localeCompare(str(b.id)));
	const chosen = [center, ...others].slice(0, MAX_COMPONENTS);
	const uidOf = new Map(chosen.map((s, index) => [s.id as string, `c${index}`]));
	// 星形摆放：中心 (1,1)，邻域按内环→四角→底排铺开——邻域图是辐射拓扑，
	// 线性网格会让连线穿过中间组件（showcase 的 edge-through-node 诊断）。
	// 12 个唯一槽位对应 MAX_COMPONENTS。
	const STAR_SLOTS: Array<[number, number]> = [
		[1, 1],
		[0, 1], [1, 0], [1, 2], [2, 1],
		[0, 0], [0, 2], [2, 0], [2, 2],
		[3, 0], [3, 1], [3, 2],
	];

	const components: ArchifyComponent[] = chosen.map((s, index) => {
		const type = TYPE_MAP[str(s.type)] ?? "backend";
		const [row, col] = STAR_SLOTS[index];
		const comp: ArchifyComponent = {
			id: uidOf.get(s.id as string)!,
			type,
			label: str(s.label, str(s.id)),
			row,
			col,
		};
		const sub = [str(s.module), str(s.layer)].filter(Boolean);
		if (sub.length > 0) comp.sublabel = sub.join(" / ");
		return comp;
	});

	const connections: ArchifyConnection[] = [];
	for (const rel of relations) {
		const from = uidOf.get(str(rel.source_id));
		const to = uidOf.get(str(rel.target_id));
		if (!from || !to || from === to) continue;
		const relation = str(rel.relation);
		// 默认不带边标签：平行同标签边在 showcase 下互相拥挤，且手调偏移违背
		// archify 的"不手摆坐标"纪律；关系语义由证据卡与组件 sublabel 承载。
		connections.push({ from, to, ...(options?.labels ? { label: REL_LABEL[relation] ?? relation } : {}) });
	}

	// 证据墙：snapshot / freshness / revision 随图交付（archify 不保存 provenance 字段，
	// cards 是唯一通道——图本身不得冒充事实）。
	const centerSource = center.source ?? {};
	const centerEvidence = center.evidence ?? {};
	const cards: ArchifyCard[] = [{
		dot: "cyan",
		title: "Evidence (GraphBrain)",
		items: [
			`snapshot ${str(status.snapshot_id).slice(0, 19)}`,
			`freshness ${str(status.freshness, "unknown")} / publication rev ${str(status.publication_revision)}`,
			`classification ${str(centerEvidence.classification)} / method ${str(centerEvidence.method)} / confidence ${str(centerEvidence.confidence)}`,
			`source ${str(centerSource.path)}${centerSource.span?.start_line != null ? ` @ L${centerSource.span.start_line}` : ""}`,
		],
	}];

	return {
		schema_version: 1,
		diagram_type: "architecture",
		meta: {
			title: options?.title ?? `${str(center.label, centerId)} Neighborhood (GraphBrain Evidence)`,
			quality_profile: "showcase",
		},
		layout: { mode: "grid", cols: 3 },
		components,
		connections,
		cards,
	};
}

// ── CLI（仅在直接运行时执行；被测试/工具导入时只导出纯映射函数） ────────────
async function fetchJson<T>(base: string, path: string, params?: Record<string, string>): Promise<T> {
	const url = params ? `${base}${path}?${new URLSearchParams(params)}` : `${base}${path}`;
	const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
	if (!response.ok) throw new Error(`Evidence API ${path} → HTTP ${response.status}`);
	return await response.json() as T;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
	const argv = process.argv.slice(2);
	const get = (flag: string) => {
		const index = argv.indexOf(flag);
		return index >= 0 ? argv[index + 1] : undefined;
	};
	const className = get("--class");
	if (!className) {
		console.error("用法：npm run archify:bridge -- --class <类名> [--out <目录>] [--base <URL>] [--archify <archify/bin 路径>] [--depth 1]");
		process.exit(2);
	}
	const out = resolve(get("--out") ?? "docs/archify-samples");
	const base = get("--base") ?? "http://127.0.0.1:3030/api/evidence/v1";
	const archifyBin = get("--archify");

	const status = await fetchJson<EvidenceStatus>(base, "/status");
	const neighborhood = await fetchJson<Neighborhood>(base, "/neighborhood", { id: className, depth: get("--depth") ?? "1" });
	const ir = mapNeighborhoodToArchitectureIR(className, status, neighborhood, { labels: argv.includes("--labels") });

	mkdirSync(out, { recursive: true });
	const file = join(out, `archify-${className}.candidate.json`);
	writeFileSync(file, JSON.stringify(ir, null, 2), "utf8");
	console.log(`[archify-bridge] ${ir.components.length} 组件 / ${ir.connections.length} 连接 → ${file}`);

	// archify 自愈纪律：validate → 只改诊断点 → 最多两轮聚焦修复；不通过则如实报告。
	if (archifyBin) {
		const { spawnSync } = await import("node:child_process");
		const validateOnce = (): { ok: boolean; diagnostics: Array<{ message?: unknown }>; raw: string } => {
			const run = spawnSync(process.execPath, [archifyBin, "validate", "architecture", file, "--quality", "showcase", "--json"], { encoding: "utf8", windowsHide: true, timeout: 120_000 });
			const receipt = JSON.parse(run.stdout || "{}") as { ok?: boolean; diagnostics?: Array<{ message?: unknown }> };
			return { ok: receipt.ok === true, diagnostics: receipt.diagnostics ?? [], raw: run.stdout };
		};
		let round = 0;
		let result = validateOnce();
		while (!result.ok && round < 2) {
			round += 1;
			let applied = 0;
			for (const diag of result.diagnostics) {
				const message = String(diag.message ?? "");
				const overlap = message.match(/Label "([^"]+)" overlaps component "(c\d+)"/);
				const suggest = message.match(/labelAt \[(\d+), (\d+)\]/);
				if (!overlap || !suggest) continue;
				const conn = ir.connections.find((c) => c.label === overlap[1] && (c.from === overlap[2] || c.to === overlap[2]) && !c.labelAt);
				if (!conn) continue;
				conn.labelAt = [Number(suggest[1]), Number(suggest[2])];
				applied += 1;
			}
			if (applied === 0) break;
			writeFileSync(file, JSON.stringify(ir, null, 2), "utf8");
			console.log(`[archify-bridge] 自愈第 ${round} 轮：应用 ${applied} 处 labelAt 修正`);
			result = validateOnce();
		}
		if (result.ok) console.log("[archify-bridge] showcase 校验通过 ✓");
		else {
			console.error("[archify-bridge] showcase 校验未通过（两轮聚焦修复后仍存在诊断），如实保留候选：");
			console.error(result.raw.slice(0, 1200));
			process.exitCode = 1;
		}
	} else {
		console.log(`[archify-bridge] 下一步：node <archify>/bin/archify.mjs validate architecture "${file}" --quality showcase --json`);
	}
}
