// Graph Brain / adapters/ue5-code - 模块级提取器：解析 *.Build.cs → 模块依赖图 (.cyto.json)
//
// 用法：
//   npx tsx adapters/ue5-code/extract-modules.ts <SourceDir...> [--out data/graphs] [--subsystem modules]
//
// 提取规则：
//   - 递归扫描输入目录下所有 *.Build.cs
//   - 模块名取 `public class X : ModuleRules` 的 X（缺失时回退文件名）
//   - PublicDependencyModuleNames → depends_on 边 weight=5
//   - PrivateDependencyModuleNames → depends_on 边 weight=2（同一依赖 Public 优先）
//   - 支持 AddRange(new string[]{...}) 与 Add("...") 两种写法；解析前剥离 C# 注释，
//     避免把注释掉的依赖（模板工程常见）误提取进图
//
// DECISION: 扫描到 Build.cs 的模块 layer="project" + visibility="explored"；
//           仅作为依赖出现的模块 layer="engine" + visibility="silhouette"
// REASON: 依赖列表只证明"项目直接接触了该引擎模块"，对应三态规则中
//         Fog→Silhouette 的自动触发条件（#include/依赖即入轮廓态）；
//         其内部结构尚未解析，不应标记 explored。
// DATE: 2026-07-02

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

// ████████████████████████████████████████████████████████████████████████████
//  Build.cs 解析
// ████████████████████████████████████████████████████████████████████████████

interface ParsedModule {
	name: string;
	buildCsPath: string;
	publicDeps: string[];
	privateDeps: string[];
}

/** 剥离 C# 的 // 与 /* *\/ 注释，字符串字面量内部原样保留 */
function stripCSharpComments(src: string): string {
	let out = "";
	let i = 0;
	let inString = false;
	while (i < src.length) {
		const c = src[i];
		const d = src[i + 1];
		if (inString) {
			out += c;
			if (c === "\\" && d !== undefined) {
				out += d;
				i += 2;
				continue;
			}
			if (c === '"') inString = false;
			i++;
			continue;
		}
		if (c === '"') {
			inString = true;
			out += c;
			i++;
			continue;
		}
		if (c === "/" && d === "/") {
			while (i < src.length && src[i] !== "\n") i++;
			continue;
		}
		if (c === "/" && d === "*") {
			i += 2;
			while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
			i += 2;
			out += " ";
			continue;
		}
		out += c;
		i++;
	}
	return out;
}

/** 提取某个依赖列表（AddRange + Add 两种写法）中的全部模块名 */
function extractDeps(cleaned: string, listName: string): string[] {
	const deps = new Set<string>();
	const rangeRe = new RegExp(
		String.raw`\b${listName}\s*\.\s*AddRange\s*\(\s*new\s+string\s*\[\s*\]\s*\{([^}]*)\}`,
		"g",
	);
	for (const m of cleaned.matchAll(rangeRe)) {
		for (const s of m[1].matchAll(/"([^"]+)"/g)) deps.add(s[1]);
	}
	const addRe = new RegExp(String.raw`\b${listName}\s*\.\s*Add\s*\(\s*"([^"]+)"\s*\)`, "g");
	for (const m of cleaned.matchAll(addRe)) deps.add(m[1]);
	return [...deps];
}

function parseBuildCs(filePath: string): ParsedModule {
	const cleaned = stripCSharpComments(readFileSync(filePath, "utf-8"));
	const classMatch = cleaned.match(/public\s+class\s+(\w+)\s*:\s*ModuleRules/);
	const name = classMatch?.[1] ?? basename(filePath).replace(/\.Build\.cs$/i, "");
	return {
		name,
		buildCsPath: filePath,
		publicDeps: extractDeps(cleaned, "PublicDependencyModuleNames"),
		privateDeps: extractDeps(cleaned, "PrivateDependencyModuleNames"),
	};
}

function findBuildCsFiles(root: string): string[] {
	const results: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const p = join(root, entry.name);
		if (entry.isDirectory()) results.push(...findBuildCsFiles(p));
		else if (entry.name.endsWith(".Build.cs")) results.push(p);
	}
	return results;
}

// ████████████████████████████████████████████████████████████████████████████
//  图谱构建
// ████████████████████████████████████████████████████████████████████████████

interface NodeEl {
	data: {
		id: string;
		label: string;
		type: "module";
		layer: "engine" | "project";
		module: string;
		domain: "ue5_code";
		source_path?: string;
		visibility: "explored" | "silhouette";
		metrics: { in_degree: number; out_degree: number };
	};
}

interface EdgeEl {
	data: {
		id: string;
		source: string;
		target: string;
		relation: "depends_on";
		domain: "ue5_code";
		weight: number;
		description: string;
	};
}

function buildGraph(modules: ParsedModule[], sourceRoots: string[]) {
	const projectNames = new Set(modules.map((m) => m.name));
	const nodes = new Map<string, NodeEl>();
	const edges = new Map<string, EdgeEl>();

	for (const m of modules) {
		nodes.set(m.name, {
			data: {
				id: m.name,
				label: m.name,
				type: "module",
				layer: "project",
				module: m.name,
				domain: "ue5_code",
				source_path: relative(process.cwd(), m.buildCsPath).replaceAll("\\", "/"),
				visibility: "explored",
				metrics: { in_degree: 0, out_degree: 0 },
			},
		});
	}

	// Public 先处理，保证同一依赖同时出现在两个列表时保留 weight=5
	const addEdge = (src: string, dep: string, weight: number, desc: string) => {
		if (!nodes.has(dep)) {
			nodes.set(dep, {
				data: {
					id: dep,
					label: dep,
					type: "module",
					layer: projectNames.has(dep) ? "project" : "engine",
					module: dep,
					domain: "ue5_code",
					visibility: "silhouette",
					metrics: { in_degree: 0, out_degree: 0 },
				},
			});
		}
		const id = `${src}--depends_on-->${dep}`;
		if (!edges.has(id)) {
			edges.set(id, {
				data: { id, source: src, target: dep, relation: "depends_on", domain: "ue5_code", weight, description: desc },
			});
		}
	};

	for (const m of modules) {
		for (const dep of m.publicDeps) addEdge(m.name, dep, 5, "PublicDependencyModuleNames");
		for (const dep of m.privateDeps) addEdge(m.name, dep, 2, "PrivateDependencyModuleNames");
	}

	for (const e of edges.values()) {
		nodes.get(e.data.source)!.data.metrics.out_degree++;
		nodes.get(e.data.target)!.data.metrics.in_degree++;
	}

	return {
		meta: {
			domain: "ue5_code",
			subsystem: SUBSYSTEM,
			generated_at: new Date().toISOString(),
			generator: "ue5-code-adapter/extract-modules@0.1.0",
			source_root: sourceRoots.map((r) => resolve(r).replaceAll("\\", "/")).join(";"),
		},
		elements: { nodes: [...nodes.values()], edges: [...edges.values()] },
	};
}

// ████████████████████████████████████████████████████████████████████████████
//  入口
// ████████████████████████████████████████████████████████████████████████████

const argv = process.argv.slice(2);
const roots: string[] = [];
let outDir = "data/graphs";
let SUBSYSTEM = "modules";
for (let i = 0; i < argv.length; i++) {
	if (argv[i] === "--out") outDir = argv[++i];
	else if (argv[i] === "--subsystem") SUBSYSTEM = argv[++i];
	else roots.push(argv[i]);
}
if (roots.length === 0) {
	console.error("用法: npx tsx adapters/ue5-code/extract-modules.ts <SourceDir...> [--out data/graphs] [--subsystem modules]");
	process.exit(2);
}

const buildCsFiles = roots.flatMap((r) => findBuildCsFiles(resolve(r)));
if (buildCsFiles.length === 0) {
	console.error(`未找到任何 *.Build.cs：${roots.join(", ")}`);
	process.exit(1);
}

const modules = buildCsFiles.map(parseBuildCs);
for (const m of modules) {
	console.log(`解析 ${m.name}: public=${m.publicDeps.length}, private=${m.privateDeps.length}  (${m.buildCsPath})`);
}

const graph = buildGraph(modules, roots);
const date = new Date().toISOString().slice(0, 10);
const outPath = join(outDir, `ue5_code_${SUBSYSTEM}_${date}.cyto.json`);
mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, JSON.stringify(graph, null, 2) + "\n", "utf-8");
console.log(
	`\n已生成 ${outPath}: ${graph.elements.nodes.length} 个节点, ${graph.elements.edges.length} 条边`,
);
