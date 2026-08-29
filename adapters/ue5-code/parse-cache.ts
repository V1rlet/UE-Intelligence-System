// Graph Brain / adapters/ue5-code - 解析缓存（P4U2）：per-file 解析结果 + 内容 hash
//
// DECISION: 增量 = "解析级缓存 + 全管线重组装"，而非图上外科手术
// REASON: 图谱强耦合（继承链跨类涟漪、引擎按需解析集取决于全体项目类、度数全局），
//         手术式增量难以保证与全量重建逐字节一致（还有节点顺序问题）；管线中贵的
//         只有解析（引擎索引 + 正则），组装是纯内存操作。缓存命中即跳过解析，
//         组装阶段与全量共用同一代码路径 → "增量产物 ≡ 全量产物"是构造性保证。
// DATE: 2026-07-06
//
// 缓存文件默认 data/cache/ue5_code_{subsystem}.parse-cache.json（.loreignore 忽略：
// 含本机绝对路径的派生数据）。全量提取重写缓存；--incremental 消费并更新它。

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ParsedClass, ParsedDelegateBinding } from "./header-parser.js";

/** 项目侧单个 .h（连带同名 .cpp）的解析结果 */
export interface CachedProjectFile {
	/** .h 内容 sha1 */
	hash: string;
	/** 同名 .cpp 内容 sha1（无 .cpp 为 null） */
	cpp_hash: string | null;
	classes: ParsedClass[];
	/** 类名 → 函数名 → 使用的成员名（保序，对应 parseCppMemberUsage 的 Map/Set） */
	usage: Record<string, Record<string, string[]>>;
	bindings: Record<string, ParsedDelegateBinding[]>;
	is_module_entry: boolean;
}

/** 引擎类解析结果（null = 确认未命中 Runtime，回退种子链；引擎根不变则持续有效） */
export type CachedEngineClass = { header: string; hash: string; cls: ParsedClass } | null;

/** 解析器行为变化时必须 bump；v8 将普通 F/E/I/S/C++ 文件级类型提升为一等 Spec；
 *  v10 命名空间枚举 `namespace EXxx { enum Type }` 以命名空间名为身份，不再产出裸 Type 节点；
 *  v11 枚举值成员解析（UENUM 反射枚举补全值列表，type 承载显式初始值，UMETA 剥离）；
 *  v12 辅助区归属规则——同头文件兄弟声明只挂主类（UCLASS/UINTERFACE 族），值类型与
 *  纯 C++ 提升类型不再携带（消除 F/E 类型 Spec 的"上一层残留"）。 */
export const PARSE_CACHE_VERSION = 13;

export interface ParseCache {
	version: typeof PARSE_CACHE_VERSION;
	domain: "ue5_code";
	subsystem: string;
	/** resolve 后的根目录绝对路径（/ 分隔）；与当前调用不一致则整体作废 */
	roots: string[];
	engine_root: string | null;
	/** key: .h 绝对路径（/ 分隔） */
	project_files: Record<string, CachedProjectFile>;
	/** key: 引擎类名 */
	engine_classes: Record<string, CachedEngineClass>;
}

export function hashContent(content: string): string {
	return createHash("sha1").update(content).digest("hex");
}

export function hashFile(path: string): string | null {
	if (!existsSync(path)) return null;
	return hashContent(readFileSync(path, "utf-8"));
}

export function emptyParseCache(subsystem: string, roots: string[]): ParseCache {
	return {
		version: PARSE_CACHE_VERSION,
		domain: "ue5_code",
		subsystem,
		roots: roots.map((r) => resolve(r).replaceAll("\\", "/")),
		engine_root: null,
		project_files: {},
		engine_classes: {},
	};
}

export function defaultCachePath(subsystem: string): string {
	return `data/cache/ue5_code_${subsystem}.parse-cache.json`;
}

export function loadParseCache(path: string): ParseCache | null {
	if (!existsSync(path)) return null;
	let raw: ParseCache;
	try {
		raw = JSON.parse(readFileSync(path, "utf-8").replace(/^﻿/, "")) as ParseCache;
	} catch {
		// 缓存被截断/损坏：安全降级为全量重建（调用方走无缓存路径并刷新缓存）。
		return null;
	}
	if (raw.version !== PARSE_CACHE_VERSION || raw.domain !== "ue5_code") return null;
	return raw;
}

export function saveParseCache(path: string, cache: ParseCache): void {
	const destination = resolve(path);
	mkdirSync(dirname(destination), { recursive: true });
	const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
	try {
		writeFileSync(temporary, JSON.stringify(cache) + "\n", { encoding: "utf-8", flag: "wx" });
		renameSync(temporary, destination);
	} finally {
		rmSync(temporary, { force: true });
	}
}

/** usage 的 Map/Set ↔ JSON 互转（保插入序，保证组装产物与全量一致） */
export function usageToJson(usage: Map<string, Set<string>>): Record<string, string[]> {
	const out: Record<string, string[]> = {};
	for (const [fn, members] of usage) out[fn] = [...members];
	return out;
}

export function usageFromJson(json: Record<string, string[]>): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>();
	for (const [fn, members] of Object.entries(json)) out.set(fn, new Set(members));
	return out;
}
