// Graph Brain / adapters/ue5-code - 按需引擎类解析服务：/api/engine-class 的实现核心（P3U1）
//
// 输入任意引擎类名 → 复用 EngineResolver 定位并解析 Runtime 头文件，沿基类链递归
// （止于 UObject），产出与 extract-classes 同构的节点/边增量（类节点 + ufunction 节点 +
// inherits/implements/持有边 + 森林 Engine 子树文件叶），由查看器合并进当前图（内存态）。
//
// DECISION: 服务端返回"整条链的完整增量"，去重交给客户端按 id 合并
// REASON: 服务端不知道客户端已有哪些节点；增量按 className 全量缓存后可复用于
//         任意客户端状态，重复请求零解析成本。
// DATE: 2026-07-02

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { resolveGraphBrainProjectRoot } from "../../core/source/project-root.js";
import { EngineResolver, engineRootFromUproject, findUproject } from "./engine-resolver.js";
import { seedChainOf, seedDescriptionOf } from "./engine-seed.js";
import { type AnyEdge, type AnyNode, findModuleName, ForestBuilder } from "./forest.js";
import { guessTypeByName, type ParsedClass } from "./header-parser.js";

export interface ElementsIncrement {
	nodes: AnyNode[];
	edges: AnyEdge[];
	/** 本次链上真实解析出的类名（依请求顺序） */
	resolved: string[];
	/** 是否命中缓存（未重新解析） */
	cached: boolean;
}

export interface ServiceError {
	error: string;
}

// v5：header-parser v10 命名空间枚举身份修正（裸 Type → EXxx），旧缓存含无效 Type 声明需作废
// v6：header-parser v11 枚举值成员解析，旧缓存的 uenum 无值列表需作废
// v7：header-parser v12 辅助区归属规则，旧缓存的值类型带兄弟声明残留需作废
const ENGINE_CLASS_CACHE_VERSION = 7;
const ROOT = resolveGraphBrainProjectRoot(import.meta.url, "..", "..");
export const DEFAULT_ENGINE_CLASS_CACHE = join(ROOT, "data", "api-catalog", "parsed-classes");

interface SourceStamp {
	path: string;
	size: number;
	mtime_ms: number;
}

interface EngineClassDiskRecord {
	cache_version: number;
	engine_root: string;
	class_name: string;
	requested_source?: string;
	generated_at: string;
	sources: SourceStamp[];
	increment: ElementsIncrement;
}

function normalizedSource(sourcePath?: string): string {
	return sourcePath?.replaceAll("\\", "/") ?? "";
}

export function engineClassCachePath(
	engineRoot: string,
	className: string,
	sourcePath?: string,
	cacheDir = DEFAULT_ENGINE_CLASS_CACHE,
): string {
	const rootKey = createHash("sha256").update(resolve(engineRoot).toLowerCase()).digest("hex").slice(0, 12);
	const sourceKey = sourcePath
		? `-${createHash("sha256").update(normalizedSource(sourcePath).toLowerCase()).digest("hex").slice(0, 8)}`
		: "";
	const safeClass = className.replace(/[^A-Za-z0-9_.-]/g, "_");
	return join(cacheDir, rootKey, `${safeClass}${sourceKey}.json`);
}

function readSourceStamp(path: string): SourceStamp | null {
	try {
		const stat = statSync(path);
		if (!stat.isFile()) return null;
		return { path: resolve(path), size: stat.size, mtime_ms: Math.trunc(stat.mtimeMs) };
	} catch {
		return null;
	}
}

/** Read a previously parsed class graph only when its exact local headers are unchanged. */
export function loadEngineClassDiskCache(
	engineRoot: string,
	className: string,
	sourcePath?: string,
	cacheDir = DEFAULT_ENGINE_CLASS_CACHE,
): ElementsIncrement | null {
	try {
		const record = JSON.parse(readFileSync(engineClassCachePath(engineRoot, className, sourcePath, cacheDir), "utf8")) as EngineClassDiskRecord;
		const normalizedRoot = resolve(engineRoot);
		if (
			record.cache_version !== ENGINE_CLASS_CACHE_VERSION
			|| resolve(record.engine_root) !== normalizedRoot
			|| record.class_name !== className
			|| normalizedSource(record.requested_source) !== normalizedSource(sourcePath)
			|| !Array.isArray(record.sources)
			|| record.sources.length === 0
			|| !record.increment
		) return null;
		for (const expected of record.sources) {
			const source = resolve(expected.path);
			const rel = relative(normalizedRoot, source);
			if (rel.startsWith("..") || isAbsolute(rel)) return null;
			const current = readSourceStamp(source);
			if (!current || current.size !== expected.size || current.mtime_ms !== expected.mtime_ms) return null;
		}
		return { ...record.increment, cached: true };
	} catch {
		return null;
	}
}

export function storeEngineClassDiskCache(
	engineRoot: string,
	className: string,
	sourcePath: string | undefined,
	sourceFiles: string[],
	increment: ElementsIncrement,
	cacheDir = DEFAULT_ENGINE_CLASS_CACHE,
): void {
	const sources = [...new Set(sourceFiles.map((path) => resolve(path)))]
		.map(readSourceStamp)
		.filter((stamp): stamp is SourceStamp => stamp !== null);
	if (sources.length === 0) return;
	const path = engineClassCachePath(engineRoot, className, sourcePath, cacheDir);
	const record: EngineClassDiskRecord = {
		cache_version: ENGINE_CLASS_CACHE_VERSION,
		engine_root: resolve(engineRoot),
		class_name: className,
		...(sourcePath ? { requested_source: normalizedSource(sourcePath) } : {}),
		generated_at: new Date().toISOString(),
		sources,
		increment: { ...increment, cached: false },
	};
	mkdirSync(dirname(path), { recursive: true });
	// tmp+rename 原子写：不跟随 symlink，拒绝可预测路径的符号链接写穿。
	const destination = resolve(path);
	const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
	try {
		writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
		renameSync(temporary, destination);
	} finally {
		rmSync(temporary, { force: true });
	}
}

// —— 引擎根定位：显式参数 > 项目 source_root 推导 > 环境变量 > 本机 UE_5.8 默认 ——
export function resolveEngineRoot(sourceRoot?: string): string | null {
	if (sourceRoot) {
		const uproject = findUproject(sourceRoot);
		const fromProject = uproject ? engineRootFromUproject(uproject) : null;
		if (fromProject) return fromProject;
	}
	const envRoot = process.env.GRAPH_BRAIN_ENGINE_ROOT;
	if (envRoot && existsSync(join(envRoot, "Engine", "Source", "Runtime"))) return envRoot;
	const fallback = "G:/Epic Games/UE_5.8";
	return existsSync(join(fallback, "Engine", "Source", "Runtime")) ? fallback : null;
}

// 每引擎根一个 Resolver（头文件索引只建一次）；增量按类名缓存
const resolvers = new Map<string, EngineResolver>();
const incrementCache = new Map<string, ElementsIncrement>();

function resolverFor(engineRoot: string): EngineResolver {
	let r = resolvers.get(engineRoot);
	if (!r) {
		r = new EngineResolver(engineRoot);
		resolvers.set(engineRoot, r);
	}
	return r;
}

/** 解析引擎类及其基类链 → 图元素增量；未命中 Runtime 返回 ServiceError */
export function resolveEngineClassElements(
	className: string,
	engineRoot: string,
	sourcePath?: string,
): ElementsIncrement | ServiceError {
	const cacheKey = `${resolve(engineRoot)}::${className}::${normalizedSource(sourcePath)}`;
	const hit = incrementCache.get(cacheKey);
	if (hit) return { ...hit, cached: true };
	const diskHit = loadEngineClassDiskCache(engineRoot, className, sourcePath);
	if (diskHit) {
		incrementCache.set(cacheKey, diskHit);
		return diskHit;
	}

	const resolver = resolverFor(engineRoot);
	if (!resolver.resolveClass(className, sourcePath)) {
		return {
			error:
				`未在 UE 5.8 Runtime / Developer / Editor / Plugins 公开头文件中命中「${className}」。` +
				`请检查类名拼写，或确认对应插件已随当前引擎安装。`,
		};
	}

	// —— 沿基类链解析（止于 UObject；中途未命中的基类回退种子链 stub） ——
	const parsed = new Map<string, { cls: ParsedClass; headerPath: string }>();
	const order: string[] = [];
	let cursor: string | null = className;
	while (cursor && cursor !== "UObject" && !parsed.has(cursor)) {
		const res = resolver.resolveClass(cursor, cursor === className ? sourcePath : undefined);
		if (!res) break; // 未命中：留给 stub 兜底
		parsed.set(cursor, res);
		order.push(cursor);
		cursor = res.cls.bases[0] ?? null;
	}

	const nodes = new Map<string, AnyNode>();
	const edges = new Map<string, AnyEdge>();

	const ensureStubNode = (name: string) => {
		if (nodes.has(name) || parsed.has(name)) return;
		const seedChain = seedChainOf(name);
		const seedDesc = seedDescriptionOf(name);
		nodes.set(name, {
			data: {
				id: name, label: name, type: guessTypeByName(name), layer: "engine",
				domain: "ue5_code", visibility: "silhouette",
				...(seedDesc ? { description: seedDesc } : {}),
				...(seedChain ? { inheritance_chain: seedChain } : {}),
				metrics: { in_degree: 0, out_degree: 0 },
			},
		});
	};

	const addEdge = (source: string, target: string, relation: string, description?: string) => {
		ensureStubNode(target);
		const id = `${source}--${relation}-->${target}`;
		if (edges.has(id)) return;
		edges.set(id, {
			data: { id, source, target, relation, domain: "ue5_code", ...(description ? { description } : {}) },
		});
	};

	// 继承链：name 及其已解析祖先倒序（基类在前）+ 顶端接 UObject 或种子链
	const chainFor = (name: string): string[] => {
		const idx = order.indexOf(name);
		const chain = order.slice(idx).reverse();
		const top = parsed.get(chain[0])!.cls.bases[0];
		if (!top) return chain;
		if (top === "UObject") return ["UObject", ...chain];
		const seed = seedChainOf(top);
		return seed ? [...seed, ...chain] : [top, ...chain];
	};

	const forest = new ForestBuilder("Engine");
	const fileClasses = new Map<string, string[]>();

	for (const name of order) {
		const { cls, headerPath } = parsed.get(name)!;
		const module = findModuleName(headerPath, resolver.engineSourceRoot);
		const rel = relative(join(engineRoot, "Engine"), headerPath).replaceAll("\\", "/");

		nodes.set(name, {
			data: {
				id: name, label: name, type: cls.kind, layer: "engine",
				module, domain: "ue5_code",
				...(cls.description ? { description: cls.description } : {}),
				// API 跳转需要以 Engine 目录为根的精确路径，供同头文件 F/E/I/S 辅助类型复用。
				source_path: rel,
				...(cls.tags.length ? { tags: cls.tags } : {}),
				...(cls.declarationKind ? { cpp_kind: cls.declarationKind } : {}),
				...(cls.delegates.length ? { delegates: cls.delegates } : {}),
				...(cls.properties.some((property) => !property.targetClass)
					? { data_members: cls.properties.filter((property) => !property.targetClass).map(({ name, type }) => ({ name, type })) }
					: {}),
				...(cls.cppDeclarations.length ? { cpp_declarations: cls.cppDeclarations } : {}),
				inheritance_chain: chainFor(name),
				visibility: "silhouette",
				metrics: { in_degree: 0, out_degree: 0 },
			},
		});

		for (const base of cls.bases) addEdge(name, base, "inherits");
		for (const iface of cls.interfaces) addEdge(name, iface, "implements");

		const holdBuckets = new Map<string, { relation: string; members: string[] }>();
		for (const p of cls.properties) {
			if (!p.targetClass) continue;
			const key = `${p.relation}:${p.targetClass}`;
			const bucket = holdBuckets.get(key) ?? { relation: p.relation, members: [] };
			bucket.members.push(p.name);
			holdBuckets.set(key, bucket);
		}
		for (const [key, bucket] of holdBuckets) {
			addEdge(name, key.split(":")[1], bucket.relation, bucket.members.join(", "));
		}

		for (const fn of cls.functions) {
			const fnId = `${name}::${fn.name}`;
			if (nodes.has(fnId)) continue;
			const tags: string[] = [];
			if (fn.isOverride) tags.push("override");
			if (fn.category) tags.push(`#${fn.category.split("|")[0].toLowerCase().replace(/\s+/g, "_")}`);
			nodes.set(fnId, {
				data: {
					id: fnId, label: fn.name, type: "ufunction", layer: "engine",
					module, domain: "ue5_code", parent: name,
					...(fn.description ? { description: fn.description } : {}),
					source_path: cls.sourcePath,
					...(tags.length ? { tags } : {}),
					visibility: "silhouette",
					api: {
						signature: fn.signature,
						return_type: fn.returnType,
						params: fn.params.map((p) => ({ name: p.name, type: p.type })),
						cpp_only: !fn.hasUFunction,
						blueprint_exposable: fn.blueprintExposable,
					},
					metrics: { in_degree: 0, out_degree: 0 },
				},
			});
		}

		const list = fileClasses.get(rel) ?? [];
		list.push(name);
		fileClasses.set(rel, list);
	}

	for (const [rel, classNames] of fileClasses) {
		forest.addFile(rel, { classes: classNames });
	}
	for (const n of forest.nodes) if (!nodes.has(n.data.id)) nodes.set(n.data.id, n);
	for (const e of forest.edges) if (!edges.has(e.data.id)) edges.set(e.data.id, e);

	// 增量内部度数（合并后仅影响节点默认尺寸，不追求全图精确）
	for (const e of edges.values()) {
		const s = nodes.get(e.data.source);
		const t = nodes.get(e.data.target);
		if (s) s.data.metrics.out_degree++;
		if (t) t.data.metrics.in_degree++;
	}

	const increment: ElementsIncrement = {
		nodes: [...nodes.values()],
		edges: [...edges.values()],
		resolved: order,
		cached: false,
	};
	incrementCache.set(cacheKey, increment);
	storeEngineClassDiskCache(
		engineRoot,
		className,
		sourcePath,
		[...parsed.values()].map((entry) => entry.headerPath),
		increment,
	);
	return increment;
}
