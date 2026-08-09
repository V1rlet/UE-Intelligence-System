// Graph Brain / adapters/ue5-code - 项目图提取管线（库）：文件森林 + 类/函数/委托 + 引擎侧真实解析
//
// P4U1 自 extract-classes.ts 原样抽出（逻辑/日志/产物零变化），供 adapter.extract 与
// CLI（extract-classes.ts）共用。
//
// 管线：
//   1. 项目 Source：解析全部 .h（类/函数/UPROPERTY/委托）+ 同名 .cpp（函数→成员使用，
//      含构造函数装配）+ 文件森林（文件夹路径节点 + .h/.cpp 文件对叶节点）
//   2. 引擎侧：从 .uproject 定位引擎根，沿"项目类的基类链 + 持有目标"按需解析
//      Engine/Source/Runtime 的 .h（止于 UObject；插件/依赖搁置，未命中回退种子链），
//      引擎文件挂入森林 Engine 子树
//   3. 生命周期链叠加 + inheritance_chain 附着（Spec 页追溯跳转的数据源）

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import {
	SOURCE_PROVENANCE_SCHEMA_VERSION,
	type ExtractionCoverage,
	type SourceProvenance,
} from "../../core/schema/graph-version.js";
import { buildSourceSnapshot } from "../../core/source/source-evidence.js";
import type { GraphFile } from "../adapter-interface.js";
import { buildLifecycleElements, isLifecycleStep, lifecycleStepId } from "./actor-lifecycle.js";
import { UE5_CODE_GRAPH_FORMAT } from "./meta.js";
import { EngineResolver, engineRootFromUproject, findUproject } from "./engine-resolver.js";
import { seedChainOf, seedDescriptionOf } from "./engine-seed.js";
import { type AnyEdge, type AnyNode, findModuleName, ForestBuilder } from "./forest.js";
import { guessTypeByName, parseCppDelegateBindings, parseCppMemberUsage, parseHeader, type ParsedClass, type ParsedDelegateBinding } from "./header-parser.js";
import {
	emptyParseCache,
	hashContent,
	hashFile,
	type ParseCache,
	usageFromJson,
	usageToJson,
} from "./parse-cache.js";

interface ClassEntry extends ParsedClass {
	module: string;
	layer: "project" | "engine";
}

export interface ExtractClassesOptions {
	/** 图谱子系统名（进入产物文件名），默认 "project" */
	subsystem?: string;
	/** 显式 .uproject 路径（缺省沿第一个根目录向上找） */
	uproject?: string | null;
	/** 是否做引擎侧按需解析，默认 true */
	withEngine?: boolean;
	/** 显式引擎根目录（跳过 .uproject 推导；adapter.diff 从缓存的 engine_root 还原） */
	engineRoot?: string | null;
}

export interface ExtractWithCacheResult {
	graph: GraphFile;
	/** 本次运行的全新缓存（调用方负责落盘） */
	cache: ParseCache;
	stats: { projectCached: number; projectParsed: number; engineCached: number; engineParsed: number };
}

// ████████████████████████████████████████████████████████████████████████████
//  目录辅助
// ████████████████████████████████████████████████████████████████████████████

function findHeaders(root: string): string[] {
	const results: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const p = join(root, entry.name);
		if (entry.isDirectory()) results.push(...findHeaders(p));
		else if (entry.name.endsWith(".h") && !entry.name.endsWith(".generated.h")) results.push(p);
	}
	return results;
}

/** 递归收集 *.Build.cs（模块构建规则，作为第三种文件叶入森林） */
function findBuildRules(root: string): string[] {
	const results: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const p = join(root, entry.name);
		if (entry.isDirectory()) results.push(...findBuildRules(p));
		else if (entry.name.endsWith(".Build.cs")) results.push(p);
	}
	return results;
}

// ████████████████████████████████████████████████████████████████████████████
//  继承链与图谱构建
// ████████████████████████████████████████████████████████████████████████████

/** 沿 bases 向上拼继承链（byName 覆盖项目类 + 已解析引擎类），未命中接种子链；止于 UObject */
function chainFor(className: string, byName: Map<string, ClassEntry>): string[] {
	const chain: string[] = [className];
	let cur = byName.get(className);
	let guard = 0;
	while (cur && guard++ < 64) {
		const base = cur.bases[0];
		if (!base) break;
		if (base === "UObject") {
			chain.unshift("UObject");
			break;
		}
		const next = byName.get(base);
		if (next) {
			chain.unshift(base);
			cur = next;
			continue;
		}
		const seed = seedChainOf(base);
		if (seed) return [...seed, ...chain];
		chain.unshift(base);
		break;
	}
	return chain;
}

function buildGraph(
	classes: ClassEntry[],
	subsystem: string,
	usageByClass: Map<string, Map<string, Set<string>>>,
	bindingsByClass: Map<string, ParsedDelegateBinding[]>,
	evidence: { provenance: SourceProvenance; coverage: ExtractionCoverage },
) {
	const nodes = new Map<string, AnyNode>();
	const edges = new Map<string, AnyEdge>();
	const knownNames = new Set(classes.map((c) => c.name));
	const byName = new Map(classes.map((c) => [c.name, c]));
	const interfaceFunctions = new Map(
		classes
			.filter((entry) => entry.kind === "uinterface")
			.map((entry) => [entry.name, new Set(entry.functions.map((fn) => fn.name))]),
	);

	// Actor 生命周期链叠加层
	const lifecycle = buildLifecycleElements();
	for (const n of lifecycle.nodes) nodes.set(n.data.id, n as AnyNode);
	for (const e of lifecycle.edges) edges.set(e.data.id, e as AnyEdge);

	const ensureStubNode = (name: string) => {
		if (nodes.has(name)) return;
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

	const addEdge = (source: string, target: string, relation: string, weight?: number, description?: string) => {
		if (!knownNames.has(target) && !nodes.has(target)) ensureStubNode(target);
		const id = `${source}--${relation}-->${target}`;
		const prev = edges.get(id);
		if (prev) {
			if (description) prev.data.description = prev.data.description ? `${prev.data.description}, ${description}` : description;
			return;
		}
		edges.set(id, { data: { id, source, target, relation, domain: "ue5_code", ...(weight ? { weight } : {}), ...(description ? { description } : {}) } });
	};

	for (const cls of classes) {
		const ctorAssembles = [...(usageByClass.get(cls.name)?.get(cls.name) ?? [])];
		const delegateSubscriptions = (bindingsByClass.get(cls.name) ?? []).map((binding) => {
			const owner = byName.get(binding.ownerClass);
			const delegateType = owner?.delegates.find((delegate) => delegate.member === binding.delegateMember)?.type;
			return { ...binding, ...(delegateType ? { delegateType } : {}) };
		});
		nodes.set(cls.name, {
			data: {
				id: cls.name, label: cls.name, type: cls.kind, layer: cls.layer,
				module: cls.module, domain: "ue5_code",
				...(cls.description ? { description: cls.description } : {}),
				source_path: cls.sourcePath,
				...(cls.tags.length ? { tags: cls.tags } : {}),
				...(cls.declarationKind ? { cpp_kind: cls.declarationKind } : {}),
				...(cls.delegates.length ? { delegates: cls.delegates } : {}),
				// data_members 是声明事实的唯一消费形状；对象成员也保留在这里，
				// composes/aggregates/depends_on 边只是从同一属性派生的关系视图。
				...(cls.properties.length
					? { data_members: cls.properties.map(({ name, type }) => ({ name, ...(type ? { type } : {}) })) }
					: {}),
				...(cls.cppDeclarations.length ? { cpp_declarations: cls.cppDeclarations } : {}),
				...(delegateSubscriptions.length ? { delegate_subscriptions: delegateSubscriptions } : {}),
				...(ctorAssembles.length ? { ctor_assembles: ctorAssembles } : {}),
				inheritance_chain: chainFor(cls.name, byName),
				visibility: cls.layer === "project" ? "explored" : "silhouette",
				metrics: { in_degree: 0, out_degree: 0 },
			},
		});
	}

	for (const cls of classes) {
		for (const base of cls.bases) addEdge(cls.name, base, "inherits");
		for (const iface of cls.interfaces) addEdge(cls.name, iface, "implements");

		const holdBuckets = new Map<string, { relation: string; members: string[] }>();
		for (const p of cls.properties) {
			if (!p.targetClass) continue;
			const key = `${p.relation}:${p.targetClass}`;
			const bucket = holdBuckets.get(key) ?? { relation: p.relation, members: [] };
			bucket.members.push(p.name);
			holdBuckets.set(key, bucket);
		}
		for (const [key, bucket] of holdBuckets) {
			addEdge(cls.name, key.split(":")[1], bucket.relation, undefined, bucket.members.join(", "));
		}

		const clsUsage = usageByClass.get(cls.name);
		const responseHandlers = new Set((bindingsByClass.get(cls.name) ?? []).flatMap((binding) => binding.handler ? [binding.handler] : []));
		const implementedInterfaceMethods = new Map<string, string>();
		for (const iface of cls.interfaces) {
			for (const method of interfaceFunctions.get(iface) ?? []) implementedInterfaceMethods.set(method, iface);
		}
		const propByName = new Map(cls.properties.map((p) => [p.name, p]));
		for (const fn of cls.functions) {
			const fnId = `${cls.name}::${fn.name}`;
			if (nodes.has(fnId)) continue;
			if (fn.isOverride && isLifecycleStep(fn.name)) {
				addEdge(fnId, lifecycleStepId(fn.name), "overrides");
			}
			for (const memberName of clsUsage?.get(fn.name) ?? []) {
				const target = propByName.get(memberName)?.targetClass;
				if (target) addEdge(fnId, target, "uses_member", undefined, memberName);
			}
			const tags: string[] = [];
			if (fn.isOverride) tags.push("override");
			const iface = implementedInterfaceMethods.get(fn.name);
			if (iface) tags.push(`interface:${iface}`);
			if (responseHandlers.has(fn.name)) tags.push("delegate_response");
			if (fn.category) tags.push(`#${fn.category.split("|")[0].toLowerCase().replace(/\s+/g, "_")}`);
			nodes.set(fnId, {
				data: {
					id: fnId, label: fn.name, type: "ufunction", layer: cls.layer,
					module: cls.module, domain: "ue5_code", parent: cls.name,
					...(fn.description ? { description: fn.description } : {}),
					source_path: cls.sourcePath,
					...(tags.length ? { tags } : {}),
					visibility: cls.layer === "project" ? "explored" : "silhouette",
					api: {
						signature: fn.signature,
						return_type: fn.returnType,
						params: fn.params.map((p) => ({ name: p.name, type: p.type })),
						cpp_only: !fn.hasUFunction,
						blueprint_exposable: fn.blueprintExposable,
						is_static: fn.isStatic,
					},
					metrics: { in_degree: 0, out_degree: 0 },
				},
			});
		}
	}

	for (const e of edges.values()) {
		const s = nodes.get(e.data.source);
		const t = nodes.get(e.data.target);
		if (s) s.data.metrics.out_degree++;
		if (t) t.data.metrics.in_degree++;
	}

	return {
		meta: {
			domain: "ue5_code",
			subsystem,
			format_version: UE5_CODE_GRAPH_FORMAT,
			generated_at: new Date().toISOString(),
			generator: "ue5-code-adapter/extract-classes@0.3.0",
			...evidence,
		},
		elements: { nodes: [...nodes.values()], edges: [...edges.values()] },
	};
}

// ████████████████████████████████████████████████████████████████████████████
//  提取管线入口（原 extract-classes.ts 顶层脚本体）
// ████████████████████████████████████████████████████████████████████████████

// DECISION: 模块入口文件（.cpp 含 IMPLEMENT_[PRIMARY_GAME_]MODULE）与 Build.cs 都以
//           file_kind 字段区分的普通 file 叶入森林，不新增 node type：
//           - file_kind="module_entry"：模块图 module 节点的源码锚点，entry_of=模块名
//           - file_kind="build_rules"：模块依赖定义（extract-modules 解析的正是它），
//             不是 C++ 源码、无 classes，双击不进 Spec 页
//           项目图内的 file 叶通过 entry_of 保留模块入口事实。
// DATE: 2026-07-02
const MODULE_ENTRY_RE = /IMPLEMENT_(?:PRIMARY_GAME_|GAME_)?MODULE\s*\(/;

export function extractClassGraph(roots: string[], options: ExtractClassesOptions = {}): GraphFile {
	return extractClassGraphWithCache(roots, options, null).graph;
}

/** 带解析缓存的提取：prior 为上次缓存（null = 全量重解析）；组装阶段与全量共用同一路径 */
export function extractClassGraphWithCache(
	roots: string[],
	options: ExtractClassesOptions = {},
	prior: ParseCache | null = null,
): ExtractWithCacheResult {
	const subsystem = options.subsystem ?? "project";
	const withEngine = options.withEngine ?? true;
	const cache = emptyParseCache(subsystem, roots);
	const stats = { projectCached: 0, projectParsed: 0, engineCached: 0, engineParsed: 0 };
	const sourceSnapshot = buildSourceSnapshot(roots);
	const consumedSourcePaths = new Set<string>();
	const canonicalSourcePath = (path: string) => resolve(path).replaceAll("\\", "/");

	// 根目录集合变化 → 旧缓存整体作废（缓存内 sourcePath 相对各自根，混用会错位）
	if (prior && JSON.stringify(prior.roots) !== JSON.stringify(cache.roots)) {
		console.log("解析缓存的根目录与本次不一致，忽略旧缓存（等效全量）");
		prior = null;
	}

	// —— 1. 项目侧解析 + 项目森林 ——
	const entries: ClassEntry[] = [];
	const usageByClass = new Map<string, Map<string, Set<string>>>();
	const bindingsByClass = new Map<string, ParsedDelegateBinding[]>();
	const forests: ForestBuilder[] = [];

	for (const root of roots) {
		const abs = resolve(root);
		const forest = new ForestBuilder(basename(abs));
		forests.push(forest);

		for (const header of findHeaders(abs)) {
			consumedSourcePaths.add(canonicalSourcePath(header));
			const key = header.replaceAll("\\", "/");
			const headerHash = hashContent(readFileSync(header, "utf-8"));
			const cppPath = header.replace(/\.h$/i, ".cpp");
			if (existsSync(cppPath)) consumedSourcePaths.add(canonicalSourcePath(cppPath));
			const cppHash = hashFile(cppPath);
			const module = findModuleName(header, abs);

			const hit = prior?.project_files[key];
			const fresh = !(hit && hit.hash === headerHash && hit.cpp_hash === cppHash);

			let classes: ParsedClass[];
			let usageJson: Record<string, Record<string, string[]>>;
			let bindingsJson: Record<string, ParsedDelegateBinding[]>;
			let isModuleEntry: boolean;
			if (fresh) {
				stats.projectParsed++;
				// 纯 C++ F/E/I/S 等文件级类型也必须成为可跳转的一等 Spec 节点。
				classes = parseHeader(header, abs, { includePlainCpp: true });
				usageJson = {};
				bindingsJson = {};
				for (const c of classes) {
					const usage = parseCppMemberUsage(cppPath, c);
					if (usage.size > 0) usageJson[c.name] = usageToJson(usage);
					const bindings = parseCppDelegateBindings(cppPath, c);
					if (bindings.length > 0) bindingsJson[c.name] = bindings;
				}
				isModuleEntry = existsSync(cppPath) && MODULE_ENTRY_RE.test(readFileSync(cppPath, "utf-8"));
			} else {
				stats.projectCached++;
				classes = hit.classes;
				usageJson = hit.usage;
				bindingsJson = hit.bindings;
				isModuleEntry = hit.is_module_entry;
			}
			cache.project_files[key] = {
				hash: headerHash,
				cpp_hash: cppHash,
				classes,
				usage: usageJson,
				bindings: bindingsJson,
				is_module_entry: isModuleEntry,
			};

			for (const c of classes) entries.push({ ...c, module, layer: "project" });
			for (const [clsName, json] of Object.entries(usageJson)) {
				usageByClass.set(clsName, usageFromJson(json));
			}
			for (const [clsName, bindings] of Object.entries(bindingsJson)) bindingsByClass.set(clsName, bindings);

			const rel = relative(abs, header).replaceAll("\\", "/");
			forest.addFile(rel, {
				module,
				...(existsSync(cppPath) ? { cpp_path: rel.replace(/\.h$/i, ".cpp") } : {}),
				classes: classes.map((c) => c.name),
				...(isModuleEntry
					? {
							file_kind: "module_entry",
							entry_of: module,
							tags: ["module_entry"],
							description: `模块入口：IMPLEMENT_PRIMARY_GAME_MODULE，模块「${module}」的源码锚点（对应模块图同名 module 节点）`,
						}
					: {}),
			});
			if (fresh && isModuleEntry) console.log(`  模块入口: ${rel}（模块 ${module}）`);

			if (fresh && classes.length > 0) {
				console.log(`解析 ${rel}: ${classes.map((c) => `${c.name}(${c.kind}, ${c.functions.length} fn, ${c.properties.length} prop${c.delegates.length ? `, ${c.delegates.length} delegate` : ""})`).join(", ")}`);
			}
		}

		// Build.cs 第三种文件叶（无 classes，双击不进 Spec）
		for (const buildCs of findBuildRules(abs)) {
			consumedSourcePaths.add(canonicalSourcePath(buildCs));
			const rel = relative(abs, buildCs).replaceAll("\\", "/");
			const moduleName = basename(buildCs).replace(/\.Build\.cs$/i, "");
			forest.addFile(rel, {
				module: moduleName,
				file_kind: "build_rules",
				entry_of: moduleName,
				description: `模块构建规则：定义「${moduleName}」的依赖（模块图 depends_on 边的数据源），非 C++ 源码`,
			});
			console.log(`  构建规则: ${rel}`);
		}
	}

	if (entries.length === 0) {
		throw new Error("未解析到任何 UCLASS/USTRUCT/UENUM/UINTERFACE");
	}

	// —— 2. 引擎侧按需解析（基类链 + 持有目标；止于 UObject；未命中回退种子链） ——
	// 缓存旁路只替换"解析"一步（含缓存过的未命中记录），BFS 遍历顺序与全量完全一致，
	// 保证 engineParsed 插入序 → entries/森林顺序 → 产物字节序不变。
	const projectNames = new Set(entries.map((e) => e.name));
	if (withEngine) {
		let engineRoot: string | null;
		if (options.engineRoot !== undefined) {
			engineRoot = options.engineRoot;
		} else {
			const uproject = options.uproject ?? findUproject(resolve(roots[0]));
			engineRoot = uproject ? engineRootFromUproject(uproject) : null;
		}
		cache.engine_root = engineRoot;
		const priorEngine = prior && prior.engine_root === engineRoot ? prior.engine_classes : null;
		if (!engineRoot) {
			console.log("未定位到引擎根目录（--uproject 可显式指定），引擎类回退种子链");
		} else {
			console.log(`引擎根: ${engineRoot}`);
			const engineSourceRoot = join(engineRoot, "Engine", "Source");
			const resolver = new EngineResolver(engineRoot);
			const engineParsed = new Map<string, { cls: ParsedClass; headerPath: string }>();
			const queue: string[] = [];
			for (const e of entries) {
				queue.push(...e.bases);
				queue.push(...e.interfaces);
				for (const p of e.properties) if (p.targetClass) queue.push(p.targetClass);
			}
			while (queue.length > 0) {
				const name = queue.pop()!;
				if (projectNames.has(name) || engineParsed.has(name) || name in cache.engine_classes) continue;

				const cached = priorEngine?.[name];
				let hit: { cls: ParsedClass; headerPath: string } | null;
				if (cached === null) {
					// 缓存过的未命中：引擎根未变则仍未命中，不再扫索引
					stats.engineCached++;
					cache.engine_classes[name] = null;
					continue;
				}
				if (cached && hashFile(cached.header) === cached.hash) {
					stats.engineCached++;
					hit = { cls: cached.cls, headerPath: cached.header };
					cache.engine_classes[name] = cached;
				} else {
					stats.engineParsed++;
					hit = resolver.resolveClass(name);
					if (!hit) {
						console.log(`  未命中 Runtime（回退种子链）: ${name}`);
						cache.engine_classes[name] = null;
						continue;
					}
					cache.engine_classes[name] = {
						header: hit.headerPath.replaceAll("\\", "/"),
						hash: hashFile(hit.headerPath)!,
						cls: hit.cls,
					};
					console.log(`  引擎解析 ${name}: ${relative(engineSourceRoot, hit.headerPath).replaceAll("\\", "/")}（${hit.cls.functions.length} fn, ${hit.cls.properties.length} prop, ${hit.cls.delegates.length} delegate）`);
				}
				engineParsed.set(name, hit);
				const base = hit.cls.bases[0];
				if (base && name !== "UObject" && !projectNames.has(base) && !engineParsed.has(base)) {
					queue.push(base);
				}
			}

			// 引擎森林子树 + 类条目
			const engineForest = new ForestBuilder("Engine");
			forests.push(engineForest);
			const fileClasses = new Map<string, string[]>();
			for (const [name, hit] of engineParsed) {
				entries.push({ ...hit.cls, module: findModuleName(hit.headerPath, engineSourceRoot), layer: "engine" });
				const rel = relative(engineSourceRoot, hit.headerPath).replaceAll("\\", "/");
				const list = fileClasses.get(rel) ?? [];
				list.push(name);
				fileClasses.set(rel, list);
			}
			for (const [rel, classNames] of fileClasses) {
				engineForest.addFile(rel, { classes: classNames });
			}
		}
	}

	// —— 3. 组图 + 森林并入 ——
	const skippedInputs = sourceSnapshot.files.filter((file) => !consumedSourcePaths.has(file.absolute_path));
	const sourceFailures = sourceSnapshot.diagnostics.filter((diagnostic) => diagnostic.code.endsWith("unreadable"));
	const provenance: SourceProvenance = sourceSnapshot.fingerprint
		? {
			schema_version: SOURCE_PROVENANCE_SCHEMA_VERSION,
			status: "verified",
			source_kind: "working_tree",
			source_roots: sourceSnapshot.roots,
			fingerprint: sourceSnapshot.fingerprint,
		}
		: {
			schema_version: SOURCE_PROVENANCE_SCHEMA_VERSION,
			status: "unknown",
			source_kind: "working_tree",
			source_roots: sourceSnapshot.roots,
		};
	const coverage: ExtractionCoverage = {
		status: skippedInputs.length > 0 || sourceFailures.length > 0 ? "partial" : "complete",
		discovered_files: sourceSnapshot.files.length,
		consumed_files: consumedSourcePaths.size,
		skipped_files: skippedInputs.length,
		failed_files: sourceFailures.length,
		diagnostics: [
			...sourceSnapshot.diagnostics,
			...skippedInputs.map((file) => ({
				code: "unsupported-source-input",
				path: `${file.root_index}:${file.relative_path}`,
				message: "The current class extractor inventories this file but does not consume it.",
			})),
		],
	};
	const graph = buildGraph(entries, subsystem, usageByClass, bindingsByClass, { provenance, coverage });
	for (const forest of forests) {
		graph.elements.nodes.push(...(forest.nodes as (typeof graph.elements.nodes)[number][]));
		graph.elements.edges.push(...(forest.edges as (typeof graph.elements.edges)[number][]));
		for (const e of forest.edges) {
			graph.elements.nodes.find((n) => n.data.id === e.data.source)!.data.metrics.out_degree++;
			graph.elements.nodes.find((n) => n.data.id === e.data.target)!.data.metrics.in_degree++;
		}
	}

	if (prior) {
		console.log(
			`缓存：项目文件命中 ${stats.projectCached} / 重解析 ${stats.projectParsed}；引擎类命中 ${stats.engineCached} / 重解析 ${stats.engineParsed}`,
		);
	}

	return { graph: graph as unknown as GraphFile, cache, stats };
}
