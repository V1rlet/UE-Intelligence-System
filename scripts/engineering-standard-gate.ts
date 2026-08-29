// GraphBrain / 工程编码标准门禁。
// 规则正文：docs/engineering-standard-v1.md
// 集中例外：config/engineering-standard-exceptions.json

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

export const ENGINEERING_STANDARD_FORMAT_VERSION = 1;
export const MACHINE_RULES = new Set(["TYPE-001", "TYPE-002"] as const);

export type MachineRule = "TYPE-001" | "TYPE-002";

export interface EngineeringViolation {
	rule: MachineRule;
	file: string;
	line: number;
	kind: "explicit-any" | "typescript-suppression";
	message: string;
}

export interface EngineeringException {
	id: string;
	rule: MachineRule;
	path: string;
	line: number;
	owner: string;
	reason: string;
	tracking_issue: string;
	approved_on: string;
	expires_on: string;
}

export interface ExceptionRegistry {
	format_version: number;
	exceptions: EngineeringException[];
}

export interface GateResult {
	violations: EngineeringViolation[];
	unsuppressed: EngineeringViolation[];
	registryErrors: string[];
}

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SOURCE_ROOTS = ["adapters", "core", "scripts", "server", "tests", "tools", "viewer"];
const ROOT_SOURCE_FILES = ["coverage-scan.ts", "vite.config.ts"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SUPPRESSION_RE = /@ts-(?:ignore|nocheck|expect-error)\b/g;

function normalizedRelative(repoRoot: string, file: string): string {
	return relative(repoRoot, resolve(file)).split(sep).join("/");
}

function lineAt(source: string, index: number): number {
	return source.slice(0, index).split("\n").length;
}

function scriptKind(file: string): ts.ScriptKind {
	switch (extname(file).toLowerCase()) {
		case ".tsx": return ts.ScriptKind.TSX;
		case ".jsx": return ts.ScriptKind.JSX;
		case ".js":
		case ".mjs":
		case ".cjs": return ts.ScriptKind.JS;
		default: return ts.ScriptKind.TS;
	}
}

export function auditEngineeringFiles(files: string[], repoRoot: string): EngineeringViolation[] {
	const violations: EngineeringViolation[] = [];
	for (const file of files) {
		let source: string;
		try {
			source = readFileSync(file, "utf8");
		} catch (error) {
			// 门禁对 IO 失败必须 fail closed：静默跳过会让"读不到的文件"永远零违规（假通过）。
			throw new Error(`工程标准门禁无法读取文件（fail closed）: ${file}: ${(error as Error).message}`);
		}
		const relativeFile = normalizedRelative(repoRoot, file);
		const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
		const visit = (node: ts.Node): void => {
			if (node.kind === ts.SyntaxKind.AnyKeyword) {
				const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
				violations.push({
					rule: "TYPE-001",
					file: relativeFile,
					line: position.line + 1,
					kind: "explicit-any",
					message: "显式 any 必须改为 unknown + 边界缩窄，或登记限时例外",
				});
			}
			ts.forEachChild(node, visit);
		};
		visit(sourceFile);

		SUPPRESSION_RE.lastIndex = 0;
		let suppression: RegExpExecArray | null;
		while ((suppression = SUPPRESSION_RE.exec(source)) !== null) {
			violations.push({
				rule: "TYPE-002",
				file: relativeFile,
				line: lineAt(source, suppression.index),
				kind: "typescript-suppression",
				message: `${suppression[0]} 必须移除，或登记限时例外`,
			});
		}
	}
	return violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
}

function validDate(value: string): boolean {
	if (!DATE_RE.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function exceptionKey(value: Pick<EngineeringException, "rule" | "path" | "line">): string {
	return `${value.rule}\0${value.path}\0${value.line}`;
}

export function validateExceptionRegistry(registry: unknown, repoRoot: string, today: string): { registry: ExceptionRegistry | null; errors: string[] } {
	const errors: string[] = [];
	if (!registry || typeof registry !== "object" || Array.isArray(registry)) return { registry: null, errors: ["例外登记必须是 JSON object"] };
	const candidate = registry as Partial<ExceptionRegistry>;
	if (candidate.format_version !== ENGINEERING_STANDARD_FORMAT_VERSION) errors.push(`例外登记 format_version 必须为 ${ENGINEERING_STANDARD_FORMAT_VERSION}`);
	if (!Array.isArray(candidate.exceptions)) return { registry: null, errors: [...errors, "例外登记 exceptions 必须是数组"] };

	const ids = new Set<string>();
	const keys = new Set<string>();
	const parsed: EngineeringException[] = [];
	for (const [index, raw] of candidate.exceptions.entries()) {
		const label = `exceptions[${index}]`;
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			errors.push(`${label} 必须是 object`);
			continue;
		}
		const item = raw as Partial<EngineeringException>;
		for (const field of ["id", "rule", "path", "owner", "reason", "tracking_issue", "approved_on", "expires_on"] as const) {
			if (typeof item[field] !== "string" || !item[field]!.trim()) errors.push(`${label}.${field} 必须是非空字符串`);
		}
		if (!Number.isInteger(item.line) || Number(item.line) < 1) errors.push(`${label}.line 必须是正整数`);
		if (typeof item.rule === "string" && !MACHINE_RULES.has(item.rule as MachineRule)) errors.push(`${label}.rule 不是可豁免的机器规则：${item.rule}`);
		if (typeof item.id === "string") {
			if (ids.has(item.id)) errors.push(`${label}.id 重复：${item.id}`);
			ids.add(item.id);
		}
		if (typeof item.path === "string") {
			const normalized = item.path.replace(/\\/g, "/");
			if (isAbsolute(item.path) || normalized.split("/").includes("..") || normalized.startsWith("/")) errors.push(`${label}.path 必须是仓库内相对路径`);
			else if (!existsSync(resolve(repoRoot, normalized))) errors.push(`${label}.path 不存在：${normalized}`);
			if (item.path !== normalized) errors.push(`${label}.path 必须使用 /：${item.path}`);
		}
		if (typeof item.approved_on === "string" && !validDate(item.approved_on)) errors.push(`${label}.approved_on 必须是有效 YYYY-MM-DD`);
		if (typeof item.expires_on === "string") {
			if (!validDate(item.expires_on)) errors.push(`${label}.expires_on 必须是有效 YYYY-MM-DD`);
			else if (item.expires_on < today) errors.push(`${label} 已过期：${item.expires_on}`);
		}
		if (typeof item.approved_on === "string" && typeof item.expires_on === "string" && validDate(item.approved_on) && validDate(item.expires_on) && item.approved_on > item.expires_on) errors.push(`${label} 批准日期晚于到期日`);
		if (typeof item.reason === "string" && item.reason.trim().length < 12) errors.push(`${label}.reason 必须具体说明阻塞（至少 12 个字符）`);
		if (typeof item.tracking_issue === "string" && item.tracking_issue.trim().length < 4) errors.push(`${label}.tracking_issue 必须可追踪`);

		if (typeof item.rule === "string" && typeof item.path === "string" && Number.isInteger(item.line)) {
			const key = exceptionKey({ rule: item.rule as MachineRule, path: item.path.replace(/\\/g, "/"), line: Number(item.line) });
			if (keys.has(key)) errors.push(`${label} 与另一条例外重复命中：${item.rule} ${item.path}:${item.line}`);
			keys.add(key);
		}
		parsed.push(item as EngineeringException);
	}
	return { registry: { format_version: ENGINEERING_STANDARD_FORMAT_VERSION, exceptions: parsed }, errors };
}

export function reconcileExceptions(violations: EngineeringViolation[], registry: ExceptionRegistry): { unsuppressed: EngineeringViolation[]; errors: string[] } {
	const violationsByKey = new Map(violations.map((violation) => [exceptionKey({ rule: violation.rule, path: violation.file, line: violation.line }), violation]));
	const exceptionKeys = new Set(registry.exceptions.map(exceptionKey));
	const errors: string[] = [];
	for (const exception of registry.exceptions) {
		if (!violationsByKey.has(exceptionKey(exception))) errors.push(`陈旧例外 ${exception.id} 没有对应违规：${exception.rule} ${exception.path}:${exception.line}`);
	}
	return { unsuppressed: violations.filter((violation) => !exceptionKeys.has(exceptionKey({ rule: violation.rule, path: violation.file, line: violation.line }))), errors };
}

export function collectEngineeringFiles(repoRoot: string): string[] {
	const files: string[] = [];
	for (const rootName of SOURCE_ROOTS) {
		const root = resolve(repoRoot, rootName);
		if (!existsSync(root)) continue;
		const stack = [root];
		while (stack.length > 0) {
			const directory = stack.pop()!;
			for (const entry of readdirSync(directory, { withFileTypes: true })) {
				const full = resolve(directory, entry.name);
				if (entry.isDirectory()) stack.push(full);
				else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) files.push(full);
			}
		}
	}
	for (const name of ROOT_SOURCE_FILES) {
		const file = resolve(repoRoot, name);
		if (existsSync(file)) files.push(file);
	}
	return files.sort();
}

export function runEngineeringStandardGate(repoRoot: string, today: string): GateResult {
	const declarationErrors: string[] = [];
	const standardPath = resolve(repoRoot, "docs/engineering-standard-v1.md");
	const agentsPath = resolve(repoRoot, "AGENTS.md");
	const registryPath = resolve(repoRoot, "config/engineering-standard-exceptions.json");
	if (!existsSync(standardPath) || !readFileSync(standardPath, "utf8").includes("- `format_version`: 1")) declarationErrors.push("工程标准文档缺失或未声明 format_version 1");
	if (!existsSync(agentsPath) || !readFileSync(agentsPath, "utf8").includes("docs/engineering-standard-v1.md")) declarationErrors.push("AGENTS.md 未声明当前工程标准入口");

	let rawRegistry: unknown;
	try {
		rawRegistry = JSON.parse(readFileSync(registryPath, "utf8")) as unknown;
	} catch (error) {
		return { violations: [], unsuppressed: [], registryErrors: [...declarationErrors, `例外登记无法读取：${String(error)}`] };
	}
	const validated = validateExceptionRegistry(rawRegistry, repoRoot, today);
	const violations = auditEngineeringFiles(collectEngineeringFiles(repoRoot), repoRoot);
	if (!validated.registry) return { violations, unsuppressed: violations, registryErrors: [...declarationErrors, ...validated.errors] };
	const reconciled = reconcileExceptions(violations, validated.registry);
	return { violations, unsuppressed: reconciled.unsuppressed, registryErrors: [...declarationErrors, ...validated.errors, ...reconciled.errors] };
}

function main(): void {
	const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const today = new Date().toISOString().slice(0, 10);
	const result = runEngineeringStandardGate(repoRoot, today);
	if (result.registryErrors.length > 0 || result.unsuppressed.length > 0) {
		console.error(`工程标准门禁失败：${result.unsuppressed.length} 个未豁免违规，${result.registryErrors.length} 个例外/声明错误`);
		for (const error of result.registryErrors) console.error(`  [registry] ${error}`);
		for (const violation of result.unsuppressed) console.error(`  [${violation.rule}] ${violation.file}:${violation.line} ${violation.message}`);
		process.exit(1);
	}
	console.log(`工程标准门禁通过：${collectEngineeringFiles(repoRoot).length} 个源码文件，${result.violations.length} 个已登记例外，规范 v${ENGINEERING_STANDARD_FORMAT_VERSION}`);
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main();

