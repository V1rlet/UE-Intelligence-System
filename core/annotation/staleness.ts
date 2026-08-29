// Graph Brain / core/annotation - 标注陈旧检测（P4U3）：节点源文件 hash 采集与比对
//
// 机制：标注创建/更新/复核时记录节点源文件的 sha1（source_hash）；扫描时重算比对，
// 不匹配（或源文件已消失）置 stale=true，匹配则清除 stale（幂等，可反复跑）。
// 无 source_hash 的存量标注跳过——通过面板"已复核"补挂 hash 后纳入检测。
//
// D-P3 行级锚（v2）：标注可携带 anchor {start_line, end_line, fingerprint}。
// 失效半径 = 该行区间：节点级 hash 失配时，若锚区间的原始字节指纹未变，
// 该条标注不置 stale（改文件其他行不再触发整节点失效提示）。
//
// 节点 → 源文件解析顺序（取第一个存在的候选）：
//   1. 各 source_root（meta，";" 分隔）+ node.source_path —— 项目层文件
//   2. 解析缓存的 engine_root + Engine/Source + node.source_path —— 引擎层文件
//      （直读 data/cache/ 的 JSON，不 import adapter 代码，保持 core 领域无关；
//        字段契约见 adapters/ue5-code/parse-cache.ts 的 ParseCache）
//   3. 节点无 source_path 时无法建立代码证据，返回 null。

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { graphSourceRoots } from "../schema/graph-version.js";
import { resolveGraphBrainProjectRoot } from "../source/project-root.js";
import { loadReadingContext, ReadingContextConflictError, type ReadingAnnotation } from "../reading-context/store.js";
import { resolveCurrentGraphArtifact } from "../store/data-publication.js";
import { FileLockBusyError } from "../store/file-lock.js";
import { sleepSync } from "../store/durable-write.js";
import { type AnnotationDocument, type AnnotationEntry, loadAnnotationDocument, saveAnnotations } from "./store.js";

const ROOT = resolveGraphBrainProjectRoot(import.meta.url, "..", "..");
const GRAPHS_DIR = join(ROOT, "data", "graphs");
const CACHE_DIR = join(ROOT, "data", "cache");
const PUBLICATIONS_DIR = join(ROOT, "data", "publications");

interface GraphNodeLite {
	data: { id: string; source_path?: string; [key: string]: unknown };
}

interface GraphLite {
	meta: Record<string, unknown>;
	elements: { nodes: GraphNodeLite[] };
}

function sha1(content: string | Buffer): string {
	return createHash("sha1").update(content).digest("hex");
}

/** Exact published generation, with one legacy-catalog fallback for old repositories. */
export function latestGraphFile(domain: string, subsystem: string): string | null {
	if (domain !== "ue5_code") return null;
	return resolveCurrentGraphArtifact({ graphs: GRAPHS_DIR, publications: PUBLICATIONS_DIR }, subsystem)?.file ?? null;
}

function loadGraph(domain: string, subsystem: string): GraphLite | null {
	const file = latestGraphFile(domain, subsystem);
	if (!file) return null;
	return JSON.parse(readFileSync(join(GRAPHS_DIR, file), "utf8").replace(/^﻿/, "")) as GraphLite;
}

/** 节点索引按图实例缓存：扫描按标注逐节点查找，线性扫描是 O(标注×节点)。 */
const nodeIndexCache = new WeakMap<GraphLite, Map<string, GraphNodeLite>>();

function nodeIndex(graph: GraphLite): Map<string, GraphNodeLite> {
	let index = nodeIndexCache.get(graph);
	if (!index) {
		index = new Map(graph.elements.nodes.map((node) => [node.data.id, node]));
		nodeIndexCache.set(graph, index);
	}
	return index;
}

/** 引擎根备忘录：按来源缓存文件的 mtime 失效；避免每个标注节点重复 readdir +
 *  解析数 MB 的 parse-cache JSON。 */
const engineRootMemo = new Map<string, { cacheFile: string; mtimeMs: number; root: string | null }>();

function engineSourceRootFromCache(subsystem: string): string | null {
	// 解析缓存目录缺失（全新 checkout）时不做引擎 hash 判定，扫描不应崩溃。
	if (!existsSync(CACHE_DIR)) return null;
	// 引擎根是全局事实（不随 subsystem 变）：先查本子系统缓存，缺失时
	// fallback 到任意 ue5_code_*.parse-cache.json（reference 图无专属缓存，
	// 其 engine_root 由 project 图缓存携带——R1 修复：reference 标注此前永远无法检测）。
	const memo = engineRootMemo.get(subsystem);
	if (memo) {
		try {
			if (statSync(memo.cacheFile).mtimeMs === memo.mtimeMs) return memo.root;
		} catch {
			/* 来源缓存文件已消失：重新扫描 */
		}
		engineRootMemo.delete(subsystem);
	}
	const candidates = [`ue5_code_${subsystem}.parse-cache.json`, ...readdirSync(CACHE_DIR).filter((f) => /^ue5_code_.*\.parse-cache\.json$/.test(f) && f !== `ue5_code_${subsystem}.parse-cache.json`)];
	for (const name of candidates) {
		const cachePath = join(CACHE_DIR, name);
		if (!existsSync(cachePath)) continue;
		try {
			const cache = JSON.parse(readFileSync(cachePath, "utf8")) as { engine_root?: string | null };
			if (cache.engine_root) {
				engineRootMemo.set(subsystem, { cacheFile: cachePath, mtimeMs: statSync(cachePath).mtimeMs, root: cache.engine_root });
				return cache.engine_root;
			}
		} catch {
			continue;
		}
	}
	return null;
}

export interface ResolvedSourceFile {
	path: string;
	bytes: Buffer;
}

/** 解析 ue5_code 节点当前源文件（路径 + 原始字节）；定位不到返回 null。 */
export function resolveNodeSourceFile(
	domain: string,
	subsystem: string,
	nodeId: string,
	graph?: GraphLite | null,
): ResolvedSourceFile | null {
	if (domain !== "ue5_code") return null;
	const g = graph !== undefined ? graph : loadGraph(domain, subsystem);
	if (!g) return null;
	const roots = graphSourceRoots(g.meta);
	const node = nodeIndex(g).get(nodeId);
	const candidates: string[] = [];
	if (node?.data.source_path) {
		for (const root of roots) candidates.push(resolve(root, node.data.source_path));
		const engineRoot = engineSourceRootFromCache(subsystem);
		if (engineRoot) {
			// 引擎类 source_path 自带 Engine/Source 前缀（reference 图），项目类不带。
			// 引擎根是裸根（G:/Epic Games/UE_5.8），按前缀决定拼接层级。
			const sourcePath = node.data.source_path;
			if (sourcePath.startsWith("Engine/")) candidates.push(resolve(engineRoot, sourcePath));
			else candidates.push(resolve(join(engineRoot, "Engine", "Source"), sourcePath));
		}
	}

	for (const c of candidates) {
		// 原始字节：按解码文本处理时，非 UTF-8（如 ANSI/GBK）字节序列会坍缩成
		// 相同的 U+FFFD 串，真实的源文件变化被漏检。
		if (existsSync(c)) return { path: c, bytes: readFileSync(c) };
	}
	return null;
}

export function resolveNodeSourceHash(
	domain: string,
	subsystem: string,
	nodeId: string,
	graph?: GraphLite | null,
): string | null {
	const file = resolveNodeSourceFile(domain, subsystem, nodeId, graph);
	return file ? sha1(file.bytes) : null;
}

/** 服务端为标注写入计算行级锚指纹（客户端不自报）。定位不到源文件或区间超界 → null。 */
export function resolveAnchorFingerprint(
	domain: string,
	subsystem: string,
	nodeId: string,
	startLine: number,
	endLine: number,
): string | null {
	const file = resolveNodeSourceFile(domain, subsystem, nodeId);
	if (!file) return null;
	return annotationRangeFingerprint(file.bytes, startLine, endLine);
}

/**
 * D-P3 行级锚指纹：源文件第 startLine..endLine 行（含两端，1-based）原始字节的 sha256。
 * 行边界按 \n 定位（\r 留在行内容内，Windows 文件同样确定）。区间超出文件 → null
 * （锚已不存在 = 失效）。
 */
export function annotationRangeFingerprint(bytes: Buffer, startLine: number, endLine: number): string | null {
	if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine) return null;
	const lineStart = (line: number): number | null => {
		if (line === 1) return 0;
		let current = 1;
		for (let i = 0; i < bytes.length; i++) {
			if (bytes[i] === 0x0a) {
				current++;
				if (current === line) return i + 1;
			}
		}
		return null;
	};
	const startOffset = lineStart(startLine);
	if (startOffset === null || startOffset > bytes.length) return null;
	const nextStart = lineStart(endLine + 1);
	if (nextStart === null) {
		// endLine 是最后一行或超界：超界即锚失效
		let totalLines = 1;
		for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0a) totalLines++;
		if (endLine > totalLines) return null;
		return createHash("sha256").update(bytes.subarray(startOffset)).digest("hex");
	}
	return createHash("sha256").update(bytes.subarray(startOffset, nextStart)).digest("hex");
}

/** 锚的失效半径判定：源文件缺失 → 失效；区间指纹一致 → 未失效。 */
function anchoredRegionIntact(file: ResolvedSourceFile | null, anchor: ReadingAnnotation["anchor"] & {}): boolean {
	if (!file) return false;
	return annotationRangeFingerprint(file.bytes, anchor.start_line, anchor.end_line) === anchor.fingerprint;
}

export interface ScanResult {
	domain: string;
	subsystem: string;
	/** 有 source_hash、参与比对的标注数 */
	checked: number;
	/** 本次扫描后处于 stale 的标注数 */
	stale: number;
	/** 无 source_hash 跳过的存量标注数 */
	skipped: number;
	/** 本次扫描是否改动并写回了 reading-context */
	changed: boolean;
}

interface NodeSourceSnapshot {
	hash: string | null;
	file: ResolvedSourceFile | null;
}

/** 基于一份文档快照计算 stale 标记（纯函数，不写回）。 */
function computeStale(document: AnnotationDocument, subsystem: string, graph: GraphLite | null): { result: ScanResult; entries: AnnotationEntry[] } {
	const entries: AnnotationEntry[] = document.entries;
	const result: ScanResult = { domain: entries[0]?.domain ?? "ue5_code", subsystem, checked: 0, stale: 0, skipped: 0, changed: false };
	const sourceByNode = new Map<string, NodeSourceSnapshot>();

	for (const entry of entries) {
		let snapshot = sourceByNode.get(entry.node_id);
		if (!snapshot) {
			const file = resolveNodeSourceFile(entry.domain, subsystem, entry.node_id, graph);
			snapshot = { hash: file ? sha1(file.bytes) : null, file };
			sourceByNode.set(entry.node_id, snapshot);
		}
		for (const ann of entry.annotations) {
			if (!ann.source_hash) {
				result.skipped++;
				continue;
			}
			result.checked++;
			// D-P3 半径语义：hash 一致 = 新鲜；失配时若有锚且锚区间字节未变，仍算新鲜；
			// 其余情况（无锚 / 锚区间变了 / 源文件消失）= stale。
			const isStale = (() => {
				if (snapshot.hash === null) return true;
				if (snapshot.hash === ann.source_hash) return false;
				if (!ann.anchor) return true;
				return !anchoredRegionIntact(snapshot.file, ann.anchor);
			})();
			if (isStale) result.stale++;
			if ((ann.stale ?? false) !== isStale) {
				if (isStale) ann.stale = true;
				else delete ann.stale;
				result.changed = true;
			}
		}
	}
	return { result, entries };
}

/**
 * 扫描一个标注子系统：比对 source_hash 与当前源文件，写回 stale 标记。
 * 与用户正在写入 reading-context 冲突（revision 变化）时最多重试 3 次；写锁被
 * 短暂占用（FileLockBusyError）时最多退避重试 6 次；每次重试都重新读取最新文档
 * 并重新计算，绝不复用旧 draft 或覆盖并发写入的新标注。
 */
export function scanStale(domain: string, subsystem: string): ScanResult {
	const graph = loadGraph(domain, subsystem);
	let document = loadAnnotationDocument(domain, subsystem);
	for (let attempt = 0; ; attempt += 1) {
		const { result, entries } = computeStale(document, subsystem, graph);
		if (!result.changed) return result;
		try {
			saveAnnotations(domain, subsystem, entries, document.revision);
			return result;
		} catch (error) {
			// 浏览器正在写 reading-context 时锁会被短暂持有：等几毫秒重读重算，
			// 而不是让整次 post-commit 更新在 annotations 阶段失败重跑全量提取。
			if (error instanceof FileLockBusyError && attempt < 5) {
				sleepSync(50 * (attempt + 1));
				document = loadAnnotationDocument(domain, subsystem);
				continue;
			}
			if (!(error instanceof ReadingContextConflictError) || attempt >= 2) throw error;
			// 冲突：并发写入了新标注。重新读取最新文档后重新计算 stale 再写。
			document = loadAnnotationDocument(domain, subsystem);
		}
	}
}

/** 扫描 canonical reading-context 中所有拥有标注的 subsystem。 */
export function scanAllStale(): ScanResult[] {
	const document = loadReadingContext("ue5_code");
	const subsystems = [...new Set(document.annotations.map((entry) => entry.subsystem))].sort();
	return subsystems.map((subsystem) => scanStale(document.domain, subsystem));
}
