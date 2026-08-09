// Graph Brain / 分层门禁：core 不得 import ue5-code adapter 的具体实现。
//
// 拦截目标 = core → ue5-code adapter 实现。放行项只有稳定契约、diff 基础设施、
// capability registry，以及一切 type-only 导入（编译期擦除，不构成运行时依赖）。
//
// 用法: npx tsx scripts/layer-gate.ts   （无违规 exit 0，有违规输出清单 exit 1）
// 供测试直接调用的核心函数为 auditFiles(files)。

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface LayerViolation {
	file: string;
	line: number;
	specifier: string;
	reason: string;
}

/** core 可依赖的稳定 adapter 边界，按 basename 放行。 */
export const ALLOWED_ADAPTER_MODULES = new Set([
	"adapter-interface.js",
	"diff-lib.js",
	"registry.js",
]);

/** 去掉注释但保持行数不变，保证违规行号与源文件一致 */
function stripComments(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
		.replace(/\/\/[^\n]*/g, (match) => match.replace(/[^\n]/g, " "));
}

/** 命名导入子句是否全部为 type 绑定（如 `{ type GraphFile }`） */
function namedClauseIsTypeOnly(clause: string): boolean {
	const items = clause
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
	return items.length > 0 && items.every((item) => /^type\s/.test(item));
}

/** `import` 与 `from` 之间的头部是否纯类型（`import type ...` 或全 type 绑定） */
function isTypeOnlyImport(head: string): boolean {
	const trimmed = head.trim();
	if (/^type\b/.test(trimmed)) return true;
	const named = trimmed.match(/^\{(.*)\}$/s);
	if (named) return namedClauseIsTypeOnly(named[1]);
	// 默认导入 / 命名空间导入（`import X from` / `import * as X from`）视为运行时依赖
	return false;
}

/** 审计一组 .ts 文件：返回所有分层违例（type-only 与白名单模块除外） */
export function auditFiles(files: string[]): LayerViolation[] {
	const violations: LayerViolation[] = [];
	// 同时覆盖 `import ... from` 与 `export ... from` 两种依赖形态；[\s\S]*? 容忍跨行导入
	const IMPORT_RE = /\b(import|export)\s+([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g;
	// 无 from 子句的两种运行时依赖形态：动态 import("…") 与副作用 import "…"
	// （二者都没有 type 变体；负向前瞻 (?!\() 避免与动态形态重复匹配）
	const DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
	const SIDE_EFFECT_RE = /\bimport\s+(?!\()['"]([^'"]+)['"]/g;
	for (const file of files) {
		let source: string;
		try {
			source = readFileSync(file, "utf-8");
		} catch {
			continue;
		}
		const content = stripComments(source);
		const recordIfViolation = (specifier: string, index: number) => {
			if (!specifier.includes("adapters/")) return;
			const base = basenameOf(specifier);
			if (ALLOWED_ADAPTER_MODULES.has(base)) return;
			violations.push({
				file,
				line: content.slice(0, index).split("\n").length,
				specifier,
				reason: `core 不得 import adapters 具体域实现（白名单外）`,
			});
		};
		let match: RegExpExecArray | null;
		IMPORT_RE.lastIndex = 0;
		while ((match = IMPORT_RE.exec(content)) !== null) {
			const specifier = match[3];
			const head = match[2];
			// head 含字符串字面量 = 副作用导入行被 [\s\S]*? 吞入（如 `import "x"; import { y } from "z"`），
			// 该头部不是合法 import-from 头，跳过；跨行命名导入（`import {\n x\n} from`）无引号不受影响
			if (/["']/.test(head)) continue;
			if (isTypeOnlyImport(head)) continue;
			recordIfViolation(specifier, match.index);
		}
		for (const re of [DYNAMIC_RE, SIDE_EFFECT_RE]) {
			re.lastIndex = 0;
			while ((match = re.exec(content)) !== null) {
				recordIfViolation(match[1], match.index);
			}
		}
	}
	return violations;
}

function basenameOf(specifier: string): string {
	return specifier.split("/").pop() ?? specifier;
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
	const violations = auditFiles(files);
	if (violations.length > 0) {
		console.error(`分层门禁失败：core 不得 import adapters 具体域实现（${violations.length} 处违规）`);
		for (const v of violations) {
			console.error(`  ${v.file}:${v.line}  ←  ${v.specifier}  ${v.reason}`);
		}
		process.exit(1);
	}
	console.log(`分层门禁通过：${files.length} 个 core 文件无 adapters 实现层导入（放行白名单：${[...ALLOWED_ADAPTER_MODULES].join("、")}）`);
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main();
