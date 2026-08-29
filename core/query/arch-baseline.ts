// Graph Brain / core/query - 架构回路基线（A3）
//
// 单一所有者：graphbrain-arch-baseline/1 基线文件的读取、比较与原子更新。
// 复用 core/query/analysis 的 findCycles/diffCycles 纯函数与 core/schema 的
// checkGraphSchema/checkGraphReferences 校验边界，不复制第二套回路语义。
// 定位：提交后告警防线（WARN），不阻断提交/发布；基线只在计算干净完成时推进。
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { checkGraphReferences, checkGraphSchema } from "../schema/graph-checks.js";
import {
	diffCycles,
	findCycles,
	parseCycleBaseline,
	projectGraph,
	type CycleFinding,
	type GraphShape,
} from "./analysis.js";
import { renameDurableSync, writeFsyncedTemporary } from "../store/durable-write.js";

export const ARCH_BASELINE_FORMAT = "graphbrain-arch-baseline/1" as const;

export interface ArchitectureBaselineDocument {
	format_version: typeof ARCH_BASELINE_FORMAT;
	subsystem: string;
	generated_at: string;
	cycles: CycleFinding[];
}

export interface ArchitectureBaselineUpdate {
	baselinePath: string;
	added: CycleFinding[];
	removed: CycleFinding[];
	unchanged: CycleFinding[];
	/** 每条对应一条 WARN 日志行（新增回路）。 */
	warnings: string[];
}

export function architectureBaselinePath(root: string): string {
	return join(resolve(root), "data", "architecture-baseline.json");
}

function loadBaseline(path: string, subsystem: string): CycleFinding[] {
	if (!existsSync(path)) return [];
	const content = readFileSync(path, "utf8");
	const parsed: unknown = JSON.parse(content.replace(/^\uFEFF/, ""));
	const doc = parsed as { format_version?: unknown; subsystem?: unknown };
	if (doc.format_version !== ARCH_BASELINE_FORMAT) {
		throw new Error(`回路基线格式不受承认：${String(doc.format_version)}（期望 ${ARCH_BASELINE_FORMAT}）`);
	}
	if (doc.subsystem !== subsystem) {
		throw new Error(`回路基线属于 subsystem=${String(doc.subsystem)}，与请求的 ${subsystem} 不符`);
	}
	return parseCycleBaseline(content);
}

function validatedGraph(graph: unknown): GraphShape {
	// schema 校验先以 unknown 进入（宪法第 12 条）；通过后才进入 analysis 投影类型。
	const schemaErrors = checkGraphSchema(graph);
	if (schemaErrors.length > 0) throw new Error(`回路门禁输入图未通过 schema 校验：${schemaErrors.slice(0, 3).join("; ")}`);
	const referenceErrors = checkGraphReferences(graph as Parameters<typeof checkGraphReferences>[0]);
	if (referenceErrors.length > 0) throw new Error(`回路门禁输入图未通过引用校验：${referenceErrors.slice(0, 3).join("; ")}`);
	return graph as unknown as GraphShape;
}

export interface ArchitectureBaselineAssessment {
	baselinePath: string;
	current: CycleFinding[];
	added: CycleFinding[];
	removed: CycleFinding[];
	unchanged: CycleFinding[];
	/** 每条对应一条 WARN 日志行（新增回路）。 */
	warnings: string[];
}

/**
 * 只读比较：对给定图跑 findCycles 并与基线 diff，不落盘。
 * E3 gate:arch 与 A3 hook 记录共用这一份比较语义。
 */
export function assessCycles(input: { root: string; subsystem: string; graph: unknown }): ArchitectureBaselineAssessment {
	const baselinePath = architectureBaselinePath(input.root);
	const shape = validatedGraph(input.graph);
	const pg = projectGraph(shape);
	const current = findCycles(pg);
	const baseline = loadBaseline(baselinePath, input.subsystem);
	const diff = diffCycles(baseline, current);
	const warnings = diff.added.map((cycle) => `新增依赖回路（${cycle.nodes.length} 节点）：${cycle.nodes.join(" -> ")}`);
	return { baselinePath, current, added: diff.added, removed: diff.removed, unchanged: diff.unchanged, warnings };
}

/** 把当前回路集原子写为新基线。仅在计算干净完成后调用。 */
export function writeBaselineDocument(baselinePath: string, subsystem: string, cycles: CycleFinding[]): void {
	const document: ArchitectureBaselineDocument = {
		format_version: ARCH_BASELINE_FORMAT,
		subsystem,
		generated_at: new Date().toISOString(),
		cycles,
	};
	mkdirSync(dirname(baselinePath), { recursive: true });
	writeFsyncedTemporary(
		`${baselinePath}.tmp-${process.pid}`,
		`${JSON.stringify(document, null, 2)}\n`,
	);
	renameDurableSync(`${baselinePath}.tmp-${process.pid}`, baselinePath);
}

/**
 * assessCycles + 基线推进：hook 提交后告警防线入口。
 * - 新增回路 → warnings（hook 以 WARN 记录）；
 * - 计算成功后把当前回路集原子写为新基线；
 * - 任何解析/校验失败都抛错，由调用方决定降级策略（hook 只记日志不失败）。
 */
export function assessAndRecordCycles(input: { root: string; subsystem: string; graph: unknown }): ArchitectureBaselineUpdate {
	const assessment = assessCycles(input);
	writeBaselineDocument(assessment.baselinePath, input.subsystem, assessment.current);
	return { ...assessment };
}
