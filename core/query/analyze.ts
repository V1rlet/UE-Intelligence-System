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
	projectGraph,
	resolveSeedsFromFiles,
	type CouplingReport,
	type CycleBaselineDiff,
	type CycleFinding,
	type ForwardClosureReport,
	type GraphShape,
	type ImpactReport,
} from "./analysis.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GRAPHS_DIR = join(ROOT, "data", "graphs");

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

function main(): void {
	const graphArg = optionValue("--graph");
	if (!graphArg) {
		throw new Error("用法: analyze --graph <文件|前缀> [--cycles] [--coupling] [--impact <id,..>] [--impact-files <file,..>] [--forward-closure <id,..>] [--cycle-baseline <path>] [--group-by module|system] [--out <目录>]");
	}

	const graphPath = resolveGraphPath(graphArg);
	const graph = JSON.parse(readFileSync(graphPath, "utf-8").replace(/^\uFEFF/, "")) as GraphShape;
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
	if (cycles && baselinePath && existsSync(baselinePath)) {
		const baselineFile = JSON.parse(readFileSync(baselinePath, "utf-8")) as { cycles?: CycleFinding[] };
		cycleDiff = diffCycles(baselineFile.cycles ?? [], cycles);
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
