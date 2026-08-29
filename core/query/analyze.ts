// Read-only UE code architecture analysis CLI.
// By default results are printed only. Pass --out explicitly to persist a factual report.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	couplingReport,
	diffCycles,
	findCycles,
	forwardClosure,
	impactAnalysis,
	parseCycleBaseline,
	projectGraph,
	resolveSeedsFromFiles,
	type CouplingReport,
	type CycleBaselineDiff,
	type CycleFinding,
	type ForwardClosureReport,
	type GraphShape,
	type ImpactReport,
} from "./analysis.js";
import { checkGraphReferences, checkGraphSchema, type GraphShape as ValidatedGraphShape } from "../schema/graph-checks.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GRAPHS_DIR = join(ROOT, "data", "graphs");
const PUBLICATIONS_FILE = join(ROOT, "data", "publications", "ue5_code.json");

function optionValue(name: string): string | null {
	const index = process.argv.indexOf(name);
	return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

function hasFlag(name: string): boolean {
	return process.argv.includes(name);
}

function resolveGraphPath(input: string): string {
	if (existsSync(input)) return resolve(input);
	const match = readdirSync(GRAPHS_DIR)
		.filter((file) => file.endsWith(".cyto.json") && file.startsWith(input))
		.sort()
		.reverse()[0];
	if (!match) throw new Error(`找不到代码图文件或前缀: ${input}`);
	return join(GRAPHS_DIR, match);
}

/** 图文件的单一加载边界：schema + 引用完整性校验后进入分析（未知 JSON 不裸转型）。 */
function loadGraphFile(graphPath: string): GraphShape {
	const parsed: unknown = JSON.parse(readFileSync(graphPath, "utf8").replace(/^\uFEFF/, ""));
	const schemaErrors = checkGraphSchema(parsed);
	if (schemaErrors.length > 0) throw new Error(`代码图不符合 schema（${basename(graphPath)}）: ${schemaErrors.slice(0, 3).join("; ")}`);
	const graph = parsed as ValidatedGraphShape;
	const referenceErrors = checkGraphReferences(graph);
	if (referenceErrors.length > 0) throw new Error(`代码图引用不完整（${basename(graphPath)}）: ${referenceErrors.slice(0, 3).join("; ")}`);
	return parsed as GraphShape;
}

/** D1 跨代趋势：按发布代次时间序输出 单元/依赖对/回路 计数（只读，不落盘）。 */
function runTrend(subsystem: string): void {
	const state = JSON.parse(readFileSync(PUBLICATIONS_FILE, "utf-8")) as {
		publications?: Array<{ subsystem?: string; generations?: Array<{ id: string; published_at?: string | null; graph: { file: string } }> }>;
	};
	const generations = state.publications?.find((item) => item.subsystem === subsystem)?.generations ?? [];
	if (generations.length === 0) throw new Error(`publication 中没有 ${subsystem} 的历史代次`);
	console.log(`跨代趋势（${subsystem}，${generations.length} 个代次，旧→新）`);
	console.log("generation | published | units | pairs | cycles");
	for (const generation of [...generations].reverse()) {
		const graphPath = join(GRAPHS_DIR, generation.graph.file);
		if (!existsSync(graphPath)) {
			console.log(`${generation.id.replace("generation-", "").slice(0, 12)}… | ${generation.published_at?.slice(0, 10) ?? "?"} | 缺失文件 ${generation.graph.file}`);
			continue;
		}
		const shape = loadGraphFile(graphPath);
		const projected = projectGraph(shape);
		const cycles = findCycles(projected);
		console.log(`${generation.id.replace("generation-", "").slice(0, 12)}… | ${generation.published_at?.slice(0, 10) ?? "?"} | ${projected.units.length} | ${projected.pairCount} | ${cycles.length}`);
	}
}

 function main(): void {
	if (hasFlag("--trend")) {
		runTrend(optionValue("--subsystem") ?? "project");
		return;
	}
	const graphArg = optionValue("--graph");
	if (!graphArg) {
		throw new Error("用法: analyze --graph <文件|前缀> [--trend] [--cycles] [--coupling] [--impact <id,..>] [--forward-closure <id,..>] [--cycle-baseline <path>] [--group-by module|system] [--out <目录>]");
	}
	const graphPath = resolveGraphPath(graphArg);
	const graph = loadGraphFile(graphPath);
	const meta = (graph.meta ?? {}) as Record<string, unknown>;
	if (meta.domain !== "ue5_code") {
		throw new Error(`GraphBrain 只分析 ue5_code 图，收到 ${String(meta.domain ?? "未声明")}`);
	}

	const groupByArg = optionValue("--group-by") ?? "module";
	if (groupByArg !== "module" && groupByArg !== "system") {
		throw new Error(`--group-by 只接受 module 或 system，收到 ${groupByArg}`);
	}
	const groupBy = groupByArg as "module" | "system";
	const impactIds = optionValue("--impact")?.split(",").filter(Boolean) ?? [];
	const impactFiles = optionValue("--impact-files")?.split(",").filter(Boolean) ?? [];
	const forwardIds = optionValue("--forward-closure")?.split(",").filter(Boolean) ?? [];
	const wantImpact = impactIds.length > 0 || impactFiles.length > 0;
	const wantForward = forwardIds.length > 0;
	const wantCycles = hasFlag("--cycles") || (!hasFlag("--coupling") && !wantImpact && !wantForward);
	const wantCoupling = hasFlag("--coupling") || (!hasFlag("--cycles") && !wantImpact && !wantForward);

	const projected = projectGraph(graph);
	console.log(`代码图: ${basename(graphPath)}（架构单元 ${projected.units.length}，依赖对 ${projected.pairCount}）`);

	let cycles: CycleFinding[] | null = null;
	if (wantCycles) {
		cycles = findCycles(projected);
		console.log(`依赖回路: ${cycles.length}`);
		for (const cycle of cycles) console.log(`  ${cycle.exampleCycle.join(" -> ")}`);
	}

	let coupling: CouplingReport | null = null;
	if (wantCoupling) {
		coupling = couplingReport(projected, groupBy);
		console.log(`耦合分组: ${coupling.groups.length}（按 ${groupBy}）`);
		for (const node of coupling.nodes.slice(0, 10)) {
			console.log(`  ${node.id}: bc=${node.betweenness.toFixed(4)} fanIn=${node.fanIn} fanOut=${node.fanOut}`);
		}
	}

	let impact: ImpactReport | null = null;
	if (wantImpact) {
		const seeds = [...impactIds, ...resolveSeedsFromFiles(graph, impactFiles)];
		impact = impactAnalysis(projected, seeds, groupBy);
		console.log(`反向影响: ${impact.seeds.length} 个种子，${impact.totalAffected} 个受影响单元`);
		for (const layer of impact.byDepth) console.log(`  ${layer.depth} 跳: ${layer.nodes.join("、")}`);
		if (impact.unknownSeeds.length) console.log(`  未命中: ${impact.unknownSeeds.join("、")}`);
	}

	let forward: ForwardClosureReport | null = null;
	if (wantForward) {
		forward = forwardClosure(projected, forwardIds, groupBy);
		console.log(`正向依赖: ${forward.seeds.length} 个种子，${forward.totalAffected} 个依赖单元`);
		for (const layer of forward.byDepth) console.log(`  ${layer.depth} 跳: ${layer.nodes.join("、")}`);
		if (forward.unknownSeeds.length) console.log(`  未命中: ${forward.unknownSeeds.join("、")}`);
	}

	let cycleDiff: CycleBaselineDiff | null = null;
	const baselinePath = optionValue("--cycle-baseline");
	if (cycles && baselinePath) {
		// 显式指定的基线必须存在：路径打错时静默跳过会把"回路回归信号"变成空输出。
		if (!existsSync(baselinePath)) throw new Error(`回路基线文件不存在: ${baselinePath}`);
		const baselineFile = parseCycleBaseline(readFileSync(baselinePath, "utf-8"));
		cycleDiff = diffCycles(baselineFile, cycles);
		console.log(`回路变化: +${cycleDiff.added.length} / -${cycleDiff.removed.length}`);
	}

	const outArg = optionValue("--out");
	if (!outArg) return;
	const outDir = resolve(outArg);
	mkdirSync(outDir, { recursive: true });
	const generatedAt = new Date().toISOString();
	const day = generatedAt.slice(0, 10);
	const subsystem = String(meta.subsystem ?? "unknown");
	const base = `ue5_code_${subsystem}_analysis_${day}`;
	const payload = {
		format_version: 1,
		kind: "ue5_code_architecture_analysis",
		graph: basename(graphPath),
		generatedAt,
		units: projected.units.length,
		pairs: projected.pairCount,
		cycles,
		cycleDiff,
		coupling,
		impact,
		forward,
	};
	writeFileSync(join(outDir, `${base}.json`), `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
	const markdown = [
		`# UE 代码架构分析 — ${subsystem}`,
		"",
		`- 图：${basename(graphPath)}`,
		`- 架构单元：${projected.units.length}`,
		`- 依赖对：${projected.pairCount}`,
		`- 生成时间：${generatedAt}`,
		"",
		`完整结构化结果见 \`${base}.json\`。`,
		"",
	].join("\n");
	writeFileSync(join(outDir, `${base}.md`), markdown, "utf-8");
	console.log(`事实报告: ${join(outDir, `${base}.json`)}`);
}

try {
	main();
} catch (error) {
	console.error((error as Error).message);
	process.exitCode = 1;
}
