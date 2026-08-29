// Graph Brain / 分层门禁：core 不得 import ue5-code adapter 的具体实现。
//
// 拦截目标 = core → ue5-code adapter 实现。放行项只有稳定契约、diff 基础设施、
// capability registry，以及一切 type-only 导入（编译期擦除，不构成运行时依赖）。
//
// DECISION: 识别引擎用 TypeScript AST，不再用正则
// REASON: 正则版存在已实证的假通过形态——副作用导入与 adapters 导入连写时
//         懒匹配吞掉后者的头部被整段跳过；字符串字面量里的 "//" 被当注释剥掉；
//         反引号动态 import() 不命中。门禁的假通过比无门禁更危险。
// DATE: 2026-08-23
//
// 用法: npx tsx scripts/layer-gate.ts   （无违规 exit 0，有违规输出清单 exit 1）
// 供测试直接调用的核心函数为 auditFiles(files)。

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

export interface LayerViolation {
	file: string;
	line: number;
	specifier: string;
	reason: string;
}

/** core 可依赖的稳定 adapter 边界；必须是仓库内精确路径，同名文件不构成能力声明。 */
export const ALLOWED_ADAPTER_BOUNDARIES = new Set([
	"adapters/adapter-interface.js",
	"adapters/diff-lib.js",
	"adapters/registry.js",
]);

/** 命名导入绑定是否全部为 type（`{ type A }` / `{ type A, type B }`） */
function namedBindingsAllTypeOnly(bindings: ts.NamedImports): boolean {
	return bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
}

/** 审计一组 .ts 文件：返回所有分层违例（type-only 与白名单模块除外）。
 *  文件不可读直接抛错——门禁对 IO 失败必须 fail closed，静默跳过等于假通过。 */
export function auditFiles(files: string[], repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")): LayerViolation[] {
	const violations: LayerViolation[] = [];
	const recordIfViolation = (file: string, specifier: string, line: number) => {
		if (!specifier.includes("adapters/")) return;
		const resolvedBoundary = specifier.startsWith(".")
			? relative(repoRoot, resolve(dirname(file), specifier)).split(sep).join("/")
			: specifier.replace(/\\/g, "/");
		if (ALLOWED_ADAPTER_BOUNDARIES.has(resolvedBoundary)) return;
		violations.push({ file, line, specifier, reason: `core 不得 import adapters 具体域实现（白名单外）` });
	};

	for (const file of files) {
		let source: string;
		try {
			source = readFileSync(file, "utf-8");
		} catch (error) {
			throw new Error(`分层门禁无法读取文件（fail closed）: ${file}: ${(error as Error).message}`);
		}
		const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
		const visit = (node: ts.Node): void => {
			if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
				const clause = node.importClause;
				// import "side-effect"（无子句）是运行时依赖；import type / 全 type 命名绑定是编译期擦除
				const typeOnly = clause?.isTypeOnly
					|| (clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings) && namedBindingsAllTypeOnly(clause.namedBindings) && clause.name === undefined);
				if (!typeOnly) recordIfViolation(file, node.moduleSpecifier.text, sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
			} else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
				if (!node.isTypeOnly) recordIfViolation(file, node.moduleSpecifier.text, sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
			} else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length > 0) {
				const argument = node.arguments[0];
				// 动态 import 的静态文本参数（普通字符串或无插值模板串）可判定；
				// 带插值/变量依赖不可静态分析，交由 AST-any 门禁。
				if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
					recordIfViolation(file, argument.text, sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
				}
			}
			node.forEachChild(visit);
		};
		sourceFile.forEachChild(visit);
	}
	return violations;
}

function collectTsFiles(root: string): string[] {
	const files: string[] = [];
	const stack = [root];
	while (stack.length > 0) {
		const dir = stack.pop()!;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) stack.push(full);
			else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(full);
		}
	}
	return files;
}

function main(): void {
	const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const coreDir = join(repoRoot, "core");
	if (!existsSync(coreDir)) {
		console.error(`分层门禁：core/ 不存在（${coreDir}）`);
		process.exit(2);
	}
	const files = collectTsFiles(coreDir);
	let violations: LayerViolation[];
	try {
		violations = auditFiles(files, repoRoot);
	} catch (error) {
		console.error(`分层门禁失败（审计中断）：${(error as Error).message}`);
		process.exit(1);
	}
	if (violations.length > 0) {
		console.error(`分层门禁失败：core 不得 import adapters 具体域实现（${violations.length} 处违规）`);
		for (const v of violations) {
			console.error(`  ${v.file}:${v.line}  ←  ${v.specifier}  ${v.reason}`);
		}
		process.exit(1);
	}
	console.log(`分层门禁通过：${files.length} 个 core 文件无 adapters 实现层导入（精确边界：${[...ALLOWED_ADAPTER_BOUNDARIES].join("、")}）`);
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main();
