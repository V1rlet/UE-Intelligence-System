// Graph Brain / adapters/ue5-code - UE 头文件解析核心：项目源码与引擎源码共用
// 从 extract-classes.ts 抽离（P2U4），新增委托声明/委托成员解析
//
// DECISION: 注释剥离采用"等长空格替换"，而非直接删除
// REASON: 剥离后字符串索引与原文完全对齐，doc 注释块可按位置回查挂到
//         紧随其后的声明上作为 description，无需二次解析。
// DATE: 2026-07-02

import { existsSync, readFileSync, statSync } from "node:fs";
import { relative } from "node:path";
import { ueTypeFromCodeName } from "../../core/schema/ue-naming.js";

// ████████████████████████████████████████████████████████████████████████████
//  注释处理：等长剥离 + 文档块采集
// ████████████████████████████████████████████████████████████████████████████

interface DocBlock {
	end: number;
	text: string;
}

export function stripCommentsPreserveLength(src: string): { stripped: string; docs: DocBlock[] } {
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
//  通用小工具
// ████████████████████████████████████████████████████████████████████████████

/** 单个括号/花括号配对的扫描窗口：超过即视为未闭合（防止畸形输入 O(n²) 拖垮解析）。 */
const MAX_BRACKET_SCAN = 64 * 1024;

/** 从 from 起找"顶层"分号：跳过字符串字面量（含转义）与括号/花括号深度。 */
function indexOfTopLevelSemicolon(text: string, from: number): number {
	let quote: "'" | '"' | null = null;
	let paren = 0;
	let brace = 0;
	const limit = Math.min(text.length, from + MAX_BRACKET_SCAN);
	for (let i = from; i < limit; i++) {
		const ch = text[i];
		if (quote) {
			if (ch === "\\") { i++; continue; }
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'") { quote = ch; continue; }
		if (ch === "(") { paren++; continue; }
		if (ch === ")") { if (paren > 0) paren--; continue; }
		if (ch === "{") { brace++; continue; }
		if (ch === "}") { if (brace > 0) brace--; continue; }
		if (ch === ";" && paren === 0 && brace === 0) return i;
	}
	return -1;
}

export function matchBracket(text: string, openIndex: number): number {
	const open = text[openIndex];
	const close = open === "{" ? "}" : ")";
	let depth = 0;
	const limit = Math.min(text.length, openIndex + MAX_BRACKET_SCAN);
	for (let i = openIndex; i < limit; i++) {
		if (text[i] === open) depth++;
		else if (text[i] === close && --depth === 0) return i;
	}
	return -1;
}

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

function cleanType(s: string): string {
	return normalizeWs(s.replace(/\b(class|struct|enum|FORCEINLINE|inline|constexpr|static|virtual)\s+/g, ""));
}

export function guessTypeByName(name: string): string {
	return ueTypeFromCodeName(name);
}

// ████████████████████████████████████████████████████████████████████████████
//  成员解析：UPROPERTY / 函数声明 / 委托
// ████████████████████████████████████████████████████████████████████████████

export type HoldRelation = "composes" | "aggregates" | "depends_on";

export interface ParsedProperty {
	name: string;
	type: string;
	targetClass: string | null;
	relation: HoldRelation;
}

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

export function parseProperty(statement: string): ParsedProperty | null {
	const noDefault = statement.split("=")[0].trim();
	// UE 大量 bool 状态以 uint8 位域声明；若不先剥离 ": 1"，尾部数字会被误当成员名。
	const noBitfield = noDefault.replace(/\s*:\s*\d+\s*$/, "");
	const m = noBitfield.match(/^(.+?)\s*(\w+)$/s);
	if (!m) return null;
	const type = cleanType(m[1]);
	const hold = analyzeHold(type);
	return { name: m[2], type, targetClass: hold?.target ?? null, relation: hold?.relation ?? "composes" };
}

export interface ParsedFunction {
	name: string;
	returnType: string;
	params: { name: string; type: string }[];
	signature: string;
	isConst: boolean;
	isOverride: boolean;
	isStatic: boolean;
	hasUFunction: boolean;
	blueprintExposable: boolean;
	category: string | null;
	declStart: number;
	description?: string;
}

function parseParams(paramText: string): { name: string; type: string }[] {
	const trimmed = paramText.trim();
	if (!trimmed || trimmed === "void") return [];
	return splitTopLevel(trimmed).map((p) => {
		const noDefault = p.split("=")[0].trim();
		// 单词条必为匿名参数（如 void Func(float)）：参数一定有类型、未必有名字，
		// 不拆词，否则 "float" 会被误拆成 type:"f" + name:"loat"
		if (/^\w+$/.test(noDefault)) return { name: "", type: cleanType(noDefault) };
		const m = noDefault.match(/^(.+?)\s*(\w+)$/s);
		if (!m) return { name: "", type: cleanType(noDefault) };
		return { name: m[2], type: cleanType(m[1]) };
	});
}

const FUNC_DECL_RE =
	/(?:FORCEINLINE\s+)?(?:static\s+)?(?:virtual\s+)?([A-Za-z_][\w:<>,\s*&]{0,4096}?[\w>*&])\s+(\w+)\s*\(([^)]{0,4096})\)\s*(const)?\s*(override)?\s*(?:final\s*)?(?:=\s*0\s*)?[;{]/g;

const SKIP_FUNC_NAMES = new Set([
	"GENERATED_BODY", "GENERATED_UCLASS_BODY", "GENERATED_USTRUCT_BODY",
	"GENERATED_IINTERFACE_BODY", "UPROPERTY", "UFUNCTION", "UE_DEPRECATED",
]);

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
	const isStatic = /^(?:FORCEINLINE\s+)?static\b/.test(fd[0].trimStart());
	const paramSig = fd[3].trim() ? normalizeWs(fd[3]) : "";
	const catMatch = macroArgs.match(/Category\s*=\s*"([^"]+)"/);
	return {
		name, returnType, params,
		signature: `${isStatic ? "static " : ""}${returnType} ${name}(${paramSig})${isConst ? " const" : ""}`,
		isConst, isOverride, isStatic, hasUFunction,
		blueprintExposable: /Blueprint(Callable|Pure|NativeEvent|ImplementableEvent)/.test(macroArgs),
		category: catMatch ? catMatch[1] : null,
		declStart,
	};
}

// ████████████████████████████████████████████████████████████████████████████
//  单文件解析
// ████████████████████████████████████████████████████████████████████████████

export interface ParsedDelegate {
	member: string;
	type: string;
}

export interface ParsedDelegateBinding {
	sourceFunction: string;
	ownerMember: string;
	ownerClass: string;
	delegateMember: string;
	operation: string;
	handler?: string;
}

export interface ParsedCppDeclaration {
	name: string;
	kind: "class" | "struct" | "enum";
	bases: string[];
	description: string;
	/** Reflected value types remain first-class graph nodes and also appear in the header-local helper zone. */
	reflection?: "USTRUCT" | "UENUM";
}

interface CppDeclarationCandidate extends ParsedCppDeclaration {
	start: number;
	bodyOpen: number;
	bodyClose: number;
	/** 文件级模板类型：不入目录，但其 body 仍参与嵌套过滤（防内部类型漏出为独立声明） */
	isTemplate?: boolean;
}

export interface ParsedClass {
	name: string;
	kind: "uclass" | "uactor" | "ucomponent" | "ustruct" | "uenum" | "uinterface";
	bases: string[];
	interfaces: string[];
	description: string;
	tags: string[];
	sourcePath: string;
	properties: ParsedProperty[];
	functions: ParsedFunction[];
	delegates: ParsedDelegate[];
	cppDeclarations: ParsedCppDeclaration[];
	/** 普通 C++ Spec 的原始声明种类。 */
	declarationKind?: "class" | "struct" | "enum";
}

/** 反射宏出现在 `#define` 行（含反斜杠续行）内时是宏定义本身而非使用点——
 *  ObjectMacros.h 定义 UCLASS/USTRUCT 等宏，误当使用点会向后抓错任意声明。 */
function isInsideMacroDefinition(stripped: string, index: number): boolean {
	let lineStart = stripped.lastIndexOf("\n", index - 1) + 1;
	for (let guard = 0; guard < 200; guard++) {
		if (/^\s*#\s*define\b/.test(stripped.slice(lineStart, Math.min(index, lineStart + 32)))) return true;
		if (lineStart === 0) return false;
		const prevEnd = lineStart - 1;
		const prevStart = stripped.lastIndexOf("\n", prevEnd - 1) + 1;
		// 上一行以反斜杠续行才继续向上追（本行仍属同一个 #define 体）
		if (!/\\\s*$/.test(stripped.slice(prevStart, prevEnd))) return false;
		lineStart = prevStart;
	}
	return false;
}

/** 反射宏与其声明必须近邻（UE 规范上是紧邻下一行）；超窗即为误关联。 */
const MACRO_DECL_WINDOW = 400;

/** 文件级模板类型不是本目录的 API 身份（T 前缀无图类型映射，过不了命名门禁）。 */
function isTemplatePrefixed(stripped: string, start: number): boolean {
	return /\btemplate\s*<[\s\S]{0,200}>\s*$/.test(stripped.slice(Math.max(0, start - 240), start));
}

function collectCppDeclarationCandidates(stripped: string, docs: DocBlock[]): CppDeclarationCandidate[] {
	const candidates: CppDeclarationCandidate[] = [];
	// UE 老式命名空间枚举 `namespace EDrawDebugTrace { enum Type {...} }`：类型身份是
	// 命名空间名（签名以 EDrawDebugTrace::Type 引用）。裸捕获 "Type" 会在众多头文件里
	// 产出同名节点，且过不了 E 前缀命名门禁——按需解析被拒，Spec 打开即空。
	const namespaceRanges: { name: string; start: number; open: number; close: number }[] = [];
	const nsRe = /\bnamespace\s+([A-Za-z_]\w*)\s*\{/g;
	let match: RegExpExecArray | null;
	while ((match = nsRe.exec(stripped)) !== null) {
		const open = nsRe.lastIndex - 1;
		const close = matchBracket(stripped, open);
		if (close === -1) continue;
		namespaceRanges.push({ name: match[1], start: match.index, open, close });
	}
	const enclosingNamespace = (index: number) => {
		let innermost: { name: string; start: number; open: number; close: number } | null = null;
		for (const range of namespaceRanges) {
			if (index > range.open && index < range.close && (!innermost || range.open > innermost.open)) innermost = range;
		}
		return innermost;
	};
	const classRe = /\b(class|struct)\s+(?:(?:\w+_API)\s+|(?:UE_DEPRECATED(?:_FORGAME)?\s*\([^)]{0,4096}\))\s+|(?:alignas\s*\([^)]{0,4096}\))\s+)*([A-Za-z_]\w*)\s*(?::\s*([^;{]{0,4096}))?\s*\{/g;
	while ((match = classRe.exec(stripped)) !== null) {
		// `enum class E {}` 中的 class 不是独立类型声明。
		if (/\benum\s+$/.test(stripped.slice(Math.max(0, match.index - 24), match.index))) continue;
		const bodyOpen = classRe.lastIndex - 1;
		const bodyClose = matchBracket(stripped, bodyOpen);
		if (bodyClose === -1) continue;
		const bases = match[3]
			? splitTopLevel(match[3]).map((base) => normalizeWs(base.replace(/\b(public|protected|private|virtual)\b/g, ""))).filter(Boolean)
			: [];
		candidates.push({
			name: match[2],
			kind: match[1] as "class" | "struct",
			bases,
			description: docBefore(docs, stripped, match.index),
			start: match.index,
			bodyOpen,
			bodyClose,
			// 文件级模板类型（TImpl/TIterator 等）不入目录：T 前缀无图类型映射，提升后只会
			// 成为空 Spec 节点；但仍占位参与嵌套过滤，防止其内部类型漏出为独立声明
			...(isTemplatePrefixed(stripped, match.index) ? { isTemplate: true } : {}),
		});
	}

	// UE_DEPRECATED(5.x, "...") 可出现在 enum 关键字与名字之间，不剥离会把宏名当枚举名
	const enumRe = /\benum\s+(?:class\s+)?(?:UE_DEPRECATED(?:_FORGAME)?\s*\([^)]{0,4096}\)\s*)?(?:(?:\w+_API)\s+)?([A-Za-z_]\w*)\s*(?::\s*([^;{]{0,4096}))?\s*\{/g;
	while ((match = enumRe.exec(stripped)) !== null) {
		const bodyOpen = enumRe.lastIndex - 1;
		const bodyClose = matchBracket(stripped, bodyOpen);
		if (bodyClose === -1) continue;
		let name = match[1];
		let description = docBefore(docs, stripped, match.index);
		if (name === "Type") {
			const ns = enclosingNamespace(match.index);
			// 无命名空间的裸 `enum Type` 不是可命名的 API 身份，丢弃（保留只会再生成空 Spec 节点）
			if (!ns) continue;
			name = ns.name;
			if (!description) description = docBefore(docs, stripped, ns.start);
		}
		candidates.push({
			name,
			kind: "enum",
			bases: [],
			description,
			start: match.index,
			bodyOpen,
			bodyClose,
		});
	}

	// 只保留文件/命名空间级类型；成员类与内联函数中的局部类型由其外层类型负责。
	const enclosingTypeRanges: { open: number; close: number }[] = [];
	const seen = new Set<string>();
	const declarations: CppDeclarationCandidate[] = [];
	for (const candidate of candidates.sort((a, b) => a.start - b.start || a.bodyOpen - b.bodyOpen)) {
		if (enclosingTypeRanges.some((range) => candidate.start > range.open && candidate.start < range.close)) continue;
		enclosingTypeRanges.push({ open: candidate.bodyOpen, close: candidate.bodyClose });
		if (candidate.isTemplate) continue; // 占位过滤嵌套后丢弃，不进目录
		const key = `${candidate.kind}:${candidate.name}`;
		if (seen.has(key)) continue;
		seen.add(key);
		declarations.push(candidate);
	}
	return declarations;
}

function extractCppDeclarations(
	stripped: string,
	docs: DocBlock[],
	reflectedNames: Set<string>,
): ParsedCppDeclaration[] {
	return collectCppDeclarationCandidates(stripped, docs)
		.filter((candidate) => !reflectedNames.has(candidate.name))
		.map(({ start: _start, bodyOpen: _bodyOpen, bodyClose: _bodyClose, ...declaration }) => declaration);
}

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

export interface ParseHeaderOptions {
	/** 将文件级非反射 class / struct / enum 也生成为可打开的完整 Spec 类型。 */
	includePlainCpp?: boolean;
}

function plainCppKind(declaration: ParsedCppDeclaration): ParsedClass["kind"] {
	return ueTypeFromCodeName(declaration.name, declaration.kind);
}

function parsePlainCppProperties(body: string, kind: ParsedCppDeclaration["kind"]): ParsedProperty[] {
	if (kind === "enum") {
		// UMETA(...) 是 UHT 元数据不属于值语义，先整体剥离（宏内逗号会干扰切分）。
		// 值表达式可含 `1 << 3`——splitTopLevel 会把 `<<` 当尖括号嵌套，故这里只认圆括号
		// 深度、按顶层逗号切分；type 字段承载显式初始值（无则空串）
		const cleaned = body.replace(/\bUMETA\s*\([^)]*\)/g, "");
		const entries: string[] = [];
		let depth = 0;
		let current = "";
		for (const ch of cleaned) {
			if (ch === "(") depth++;
			else if (ch === ")") depth = Math.max(0, depth - 1);
			if (ch === "," && depth === 0) {
				entries.push(current);
				current = "";
			} else {
				current += ch;
			}
		}
		if (current.trim()) entries.push(current);
		return entries
			.map((entry) => {
				const trimmed = entry.trim();
				const eq = trimmed.indexOf("=");
				return {
					name: (eq === -1 ? trimmed : trimmed.slice(0, eq)).trim(),
					value: eq === -1 ? "" : trimmed.slice(eq + 1).trim(),
				};
			})
			.filter(({ name }) => /^\w+$/.test(name))
			.map(({ name, value }) => ({ name, type: value, targetClass: null, relation: "composes" }));
	}
	const flatBody = flattenInlineBodies(body).replace(/\b(?:public|protected|private)\s*:/g, ";");
	const properties: ParsedProperty[] = [];
	for (const rawStatement of flatBody.split(";")) {
		const statement = rawStatement.trim();
		if (!statement || /[(){}#]/.test(statement)) continue;
		if (/^(?:using|typedef|friend|static_assert|template|class|struct|enum)\b/.test(statement)) continue;
		const property = parseProperty(statement);
		if (property && /^\w+$/.test(property.name)) properties.push(property);
	}
	return properties;
}

function parsePlainCppFunctions(
	body: string,
	typeName: string,
	bodyOffset: number,
	docs: DocBlock[],
	stripped: string,
): ParsedFunction[] {
	const normalizedBody = body.replace(
		/\b(?:public|protected|private)\s*:/g,
		(value) => ";" + " ".repeat(value.length - 1),
	);
	const flatBody = flattenInlineBodies(normalizedBody);
	const functions: ParsedFunction[] = [];
	const seen = new Set<string>();
	FUNC_DECL_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = FUNC_DECL_RE.exec(flatBody)) !== null) {
		const name = match[2];
		if (SKIP_FUNC_NAMES.has(name) || name === typeName || name.startsWith("~") || seen.has(name)) continue;
		const fn = buildFunction(match, false, "", bodyOffset + match.index);
		fn.description = docBefore(docs, stripped, fn.declStart);
		functions.push(fn);
		seen.add(name);
	}
	return functions;
}

/** 单头文件解析上限：超过即跳过该文件（畸形/超大输入不拖垮解析与事件循环）。 */
const MAX_HEADER_BYTES = 4 * 1024 * 1024;

export function parseHeader(filePath: string, sourceRoot: string, options: ParseHeaderOptions = {}): ParsedClass[] {
	if (!existsSync(filePath)) return [];
	const size = statSync(filePath).size;
	if (size > MAX_HEADER_BYTES) return [];
	const raw = readFileSync(filePath, "utf-8").replace(/^﻿/, "");
	const { stripped, docs } = stripCommentsPreserveLength(raw);
	const sourcePath = relative(sourceRoot, filePath).replaceAll("\\", "/");
	const results: ParsedClass[] = [];
	const reflectedNames = new Set<string>();

	// —— 文件内声明的委托类型。RetVal 系列的第一参数是返回值类型（经常是 bool），
	// 委托类型在第二参数；若一律取第一参数，会把所有同类型 UPROPERTY 误判为委托。 ——
	const declaredDelegates = new Set<string>();
	const delegateMacroRe = /\b(DECLARE_[A-Z0-9_]*DELEGATE\w*)\s*\(/g;
	let delegateMacro: RegExpExecArray | null;
	while ((delegateMacro = delegateMacroRe.exec(stripped)) !== null) {
		const close = matchBracket(stripped, delegateMacroRe.lastIndex - 1);
		if (close === -1) continue;
		const args = splitTopLevel(stripped.slice(delegateMacroRe.lastIndex, close)).map((arg) => arg.trim());
		const typeIndex = /DELEGATE_RetVal(?:_|$)/i.test(delegateMacro[1]) ? 1 : 0;
		if (/^\w+$/.test(args[typeIndex] ?? "")) declaredDelegates.add(args[typeIndex]);
		delegateMacroRe.lastIndex = close + 1;
	}
	for (const m of stripped.matchAll(/\bDECLARE_EVENT\w*\(\s*\w+\s*,\s*(\w+)/g)) {
		declaredDelegates.add(m[1]);
	}

	const typeMacroRe = /\b(UCLASS|USTRUCT|UINTERFACE)\s*\(/g;
	let mm: RegExpExecArray | null;
	while ((mm = typeMacroRe.exec(stripped)) !== null) {
		const macro = mm[1];
		// ObjectMacros.h 等处的 `#define UCLASS(...)` 是宏定义本身，不是类型使用点
		if (isInsideMacroDefinition(stripped, mm.index)) continue;
		const argsClose = matchBracket(stripped, typeMacroRe.lastIndex - 1);
		if (argsClose === -1) continue;
		const macroArgs = stripped.slice(typeMacroRe.lastIndex, argsClose);

		const declRe = /(class|struct)\s+(?:(?:\w+_API)\s+|(?:UE_DEPRECATED(?:_FORGAME)?\s*\([^)]{0,4096}\))\s+|(?:alignas\s*\([^)]{0,4096}\))\s+)*(\w+)\s*(?::\s*([^{]{0,4096}))?\{/g;
		declRe.lastIndex = argsClose + 1;
		const decl = declRe.exec(stripped);
		if (!decl) continue;
		// 声明必须近邻宏（越窗=误关联，曾把远处的 enum class 抓成 UCLASS 类）；
		// `enum class X {` 里的 class 也不是反射类声明
		if (decl.index - argsClose > MACRO_DECL_WINDOW) continue;
		if (/\benum\s+$/.test(stripped.slice(Math.max(0, decl.index - 24), decl.index))) continue;
		const name = decl[2];
		reflectedNames.add(name);
		if (macro === "UINTERFACE" && name.startsWith("U")) reflectedNames.add(`I${name.slice(1)}`);
		const baseList = decl[3]
			? splitTopLevel(decl[3]).map((b) => normalizeWs(b.replace(/\b(public|protected|private|virtual)\b/g, "")))
			: [];
		const bodyOpen = declRe.lastIndex - 1;
		const bodyClose = matchBracket(stripped, bodyOpen);
		if (bodyClose === -1) continue;
		// 访问标签等长替换为 ';'+空格：既当语句分隔符防止函数声明正则跨标签吞并，又保持索引对齐
		const body = stripped
			.slice(bodyOpen + 1, bodyClose)
			.replace(/\b(?:public|protected|private)\s*:/g, (m) => ";" + " ".repeat(m.length - 1));

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
			delegates: [],
			cppDeclarations: [],
		};

		// —— UPROPERTY ——
		const propRe = /\bUPROPERTY\s*\(/g;
		while (propRe.exec(body) !== null) {
			const close = matchBracket(body, propRe.lastIndex - 1);
			if (close === -1) continue;
			// 用状态机找声明结尾的顶层分号：跳过字符串字面量与括号/花括号深度，
			// 防止默认值里的分号（如 NSLOCTEXT("A","B","x; y")）被误当声明结尾。
			const semi = indexOfTopLevelSemicolon(body, close + 1);
			if (semi === -1) continue;
			const parsed = parseProperty(body.slice(close + 1, semi));
			if (parsed) {
				if (declaredDelegates.has(parsed.type)) {
					cls.delegates.push({ member: parsed.name, type: parsed.type });
				} else {
					cls.properties.push(parsed);
				}
			}
			propRe.lastIndex = semi + 1;
		}

		// —— UFUNCTION ——
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

		// —— 无宏普通函数声明（压平内联函数体后扫描） ——
		const flatBody = flattenInlineBodies(body);
		FUNC_DECL_RE.lastIndex = 0;
		let fd: RegExpExecArray | null;
		while ((fd = FUNC_DECL_RE.exec(flatBody)) !== null) {
			const fname = fd[2];
			if (SKIP_FUNC_NAMES.has(fname) || consumedNames.has(fname) || fname === name || fname.startsWith("~")) continue;
			const needle = fd[0].slice(0, -1).trimEnd();
			const origIdx = body.indexOf(needle);
			const declStart = origIdx === -1 ? 0 : bodyOpen + 1 + origIdx;
			cls.functions.push(buildFunction(fd, false, "", declStart));
			consumedNames.add(fname);
		}

		// —— 无 UPROPERTY 的裸委托成员（类型在本文件声明集内） ——
		if (declaredDelegates.size > 0) {
			// A delegate may be the first declaration after GENERATED_BODY(), where there is
			// no preceding semicolon. A line boundary is therefore also a valid field boundary.
			for (const dm of flatBody.matchAll(/(?:^|[;\n])\s*(F\w+)\s+(\w+)\s*;/g)) {
				if (declaredDelegates.has(dm[1]) && !cls.delegates.some((d) => d.member === dm[2])) {
					cls.delegates.push({ member: dm[2], type: dm[1] });
				}
			}
		}

		results.push(cls);
	}

	// —— UENUM ——
	const enumRe = /\bUENUM\s*\(([^)]*)\)/g;
	while ((mm = enumRe.exec(stripped)) !== null) {
		if (isInsideMacroDefinition(stripped, mm.index)) continue;
		// 老式反射枚举 `UENUM() namespace EXxx { enum Type {...} }`：类型身份是命名空间名
		// （签名以 EXxx::Type 引用）；裸 Type 过不了 E 前缀门禁，Spec 打开为空。
		// UE_DEPRECATED 可插在 enum 与名字之间，不剥离会把宏名当枚举名
		const em = /(?:namespace\s+(\w+)\s*\{\s*)?enum\s+(?:class\s+)?(?:UE_DEPRECATED(?:_FORGAME)?\s*\([^)]*\)\s*)?(\w+)/g;
		em.lastIndex = enumRe.lastIndex;
		const ed = em.exec(stripped);
		if (!ed) continue;
		if (ed.index - enumRe.lastIndex > MACRO_DECL_WINDOW) continue;
		const enumName = ed[2] === "Type" && ed[1] ? ed[1] : ed[2];
		reflectedNames.add(enumName);
		// 反射枚举的值成员：曾一直是空 properties，Spec 打开无内容且与类/struct 视觉语言
		// 不一致——解析枚举体为值列表（type 承载显式初始值），查看器渲染为枚举值节点
		let enumValues: ParsedProperty[] = [];
		const valuesOpen = stripped.indexOf("{", em.lastIndex);
		if (valuesOpen !== -1 && valuesOpen - em.lastIndex < 200) {
			const valuesClose = matchBracket(stripped, valuesOpen);
			if (valuesClose !== -1) enumValues = parsePlainCppProperties(stripped.slice(valuesOpen + 1, valuesClose), "enum");
		}
		results.push({
			name: enumName, kind: "uenum", bases: [], interfaces: [],
			description: docBefore(docs, stripped, mm.index),
			tags: [], sourcePath, properties: enumValues, functions: [], delegates: [], cppDeclarations: [],
		});
	}

	// —— UINTERFACE 的 I 契约类 ——
	const ifaceRe = /\bUINTERFACE\s*\([^)]*\)/g;
	while ((mm = ifaceRe.exec(stripped)) !== null) {
		if (isInsideMacroDefinition(stripped, mm.index)) continue;
		const um = /class\s+(?:\w+_API\s+)?U(\w+)/g;
		um.lastIndex = ifaceRe.lastIndex;
		const ud = um.exec(stripped);
		if (!ud) continue;
		if (ud.index - ifaceRe.lastIndex > MACRO_DECL_WINDOW) continue;
		const iName = `I${ud[1]}`;
		const contractRe = new RegExp(`class\\s+(?:\\w+_API\\s+)?${iName}\\s*(?::\\s*([^\\{]+))?\\{`, "g");
		contractRe.lastIndex = ud.index;
		const contract = contractRe.exec(stripped);
		if (contract) {
			const bodyOpen = contractRe.lastIndex - 1;
			const bodyClose = matchBracket(stripped, bodyOpen);
			const functions: ParsedFunction[] = [];
			if (bodyClose !== -1) {
				const contractBody = stripped
					.slice(bodyOpen + 1, bodyClose)
					.replace(/\b(?:public|protected|private)\s*:/g, (value) => ";" + " ".repeat(value.length - 1));
				const flatContractBody = flattenInlineBodies(contractBody);
				FUNC_DECL_RE.lastIndex = 0;
				let contractFn: RegExpExecArray | null;
				while ((contractFn = FUNC_DECL_RE.exec(flatContractBody)) !== null) {
					const name = contractFn[2];
					if (SKIP_FUNC_NAMES.has(name) || name === iName || name.startsWith("~")) continue;
					functions.push(buildFunction(contractFn, /\bUFUNCTION\s*\([^)]*\)\s*$/.test(flatContractBody.slice(0, contractFn.index)), "", bodyOpen + 1 + contractFn.index));
				}
			}
			results.push({
				name: iName, kind: "uinterface", bases: [], interfaces: [],
				description: docBefore(docs, stripped, mm.index),
				tags: [], sourcePath, properties: [], functions, delegates: [], cppDeclarations: [],
			});
		}
	}

	const cppDeclarations = extractCppDeclarations(stripped, docs, reflectedNames);
	const reflectedValueDeclarations = results.flatMap<ParsedCppDeclaration>((entry): ParsedCppDeclaration[] => {
		if (entry.kind === "ustruct") {
			return [{ name: entry.name, kind: "struct", bases: entry.bases, description: entry.description, reflection: "USTRUCT" }];
		}
		if (entry.kind === "uenum") {
			return [{ name: entry.name, kind: "enum", bases: [], description: entry.description, reflection: "UENUM" }];
		}
		return [];
	});
	// 「纯 C++ 辅助类型区」的归属：只有头文件的主类（UCLASS/UINTERFACE 族）展示同头文件
	// 辅助声明；值类型（ustruct/uenum）与提升的纯 C++ 类型不再携带兄弟声明——
	// 否则每个 F/E 辅助类型的 Spec 都会"残留"上一层头文件的全部同伴（用户报障）
	const OWNS_HEADER_HELPERS = new Set(["uclass", "uactor", "ucomponent", "uinterface"]);
	for (const cls of results) {
		cls.cppDeclarations = OWNS_HEADER_HELPERS.has(cls.kind) && !cls.tags.includes("cpp_only")
			? [
				...cppDeclarations,
				...reflectedValueDeclarations.filter((declaration) => declaration.name !== cls.name),
			]
			: [];
		for (const fn of cls.functions) {
			fn.description = docBefore(docs, stripped, fn.declStart);
		}
	}

	if (options.includePlainCpp) {
		const candidateByName = new Map(
			collectCppDeclarationCandidates(stripped, docs).map((candidate) => [candidate.name, candidate]),
		);
		for (const declaration of cppDeclarations) {
			const candidate = candidateByName.get(declaration.name);
			if (!candidate) continue;
			const body = stripped.slice(candidate.bodyOpen + 1, candidate.bodyClose);
			results.push({
				name: declaration.name,
				kind: plainCppKind(declaration),
				declarationKind: declaration.kind,
				bases: declaration.bases.filter((base) => !base.startsWith("I")),
				interfaces: declaration.bases.filter((base) => base.startsWith("I")),
				description: declaration.description,
				tags: ["cpp_only"],
				sourcePath,
				properties: parsePlainCppProperties(body, declaration.kind),
				// 枚举体没有函数；跑函数解析只会把 UMETA(...) 之类误认成声明
				functions: declaration.kind === "enum" ? [] : parsePlainCppFunctions(body, declaration.name, candidate.bodyOpen + 1, docs, stripped),
				delegates: [],
				// 辅助类型不携带同头文件兄弟声明（归属规则见上）；主类的辅助区仍可跳转到它们
				cppDeclarations: [],
			});
		}
	}
	return results;
}

// ████████████████████████████████████████████████████████████████████████████
//  .cpp 函数体解析：函数 → 使用了本类哪些持有成员（含构造函数）
// ████████████████████████████████████████████████████████████████████████████

export function parseCppMemberUsage(cppPath: string, cls: ParsedClass): Map<string, Set<string>> {
	const usage = new Map<string, Set<string>>();
	if (!existsSync(cppPath) || cls.properties.length === 0) return usage;
	const { stripped } = stripCommentsPreserveLength(readFileSync(cppPath, "utf-8").replace(/^﻿/, ""));

	const defRe = new RegExp(String.raw`\b${cls.name}\s*::\s*(\w+)\s*\(`, "g");
	let m: RegExpExecArray | null;
	while ((m = defRe.exec(stripped)) !== null) {
		const fnName = m[1];
		const parenClose = matchBracket(stripped, defRe.lastIndex - 1);
		if (parenClose === -1) continue;
		let i = parenClose + 1;
		while (i < stripped.length && stripped[i] !== "{" && stripped[i] !== ";") i++;
		if (stripped[i] !== "{") continue;
		const bodyClose = matchBracket(stripped, i);
		if (bodyClose === -1) continue;
		const body = stripped.slice(i + 1, bodyClose);
		defRe.lastIndex = bodyClose + 1;

		for (const p of cls.properties) {
			if (new RegExp(String.raw`\b${p.name}\b`).test(body)) {
				const set = usage.get(fnName) ?? new Set<string>();
				set.add(p.name);
				usage.set(fnName, set);
			}
		}
	}
	return usage;
}

/** Extracts subscriptions to delegates owned by held objects from AddX / BindX calls. */
export function parseCppDelegateBindings(cppPath: string, cls: ParsedClass): ParsedDelegateBinding[] {
	if (!existsSync(cppPath) || cls.properties.length === 0) return [];
	const { stripped } = stripCommentsPreserveLength(readFileSync(cppPath, "utf-8").replace(/^﻿/, ""));
	const propertyByName = new Map(cls.properties.filter((property) => property.targetClass).map((property) => [property.name, property]));
	const bindings: ParsedDelegateBinding[] = [];
	const seen = new Set<string>();
	const defRe = new RegExp(String.raw`\b${cls.name}\s*::\s*(\w+)\s*\(`, "g");
	let definition: RegExpExecArray | null;
	while ((definition = defRe.exec(stripped)) !== null) {
		const sourceFunction = definition[1];
		const parenClose = matchBracket(stripped, defRe.lastIndex - 1);
		if (parenClose === -1) continue;
		let cursor = parenClose + 1;
		while (cursor < stripped.length && stripped[cursor] !== "{" && stripped[cursor] !== ";") cursor++;
		if (stripped[cursor] !== "{") continue;
		const bodyClose = matchBracket(stripped, cursor);
		if (bodyClose === -1) continue;
		const body = stripped.slice(cursor + 1, bodyClose);
		defRe.lastIndex = bodyClose + 1;

		// Delegate APIs are extensible (for example AddUnique / BindUFunction), so retain the
		// semantic Add/Bind prefix instead of freezing a suffix allow-list to one UE release.
		const bindRe = /\b(\w+)\s*(?:->|\.)\s*(\w+)\s*\.\s*((?:Add|Bind)\w*)\s*\(([^;]*)\)/g;
		let binding: RegExpExecArray | null;
		while ((binding = bindRe.exec(body)) !== null) {
			const ownerMember = binding[1];
			const property = propertyByName.get(ownerMember);
			if (!property?.targetClass) continue;
			const handlerMatch = binding[4].match(/&\s*(?:\w+::)*(\w+)/);
			const item: ParsedDelegateBinding = {
				sourceFunction,
				ownerMember,
				ownerClass: property.targetClass,
				delegateMember: binding[2],
				operation: binding[3],
				...(handlerMatch ? { handler: handlerMatch[1] } : {}),
			};
			const key = `${item.sourceFunction}:${item.ownerMember}:${item.delegateMember}:${item.operation}:${item.handler ?? "lambda"}`;
			if (!seen.has(key)) {
				seen.add(key);
				bindings.push(item);
			}
		}
	}
	return bindings;
}
