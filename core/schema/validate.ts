// Graph Brain / core/schema - JSON Schema 验证 CLI：对 graph / annotation 文件做结构校验
//
// 用法：
//   npx tsx core/schema/validate.ts <file...>        显式指定文件
//   npm run validate:examples                        验证 core/schema/examples/ 下的示例
//
// 文件类型判定：*.cyto.json → graph schema；*_annotations.json → annotation schema；
// 其余按内容嗅探（含 elements 键 → graph；顶层数组 → annotation）。
//
// DECISION: 图谱文件采用 { meta, elements: { nodes, edges } } 包装，而非裸元素数组
// REASON: elements 子对象可直接传给 cytoscape({ elements })，meta 携带 domain/生成时间
//         等溯源信息，供增量更新（P4U2）和陈旧检测（P4U3）使用，不污染节点数据。
// DATE: 2026-07-02
//
// DECISION: 全项目统一 TypeScript 技术栈（schema 验证用 ajv，Adapter 解析也用 TS/Node）
// REASON: 查看器已定 React+TS，统一后只维护一套工具链与类型定义；.Build.cs/.h 的
//         解析靠正则与词法扫描即可，无需 Python 生态。
// DATE: 2026-07-02

import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";

const SCHEMA_DIR = dirname(fileURLToPath(import.meta.url));

// ████████████████████████████████████████████████████████████████████████████
//  Ajv 初始化：注册 node / edge / annotation / graph 四个 schema
// ████████████████████████████████████████████████████████████████████████████

function loadSchema(name: string): object {
	return JSON.parse(readFileSync(join(SCHEMA_DIR, name), "utf-8"));
}

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
addFormats.default ? addFormats.default(ajv) : (addFormats as unknown as (a: Ajv) => void)(ajv);

ajv.addSchema(loadSchema("node.schema.json"));
ajv.addSchema(loadSchema("edge.schema.json"));

const validateGraph = ajv.compile(loadSchema("graph.schema.json"));
const validateAnnotation = ajv.compile(loadSchema("annotation.schema.json"));

// ████████████████████████████████████████████████████████████████████████████
//  文件类型判定 + 单文件验证
// ████████████████████████████████████████████████████████████████████████████

type FileKind = "graph" | "annotation";

function detectKind(filePath: string, content: unknown): FileKind {
	const name = basename(filePath);
	if (name.endsWith(".cyto.json")) return "graph";
	if (name.endsWith("_annotations.json")) return "annotation";
	if (Array.isArray(content)) return "annotation";
	if (content && typeof content === "object" && "elements" in content) return "graph";
	throw new Error(`无法判定文件类型（既不像 graph 也不像 annotation）: ${filePath}`);
}

/** 除 schema 结构校验外的图内引用一致性检查：边端点必须指向存在的节点 */
function checkGraphReferences(graph: {
	elements: {
		nodes: { data: { id: string; parent?: string } }[];
		edges: { data: { id: string; source: string; target: string } }[];
	};
}): string[] {
	const errors: string[] = [];
	const nodeIds = new Set(graph.elements.nodes.map((n) => n.data.id));

	const dupCheck = new Set<string>();
	for (const n of graph.elements.nodes) {
		if (dupCheck.has(n.data.id)) errors.push(`重复的节点 id: ${n.data.id}`);
		dupCheck.add(n.data.id);
		if (n.data.parent && !nodeIds.has(n.data.parent)) {
			errors.push(`节点 ${n.data.id} 的 parent 不存在: ${n.data.parent}`);
		}
	}
	for (const e of graph.elements.edges) {
		if (!nodeIds.has(e.data.source)) errors.push(`边 ${e.data.id} 的 source 不存在: ${e.data.source}`);
		if (!nodeIds.has(e.data.target)) errors.push(`边 ${e.data.id} 的 target 不存在: ${e.data.target}`);
	}
	return errors;
}

function validateFile(filePath: string): boolean {
	let content: unknown;
	try {
		// Windows 编辑器/PowerShell 写出的 UTF-8 常带 BOM，JSON.parse 不接受，先剥离
		content = JSON.parse(readFileSync(filePath, "utf-8").replace(/^﻿/, ""));
	} catch (err) {
		console.error(`✗ ${filePath}\n  读取/解析失败: ${(err as Error).message}`);
		return false;
	}

	const kind = detectKind(filePath, content);
	const validator = kind === "graph" ? validateGraph : validateAnnotation;

	const errors: string[] = [];
	if (!validator(content)) {
		for (const e of validator.errors ?? []) {
			errors.push(`${e.instancePath || "(root)"} ${e.message ?? ""}`);
		}
	} else if (kind === "graph") {
		errors.push(...checkGraphReferences(content as Parameters<typeof checkGraphReferences>[0]));
	}

	if (errors.length > 0) {
		console.error(`✗ ${filePath}  [${kind}]`);
		for (const msg of errors) console.error(`    - ${msg}`);
		return false;
	}
	console.log(`✓ ${filePath}  [${kind}]`);
	return true;
}

// ████████████████████████████████████████████████████████████████████████████
//  入口
// ████████████████████████████████████████████████████████████████████████████

const files = process.argv.slice(2);
if (files.length === 0) {
	console.error("用法: npx tsx core/schema/validate.ts <file.json...>");
	process.exit(2);
}

let allOk = true;
for (const f of files) {
	allOk = validateFile(f) && allOk;
}
process.exit(allOk ? 0 : 1);
