// Graph Brain / adapters/ue5-code - UE 5.8 C++ API 目录：本地源码索引 + Epic 官方文档链接
//
// DECISION: API 汇总以本机 Engine/Source 与 Engine/Plugins 为精确数据源，Epic /API 作为权威导航与详情外链。
// REASON: Epic 5.8 已取消旧版单页 /API/Classes 汇总，改为 Developer/Editor/Runtime/Plugins → Module 分层；
//         本地源码目录与该层级一一对应，还能保证索引严格匹配实际安装的 5.8 版本。
// DATE: 2026-07-12

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { UE_API_CLASS_PREFIXES, UE_API_ENUM_PREFIX } from "../../core/schema/ue-naming.js";
import { loadEpicApiModule, loadEpicApiRoot } from "./epic-api-sync.js";
import { stripCommentsPreserveLength } from "./header-parser.js";

export type EngineApiScope = "Runtime" | "Developer" | "Editor" | "Plugins";

export interface EngineApiModuleEntry {
	name: string;
	scope: EngineApiScope;
	header_count: number;
	docs_url: string;
}

export interface EngineApiCatalog {
	engine_version: string;
	docs_version: string;
	docs_root: string;
	generated_at: string;
	modules: EngineApiModuleEntry[];
	totals: { modules: number; headers: number };
	official_cache: { synced: boolean; modules: number; synced_at?: string };
}

export interface EngineApiClassEntry {
	name: string;
	kind: "class" | "struct" | "enum";
	scope: EngineApiScope;
	module: string;
	source_path: string;
	docs_url: string;
	remarks?: string;
	official_kind?: string;
	available_in_source: boolean;
	/** 本地解析器能否生成同构 Spec；源码中的完整类型定义均可离线解析。 */
	parseable: boolean;
}

interface HeaderEntry {
	path: string;
	relativePath: string;
}

interface IndexedModule extends EngineApiModuleEntry {
	headers: HeaderEntry[];
}

interface CatalogIndex {
	catalog: EngineApiCatalog;
	modules: Map<string, IndexedModule>;
	classes: Map<string, EngineApiClassEntry[]>;
}

export interface EngineApiSymbol {
	name: string;
	kind: "class" | "struct" | "enum";
	parseable: boolean;
}

/**
 * 提取真正的类型定义。目录只收带类型体的定义，避免把 template<class T>、
 * 前向声明及注释示例误报成可点击 API。
 */
export function extractEngineApiSymbols(content: string): EngineApiSymbol[] {
	const { stripped } = stripCommentsPreserveLength(content);
	const symbols = new Map<string, EngineApiSymbol>();
	const classPrefixes = UE_API_CLASS_PREFIXES.join("");
	const declaration = new RegExp(`(?<!enum\\s)\\b(class|struct)\\s+(?:(?:\\w+_API)\\s+|(?:UE_DEPRECATED(?:_FORGAME)?\\s*\\([^)]*\\))\\s+)*([${classPrefixes}][A-Za-z0-9_]*)\\s*(?::[^;{}]+)?\\s*\\{`, "g");
	const enumDeclaration = new RegExp(`\\benum\\s+(?:class\\s+)?(${UE_API_ENUM_PREFIX}[A-Za-z0-9_]*)\\s*(?::[^;{}]+)?\\s*\\{`, "g");
	for (const match of stripped.matchAll(declaration)) {
		const name = match[2];
		if (!symbols.has(name)) {
			symbols.set(name, {
				name,
				kind: match[1] === "struct" || name.startsWith("F") ? "struct" : "class",
				parseable: true,
			});
		}
	}
	for (const match of stripped.matchAll(enumDeclaration)) {
		const name = match[1];
		if (!symbols.has(name)) symbols.set(name, { name, kind: "enum", parseable: true });
	}
	return [...symbols.values()];
}

const DOCS_ROOT = "https://dev.epicgames.com/documentation/en-us/unreal-engine/API";
const indexCache = new Map<string, CatalogIndex>();

function docsUrl(scope: EngineApiScope, module: string, symbol?: string): string {
	return `${DOCS_ROOT}/${scope}/${encodeURIComponent(module)}${symbol ? `/${encodeURIComponent(symbol)}` : ""}`;
}

function collectPublicHeaders(root: string, engineRoot: string): HeaderEntry[] {
	const out: HeaderEntry[] = [];
	const walk = (dir: string) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (/^(Private|Tests?|Intermediate|Binaries)$/i.test(entry.name)) continue;
				walk(path);
			} else if (entry.name.endsWith(".h")) {
				out.push({ path, relativePath: relative(join(engineRoot, "Engine"), path).replaceAll("\\", "/") });
			}
		}
	};
	walk(root);
	return out;
}

function addModule(
	modules: Map<string, IndexedModule>,
	engineRoot: string,
	scope: EngineApiScope,
	moduleName: string,
	moduleRoot: string,
) {
	const headers = collectPublicHeaders(moduleRoot, engineRoot);
	if (headers.length === 0) return;
	const key = `${scope}:${moduleName}`;
	modules.set(key, {
		name: moduleName,
		scope,
		header_count: headers.length,
		docs_url: docsUrl(scope, moduleName),
		headers,
	});
}

function buildIndex(engineRoot: string): CatalogIndex {
	const cached = indexCache.get(engineRoot);
	if (cached) return cached;

	const modules = new Map<string, IndexedModule>();
	for (const scope of ["Runtime", "Developer", "Editor"] as const) {
		const scopeRoot = join(engineRoot, "Engine", "Source", scope);
		if (!existsSync(scopeRoot)) continue;
		for (const entry of readdirSync(scopeRoot, { withFileTypes: true })) {
			if (entry.isDirectory()) addModule(modules, engineRoot, scope, entry.name, join(scopeRoot, entry.name));
		}
	}

	const pluginsRoot = join(engineRoot, "Engine", "Plugins");
	const walkPlugins = (dir: string) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const path = join(dir, entry.name);
			if (entry.name === "Source") {
				for (const moduleDir of readdirSync(path, { withFileTypes: true })) {
					if (!moduleDir.isDirectory()) continue;
					const moduleRoot = join(path, moduleDir.name);
					// 模块名以 *.Build.cs 文件名为准：不少插件的模块目录叫 Runtime/Editor，
					// 与真实模块名（如 AnimationLocomotionLibraryRuntime）不一致，按目录名匹配会整个漏掉
					let buildCs: string | undefined;
					try {
						buildCs = readdirSync(moduleRoot).find((file) => file.endsWith(".Build.cs"));
					} catch { /* 不可读目录跳过 */ }
					if (buildCs) {
						addModule(modules, engineRoot, "Plugins", buildCs.slice(0, -".Build.cs".length), moduleRoot);
					}
				}
			} else if (!/^(Intermediate|Binaries|Content)$/i.test(entry.name)) {
				walkPlugins(path);
			}
		}
	};
	if (existsSync(pluginsRoot)) walkPlugins(pluginsRoot);

	const entries = [...modules.values()].sort((a, b) =>
		a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name),
	);
	const catalog: EngineApiCatalog = {
		engine_version: basename(engineRoot).replace(/^UE_/, ""),
		docs_version: "5.8",
		docs_root: DOCS_ROOT,
		generated_at: new Date().toISOString(),
		modules: entries.map(({ headers: _headers, ...entry }) => entry),
		totals: {
			modules: entries.length,
			headers: entries.reduce((sum, entry) => sum + entry.header_count, 0),
		},
		official_cache: (() => {
			const official = loadEpicApiRoot();
			return official
				? { synced: true, modules: official.modules.length, synced_at: official.synced_at }
				: { synced: false, modules: 0 };
		})(),
	};
	const index = { catalog, modules, classes: new Map<string, EngineApiClassEntry[]>() };
	indexCache.set(engineRoot, index);
	return index;
}

function classesForModule(index: CatalogIndex, module: IndexedModule): EngineApiClassEntry[] {
	const key = `${module.scope}:${module.name}`;
	const cached = index.classes.get(key);
	if (cached) return cached;

	const symbols = new Map<string, EngineApiClassEntry>();
	for (const header of module.headers) {
		let content: string;
		try {
			content = readFileSync(header.path, "utf8");
		} catch {
			continue;
		}
		for (const symbol of extractEngineApiSymbols(content)) {
			const { name } = symbol;
			if (!symbols.has(name)) {
				symbols.set(name, {
					name,
					kind: symbol.kind,
					scope: module.scope,
					module: module.name,
					source_path: header.relativePath,
					docs_url: docsUrl(module.scope, module.name, name),
					available_in_source: true,
					parseable: symbol.parseable,
				});
			}
		}
	}
	const official = loadEpicApiModule(module.scope, module.name);
	if (official) {
		for (const item of official.symbols) {
			if (!/^(Classes|Structs|Enums|Interfaces)$/i.test(item.kind)) continue;
			const existing = symbols.get(item.name);
			if (existing) {
				existing.remarks = item.remarks;
				existing.official_kind = item.kind;
				existing.docs_url = item.url;
			} else {
				symbols.set(item.name, {
					name: item.name,
					kind: /^Enums$/i.test(item.kind) ? "enum" : /^Structs$/i.test(item.kind) ? "struct" : "class",
					scope: module.scope,
					module: module.name,
					source_path: "",
					docs_url: item.url,
					remarks: item.remarks,
					official_kind: item.kind,
					available_in_source: false,
					parseable: false,
				});
			}
		}
	}
	const result = [...symbols.values()].sort((a, b) => a.name.localeCompare(b.name));
	index.classes.set(key, result);
	return result;
}

function classesForHeaderPage(
	module: IndexedModule,
	offset: number,
	headerLimit: number,
): EngineApiClassEntry[] {
	const symbols = new Map<string, EngineApiClassEntry>();
	for (const header of module.headers.slice(offset, offset + headerLimit)) {
		let content: string;
		try {
			content = readFileSync(header.path, "utf8");
		} catch {
			continue;
		}
		for (const symbol of extractEngineApiSymbols(content)) {
			const { name } = symbol;
			if (!symbols.has(name)) symbols.set(name, {
				name,
				kind: symbol.kind,
				scope: module.scope,
				module: module.name,
				source_path: header.relativePath,
				docs_url: docsUrl(module.scope, module.name, name),
				available_in_source: true,
				parseable: symbol.parseable,
			});
		}
	}
	return [...symbols.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getEngineApiCatalog(engineRoot: string): EngineApiCatalog {
	return buildIndex(engineRoot).catalog;
}

export function searchEngineApiClasses(
	engineRoot: string,
	options: { query?: string; scope?: string; module?: string; limit?: number; headerOffset?: number; headerLimit?: number },
): { results: EngineApiClassEntry[]; total: number; truncated: boolean; next_header_offset?: number; has_more_headers?: boolean; total_headers?: number } {
	const index = buildIndex(engineRoot);
	const query = options.query?.trim().toLowerCase() ?? "";
	const requestedLimit = Number.isFinite(options.limit) ? options.limit! : 200;
	const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 1000);
	const modules = [...index.modules.values()].filter((entry) =>
		(!options.scope || entry.scope === options.scope) && (!options.module || entry.name === options.module),
	);
	const results: EngineApiClassEntry[] = [];
	if (options.headerLimit !== undefined) {
		if (!options.scope || !options.module || modules.length !== 1) {
			throw new Error("分页源码解析必须先指定 scope 与 module，禁止跨模块全量读取");
		}
		const module = modules[0];
		const requestedOffset = Number.isFinite(options.headerOffset) ? options.headerOffset! : 0;
		const requestedHeaderLimit = Number.isFinite(options.headerLimit) ? options.headerLimit : 1;
		const headerOffset = Math.max(Math.trunc(requestedOffset), 0);
		const headerLimit = Math.min(Math.max(Math.trunc(requestedHeaderLimit), 1), 64);
		for (const entry of classesForHeaderPage(module, headerOffset, headerLimit)) {
			if (query && !entry.name.toLowerCase().includes(query)) continue;
			results.push(entry);
		}
		const nextOffset = headerOffset + headerLimit;
		return {
			results: results.slice(0, limit),
			total: results.length,
			truncated: results.length > limit,
			next_header_offset: Math.min(nextOffset, module.header_count),
			has_more_headers: nextOffset < module.header_count,
			total_headers: module.header_count,
		};
	}
	for (const module of modules) {
		for (const entry of classesForModule(index, module)) {
			if (query && !entry.name.toLowerCase().includes(query)) continue;
			results.push(entry);
		}
	}
	results.sort((a, b) => {
		const aExact = query && a.name.toLowerCase() === query ? 0 : 1;
		const bExact = query && b.name.toLowerCase() === query ? 0 : 1;
		return aExact - bExact || a.name.localeCompare(b.name);
	});
	return { results: results.slice(0, limit), total: results.length, truncated: results.length > limit };
}
