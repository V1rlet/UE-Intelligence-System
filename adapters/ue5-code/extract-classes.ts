// Graph Brain / adapters/ue5-code - 类级提取器：解析 *.h → 类关系图谱 (.cyto.json)
//
// 用法：
//   npx tsx adapters/ue5-code/extract-classes.ts <SourceDir...> [--out data/graphs] [--subsystem classes]
//
// 提取规则：
//   - UCLASS / USTRUCT / UENUM / UINTERFACE 宏 → 对应类型节点；继承链 → inherits 边，
//     I 前缀基类 → implements 边
//   - UPROPERTY 成员按持有语义生成边：T*/TObjectPtr → composes；TArray<指针>/TWeakObjectPtr
//     → aggregates；TSubclassOf → depends_on
//   - 成员函数 → ufunction 节点（parent=所属类）：UFUNCTION 宏者 cpp_only=false，
//     Blueprint* 说明符 → blueprint_exposable=true；无宏的普通声明也提取（cpp_only=true）
//   - /** */ 文档注释 → 节点 description（取声明紧上方的块）
//
// DECISION: 注释剥离采用"等长空格替换"，而非直接删除
// REASON: 剥离后字符串索引与原文完全对齐，doc 注释块可按位置回查挂到
//         紧随其后的声明上作为 description，无需二次解析。
// DATE: 2026-07-02
//
// DECISION: 节点类型判定用命名启发式（A*→uactor、*Component→ucomponent、I*→uinterface…）
// REASON: 引擎侧基类此阶段不解析源码，无真实继承链可用；UE 前缀命名约定足够可靠，
//         P2U4 种子层引入真实引擎类数据后可覆盖修正。
// DATE: 2026-07-02

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

// ████████████████████████████████████████████████████████████████████████████
//  注释处理：等长剥离 + 文档块采集
// ████████████████████████████████████████████████████████████████████████████

interface DocBlock {
	end: number; // 注释结束后的原文索引
	text: string;
}

function stripCommentsPreserveLength(src: string): { stripped: string; docs: DocBlock[] } {
	const out = src.split("");
	const docs: DocBlock[] = [];
	let i = 0;
	let inString = false;
	while (i < src.length) {
		const c = src[i];
		const d = src[i + 1];
		if (inString) {
			if (c === "\\") { i += 2; continue; }
			if (c === '"') inString = false;
			i++;
			continue;
		}
		if (c === '"') { inString = true; i++; continue; }
		if (c === "/" && d === "/") {
			while (i < src.length && src[i] !== "\n") { out[i] = " "; i++; }
			continue;
		}
		if (c === "/" && d === "*") {
			const start = i;
			i += 2;
			while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
			i += 2;
			const rawBlock = src.slice(start, i);
			for (let k = start; k < i && k < src.length; k++) {
				if (out[k] !== "\n") out[k] = " ";
			}
			if (rawBlock.startsWith("/**")) {
				const text = rawBlock
					.replace(/^\/\*\*/, "")
					.replace(/\*+\/$/, "")
					.split("\n")
					.map((l) => l.replace(/^\s*\*+\s?/, "").trim())
					.filter((l) => l.length > 0)
					.join(" ")
					.trim();
				if (text) docs.push({ end: i, text });
			}
			continue;
		}
		i++;
	}
	return { stripped: out.join(""), docs };
}

/** 取声明起点紧上方的文档块（两者之间只允许空白） */
function docBefore(docs: DocBlock[], stripped: string, declStart: number): string {
	for (let k = docs.length - 1; k >= 0; k--) {
		const doc = docs[k];
		if (doc.end <= declStart && stripped.slice(doc.end, declStart).trim() === "") {
			return doc.text.length > 300 ? doc.text.slice(0, 297) + "..." : doc.text;
		}
	}
	return "";
}

// ████████████████████████████████████████████████████████████████████████████
//  通用小工具：括号匹配、顶层逗号切分、类型清洗
// ████████████████████████████████████████████████████████████████████████████

/** 从 openIndex（指向 { 或 ( ）匹配到对应闭合符，返回闭合符索引；失败返回 -1 */
function matchBracket(text: string, openIndex: number): number {
	const open = text[openIndex];
	const close = open === "{" ? "}" : ")";
	let depth = 0;
	for (let i = openIndex; i < text.length; i++) {
		if (text[i] === open) depth++;
		else if (text[i] === close && --depth === 0) return i;
	}
	return -1;
}

/** 按顶层逗号切分（忽略 <> 和 () 内的逗号） */
function splitTopLevel(text: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let cur = "";
	for (const ch of text) {
		if (ch === "<" || ch === "(") depth++;
		else if (ch === ">" || ch === ")") depth--;
		if (ch === "," && depth === 0) {
			parts.push(cur.trim());
			cur = "";
		} else cur += ch;
	}
	if (cur.trim()) parts.push(cur.trim());
	return parts;
}

function normalizeWs(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

/** 清洗类型串：去 class/struct 前置与修饰关键字、多余空格 */
function cleanType(s: string): string {
	return normalizeWs(s.replace(/\b(class|struct|enum|FORCEINLINE|inline|constexpr|static|virtual)\s+/g, ""));
}

/** 命名启发式判定节点类型（引擎侧无源码可解析时使用） */
function guessTypeByName(name: string): string {
	if (/Component$/.test(name)) return "ucomponent";
	if (name.startsWith("A")) return "uactor";
	if (name.startsWith("I")) return "uinterface";
	if (name.startsWith("F")) return "ustruct";
	if (name.startsWith("E")) return "uenum";
	return "uclass";
}

// ████████████████████████████████████████████████████████████████████████████
//  成员解析：UPROPERTY / 函数声明
// ████████████████████████████████████████████████████████████████████████████

type HoldRelation = "composes" | "aggregates" | "depends_on";

interface ParsedProperty {
	name: string;
	type: string;
	targetClass: string | null; // 指向的 UObject 类名（不可判定时 null）
	relation: HoldRelation;
}

/** 从成员类型串推断持有的目标类与关系语义 */
function analyzeHold(type: string): { target: string; relation: HoldRelation } | null {
	let m = type.match(/^TObjectPtr\s*<\s*(\w+)\s*>$/);
	if (m) return { target: m[1], relation: "composes" };
	m = type.match(/^(\w+)\s*\*$/);
	if (m && /^[UA]/.test(m[1])) return { target: m[1], relation: "composes" };
	m = type.match(/^TArray\s*<\s*(?:TObjectPtr\s*<\s*(\w+)\s*>|(\w+)\s*\*)\s*>$/);
	if (m) return { target: m[1] ?? m[2], relation: "aggregates" };
	m = type.match(/^TWeakObjectPtr\s*<\s*(\w+)\s*>$/);
	if (m) return { target: m[1], relation: "aggregates" };
	m = type.match(/^TSubclassOf\s*<\s*(\w+)\s*>$/);
	if (m) return { target: m[1], relation: "depends_on" };
	return null;
}

function parseProperty(statement: string): ParsedProperty | null {
	// 形如 "USpringArmComponent* CameraBoom" / "bool bForceTouchControls = false"
	const noDefault = statement.split("=")[0].trim();
	const m = noDefault.match(/^(.+?)\s*(\w+)$/s);
	if (!m) return null;
	const type = cleanType(m[1]);
	const hold = analyzeHold(type);
	return { name: m[2], type, targetClass: hold?.target ?? null, relation: hold?.relation ?? "composes" };
}

interface ParsedFunction {
	name: string;
	returnType: string;
	params: { name: string; type: string }[];
	signature: string;
	isConst: boolean;
	isOverride: boolean;
	hasUFunction: boolean;
	blueprintExposable: boolean;
	category: string | null;
	declStart: number; // 在 stripped 全文中的起始索引（用于回查 doc）
	description?: string;
}

function parseParams(paramText: string): { name: string; type: string }[] {
	const trimmed = paramText.trim();
	if (!trimmed || trimmed === "void") return [];
	return splitTopLevel(trimmed).map((p) => {
		const noDefault = p.split("=")[0].trim();
		const m = noDefault.match(/^(.+?)\s*(\w+)$/s);
		if (!m) return { name: "", type: cleanType(noDefault) };
		return { name: m[2], type: cleanType(m[1]) };
	});
}

const FUNC_DECL_RE =
	/(?:FORCEINLINE\s+)?(?:static\s+)?(?:virtual\s+)?([A-Za-z_][\w:<>,\s*&]*?[\w>*&])\s+(\w+)\s*\(([^)]*)\)\s*(const)?\s*(override)?\s*(?:final\s*)?[;{]/g;

const SKIP_FUNC_NAMES = new Set(["GENERATED_BODY", "GENERATED_UCLASS_BODY", "GENERATED_USTRUCT_BODY", "GENERATED_IINTERFACE_BODY", "UPROPERTY", "UFUNCTION"]);

// ████████████████████████████████████████████████████████████████████████████
//  单文件解析
// ████████████████████████████████████████████████████████████████████████████

interface ParsedClass {
	name: string;
	kind: "uclass" | "uactor" | "ucomponent" | "ustruct" | "uenum" | "uinterface";
	bases: string[];
	interfaces: string[];
	description: string;
	tags: string[];
	sourcePath: string;
	properties: ParsedProperty[];
	functions: ParsedFunction[];
}

/** 将类体内的内联函数体 {...} 压平为 ';'，避免函数体内语句被误识别为声明 */
function flattenInlineBodies(body: string): string {
	let out = "";
	let i = 0;
	while (i < body.length) {
		if (body[i] === "{") {
			const close = matchBracket(body, i);
			if (close === -1) break;
			out += ";";
			i = close + 1;
		} else {
			out += body[i];
			i++;
		}
	}
	return out;
}

function parseHeader(filePath: string, sourceRoot: string): ParsedClass[] {
	const raw = readFileSync(filePath, "utf-8").replace(/^﻿/, "");
	const { stripped, docs } = stripCommentsPreserveLength(raw);
	const sourcePath = relative(sourceRoot, filePath).replaceAll("\\", "/");
	const results: ParsedClass[] = [];

	// —— UCLASS / USTRUCT / UINTERFACE ——
	const typeMacroRe = /\b(UCLASS|USTRUCT|UINTERFACE)\s*\(/g;
	let mm: RegExpExecArray | null;
	while ((mm = typeMacroRe.exec(stripped)) !== null) {
		const macro = mm[1];
		const argsClose = matchBracket(stripped, typeMacroRe.lastIndex - 1);
		if (argsClose === -1) continue;
		const macroArgs = stripped.slice(typeMacroRe.lastIndex, argsClose);

		const declRe = /(class|struct)\s+(?:\w+_API\s+)?(\w+)\s*(?::\s*([^{]+))?\{/g;
		declRe.lastIndex = argsClose + 1;
		const decl = declRe.exec(stripped);
		if (!decl) continue;
		const name = decl[2];
		const baseList = decl[3] ? splitTopLevel(decl[3]).map((b) => normalizeWs(b.replace(/\b(public|protected|private|virtual)\b/g, ""))) : [];
		const bodyOpen = declRe.lastIndex - 1;
		const bodyClose = matchBracket(stripped, bodyOpen);
		if (bodyClose === -1) continue;
		// 访问标签等长替换为 ';'+空格：既当语句分隔符防止函数声明正则跨标签吞并，又保持索引对齐
		const body = stripped
			.slice(bodyOpen + 1, bodyClose)
			.replace(/\b(?:public|protected|private)\s*:/g, (m) => ";" + " ".repeat(m.length - 1));

		// UINTERFACE 的 U 类只是标记壳，真正的契约在同名 I 类（下方单独收集）
		if (macro === "UINTERFACE") continue;

		const bases = baseList.filter((b) => b && !b.startsWith("I"));
		const interfaces = baseList.filter((b) => b.startsWith("I"));

		let kind: ParsedClass["kind"];
		if (macro === "USTRUCT") kind = "ustruct";
		else {
			const primary = bases[0] ?? "";
			if (name.startsWith("A") || primary.startsWith("A")) kind = "uactor";
			else if (/Component$/.test(name) || /Component$/.test(primary)) kind = "ucomponent";
			else kind = "uclass";
		}

		const tags: string[] = [];
		if (/\babstract\b/i.test(macroArgs)) tags.push("abstract");
		if (/\bBlueprintable\b/.test(macroArgs)) tags.push("blueprintable");

		const cls: ParsedClass = {
			name, kind, bases, interfaces,
			description: docBefore(docs, stripped, mm.index),
			tags, sourcePath,
			properties: [],
			functions: [],
		};

		// —— 类体成员：UPROPERTY ——
		const propRe = /\bUPROPERTY\s*\(/g;
		let pm: RegExpExecArray | null;
		while ((pm = propRe.exec(body)) !== null) {
			const close = matchBracket(body, propRe.lastIndex - 1);
			if (close === -1) continue;
			const semi = body.indexOf(";", close);
			if (semi === -1) continue;
			const parsed = parseProperty(body.slice(close + 1, semi));
			if (parsed) cls.properties.push(parsed);
			propRe.lastIndex = semi + 1;
		}

		// —— 类体成员：UFUNCTION ——
		const consumedNames = new Set<string>();
		const funcMacroRe = /\bUFUNCTION\s*\(/g;
		let fm: RegExpExecArray | null;
		while ((fm = funcMacroRe.exec(body)) !== null) {
			const close = matchBracket(body, funcMacroRe.lastIndex - 1);
			if (close === -1) continue;
			const fnArgs = body.slice(funcMacroRe.lastIndex, close);
			FUNC_DECL_RE.lastIndex = close + 1;
			const fd = FUNC_DECL_RE.exec(body);
			if (!fd || SKIP_FUNC_NAMES.has(fd[2])) continue;
			// doc 注释位于 UFUNCTION 宏上方，回查坐标用宏起点
			cls.functions.push(buildFunction(fd, true, fnArgs, bodyOpen + 1 + fm.index));
			consumedNames.add(fd[2]);
			funcMacroRe.lastIndex = FUNC_DECL_RE.lastIndex;
		}

		// —— 类体成员：无宏的普通函数声明（压平内联函数体后扫描） ——
		const flatBody = flattenInlineBodies(body);
		FUNC_DECL_RE.lastIndex = 0;
		let fd: RegExpExecArray | null;
		while ((fd = FUNC_DECL_RE.exec(flatBody)) !== null) {
			const fname = fd[2];
			if (SKIP_FUNC_NAMES.has(fname) || consumedNames.has(fname) || fname === name || fname.startsWith("~")) continue;
			// 压平后索引与原文不对齐，用匹配文本（去掉结尾 ;/{ ）在原 body 中定位声明起点
			const needle = fd[0].slice(0, -1).trimEnd();
			const origIdx = body.indexOf(needle);
			const declStart = origIdx === -1 ? 0 : bodyOpen + 1 + origIdx;
			cls.functions.push(buildFunction(fd, false, "", declStart));
			consumedNames.add(fname);
		}

		results.push(cls);
	}

	// —— UENUM ——
	const enumRe = /\bUENUM\s*\(([^)]*)\)/g;
	while ((mm = enumRe.exec(stripped)) !== null) {
		const em = /enum\s+(?:class\s+)?(\w+)/g;
		em.lastIndex = enumRe.lastIndex;
		const ed = em.exec(stripped);
		if (!ed) continue;
		results.push({
			name: ed[1], kind: "uenum", bases: [], interfaces: [],
			description: docBefore(docs, stripped, mm.index),
			tags: [], sourcePath, properties: [], functions: [],
		});
	}

	// —— UINTERFACE 的 I 契约类 ——
	const ifaceRe = /\bUINTERFACE\s*\([^)]*\)/g;
	while ((mm = ifaceRe.exec(stripped)) !== null) {
		const um = /class\s+(?:\w+_API\s+)?U(\w+)/g;
		um.lastIndex = ifaceRe.lastIndex;
		const ud = um.exec(stripped);
		if (!ud) continue;
		const iName = `I${ud[1]}`;
		if (stripped.includes(`class ${iName}`) || new RegExp(`class\\s+\\w+_API\\s+${iName}\\b`).test(stripped)) {
			results.push({
				name: iName, kind: "uinterface", bases: [], interfaces: [],
				description: docBefore(docs, stripped, mm.index),
				tags: [], sourcePath, properties: [], functions: [],
			});
		}
	}

	// 成员函数 description 回查（declStart 是 stripped 全文坐标）
	for (const cls of results) {
		for (const fn of cls.functions) {
			fn.description = docBefore(docs, stripped, fn.declStart);
		}
	}
	return results;
}

function buildFunction(
	fd: RegExpExecArray,
	hasUFunction: boolean,
	macroArgs: string,
	declStart: number,
): ParsedFunction {
	const returnType = cleanType(fd[1]);
	const name = fd[2];
	const params = parseParams(fd[3]);
	const isConst = !!fd[4];
	const isOverride = !!fd[5];
	const paramSig = fd[3].trim() ? normalizeWs(fd[3]) : "";
	const catMatch = macroArgs.match(/Category\s*=\s*"([^"]+)"/);
	return {
		name, returnType, params,
		signature: `${returnType} ${name}(${paramSig})${isConst ? " const" : ""}`,
		isConst, isOverride, hasUFunction,
		blueprintExposable: /Blueprint(Callable|Pure|NativeEvent|ImplementableEvent)/.test(macroArgs),
		category: catMatch ? catMatch[1] : null,
		declStart,
	};
}

// ████████████████████████████████████████████████████████████████████████████
//  图谱构建
// ████████████████████████████████████████████████████████████████████████████

interface AnyNode { data: Record<string, unknown> & { id: string; metrics: { in_degree: number; out_degree: number } } }
interface AnyEdge { data: { id: string; source: string; target: string; relation: string; domain: string; weight?: number; description?: string } }

function buildGraph(classes: (ParsedClass & { module: string })[], sourceRoots: string[], subsystem: string) {
	const nodes = new Map<string, AnyNode>();
	const edges = new Map<string, AnyEdge>();
	const projectNames = new Set(classes.map((c) => c.name));

	const ensureEngineNode = (name: string) => {
		if (nodes.has(name)) return;
		nodes.set(name, {
			data: {
				id: name, label: name, type: guessTypeByName(name), layer: "engine",
				domain: "ue5_code", visibility: "silhouette",
				metrics: { in_degree: 0, out_degree: 0 },
			},
		});
	};

	const addEdge = (source: string, target: string, relation: string, weight?: number, description?: string) => {
		if (!projectNames.has(target)) ensureEngineNode(target);
		const id = `${source}--${relation}-->${target}`;
		const prev = edges.get(id);
		if (prev) {
			if (description) prev.data.description = prev.data.description ? `${prev.data.description}, ${description}` : description;
			return;
		}
		edges.set(id, { data: { id, source, target, relation, domain: "ue5_code", ...(weight ? { weight } : {}), ...(description ? { description } : {}) } });
	};

	for (const cls of classes) {
		nodes.set(cls.name, {
			data: {
				id: cls.name, label: cls.name, type: cls.kind, layer: "project",
				module: cls.module, domain: "ue5_code",
				...(cls.description ? { description: cls.description } : {}),
				source_path: cls.sourcePath,
				...(cls.tags.length ? { tags: cls.tags } : {}),
				visibility: "explored",
				metrics: { in_degree: 0, out_degree: 0 },
			},
		});
	}

	for (const cls of classes) {
		for (const base of cls.bases) addEdge(cls.name, base, "inherits");
		for (const iface of cls.interfaces) addEdge(cls.name, iface, "implements");

		const holdBuckets = new Map<string, { relation: HoldRelation; members: string[] }>();
		for (const p of cls.properties) {
			if (!p.targetClass) continue;
			const key = `${p.relation}:${p.targetClass}`;
			const bucket = holdBuckets.get(key) ?? { relation: p.relation, members: [] };
			bucket.members.push(p.name);
			holdBuckets.set(key, bucket);
		}
		for (const [key, bucket] of holdBuckets) {
			const target = key.split(":")[1];
			addEdge(cls.name, target, bucket.relation, undefined, bucket.members.join(", "));
		}

		for (const fn of cls.functions) {
			const fnId = `${cls.name}::${fn.name}`;
			if (nodes.has(fnId)) continue;
			const tags: string[] = [];
			if (fn.isOverride) tags.push("override");
			if (fn.category) tags.push(`#${fn.category.split("|")[0].toLowerCase().replace(/\s+/g, "_")}`);
			nodes.set(fnId, {
				data: {
					id: fnId, label: fn.name, type: "ufunction", layer: "project",
					module: cls.module, domain: "ue5_code", parent: cls.name,
					...(fn.description ? { description: fn.description } : {}),
					source_path: cls.sourcePath,
					...(tags.length ? { tags } : {}),
					visibility: "explored",
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
	}

	for (const e of edges.values()) {
		nodes.get(e.data.source)?.data.metrics && nodes.get(e.data.source)!.data.metrics.out_degree++;
		nodes.get(e.data.target)?.data.metrics && nodes.get(e.data.target)!.data.metrics.in_degree++;
	}

	return {
		meta: {
			domain: "ue5_code",
			subsystem,
			generated_at: new Date().toISOString(),
			generator: "ue5-code-adapter/extract-classes@0.1.0",
			source_root: sourceRoots.map((r) => resolve(r).replaceAll("\\", "/")).join(";"),
		},
		elements: { nodes: [...nodes.values()], edges: [...edges.values()] },
	};
}

// ████████████████████████████████████████████████████████████████████████████
//  入口
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

/** 向上找最近的 *.Build.cs 目录名作为模块名 */
function findModuleName(headerPath: string, stopAt: string): string {
	let dir = dirname(headerPath);
	while (dir.length >= stopAt.length) {
		const buildCs = readdirSync(dir).find((f) => f.endsWith(".Build.cs"));
		if (buildCs) return basename(buildCs).replace(/\.Build\.cs$/i, "");
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return "Unknown";
}

const argv = process.argv.slice(2);
const roots: string[] = [];
let outDir = "data/graphs";
let subsystem = "classes";
for (let i = 0; i < argv.length; i++) {
	if (argv[i] === "--out") outDir = argv[++i];
	else if (argv[i] === "--subsystem") subsystem = argv[++i];
	else roots.push(argv[i]);
}
if (roots.length === 0) {
	console.error("用法: npx tsx adapters/ue5-code/extract-classes.ts <SourceDir...> [--out data/graphs] [--subsystem classes]");
	process.exit(2);
}

const allClasses: (ParsedClass & { module: string })[] = [];
for (const root of roots) {
	const abs = resolve(root);
	for (const header of findHeaders(abs)) {
		const classes = parseHeader(header, abs);
		const module = findModuleName(header, abs);
		for (const c of classes) allClasses.push({ ...c, module });
		if (classes.length > 0) {
			console.log(`解析 ${relative(abs, header)}: ${classes.map((c) => `${c.name}(${c.kind}, ${c.functions.length} fn, ${c.properties.length} prop)`).join(", ")}`);
		}
	}
}

if (allClasses.length === 0) {
	console.error("未解析到任何 UCLASS/USTRUCT/UENUM/UINTERFACE");
	process.exit(1);
}

const graph = buildGraph(allClasses, roots, subsystem);
const date = new Date().toISOString().slice(0, 10);
const outPath = join(outDir, `ue5_code_${subsystem}_${date}.cyto.json`);
mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, JSON.stringify(graph, null, 2) + "\n", "utf-8");
console.log(`\n已生成 ${outPath}: ${graph.elements.nodes.length} 个节点, ${graph.elements.edges.length} 条边`);
