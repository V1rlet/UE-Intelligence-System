// 全仓引用图分析：文件级孤儿检测 + 符号级未引用导出 + 动态/字符串引用甄别
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve("G:/UnrealProject/GraphBrain");

function walk(dir: string): string[] {
	if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? walk(join(dir, e.name)) : join(dir, e.name));
}

const SRC_DIRS = ["core", "server", "adapters", "tools", "scripts", "viewer"];
const rootFiles = ["vite.config.ts"].filter((f) => statSync(join(ROOT, f), { throwIfNoEntry: false }));
const files = [...SRC_DIRS.flatMap((d) => walk(join(ROOT, d))), ...rootFiles]
	.filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("dist") && !f.endsWith(".d.ts"));
const tests = walk(join(ROOT, "tests")).filter((f) => /\.test\.ts$/.test(f));
const allFiles = [...files, ...tests];

// 解析 import 语句的模块路径（tsx ESM 用 .js 后缀导入 .ts 文件，需映射回真实文件）
function resolveImportTarget(spec: string, file: string): string | null {
	if (!spec.startsWith(".")) return null;
	const base = resolve(dirname(file), spec);
	const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, join(base, "index.ts"), join(base, "index.tsx"), join(base, "index.js")];
	for (const c of candidates) {
		const resolved = c.replace(/\.js$/, ".ts").replace(/\.jsx$/, ".tsx");
		if (allFiles.includes(resolved)) return resolved;
	}
	return null;
}

function importTargets(src: string, file: string): string[] {
	const targets: string[] = [];
	const re = /(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(src)) !== null) {
		const hit = resolveImportTarget(m[1], file);
		if (hit) targets.push(hit);
	}
	// 动态 import()（viewer 懒加载主通道、测试动态导入）
	const dynRe = /import\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
	while ((m = dynRe.exec(src)) !== null) {
		const hit = resolveImportTarget(m[1], file);
		if (hit) targets.push(hit);
	}
	return [...new Set(targets)];
}

// 符号级：从 import { a, b } 与 import type { a } 提取导入名
function importedNames(src: string): Set<string> {
	const names = new Set<string>();
	const re = /import\s+(?:type\s+)?\{([^}]+)\}\s*from/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(src)) !== null) {
		for (const part of m[1].split(",")) {
			const name = part.trim().split(/\s+as\s+/).pop()?.trim();
			if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
		}
	}
	// 动态 import 后的命名访问：const { a, b } = await import(...)
	const dynRe = /(?:const|let)\s*\{([^}]+)\}\s*=\s*await\s+import\(/g;
	while ((m = dynRe.exec(src)) !== null) {
		for (const part of m[1].split(",")) {
			const name = part.trim().split(/\s+as\s+/).pop()?.trim();
			if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
		}
	}
	return names;
}

function exportedNames(src: string): Set<string> {
	const names = new Set<string>();
	const re = /export\s+(?:declare\s+|abstract\s+|async\s+)?(?:const|function|class|interface|type|enum|let|var)\s+([A-Za-z_$][\w$]*)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(src)) !== null) names.add(m[1]);
	for (const m2 of src.matchAll(/export\s*\{([^}]+)\}/g)) {
		for (const part of m2[1].split(",")) {
			const name = part.trim().split(/\s+as\s+/)[0]?.trim();
			if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
		}
	}
	return names;
}

// 文件 → 被 import 的文件（含类型引用）与导入名
const refs = new Map<string, { targets: string[]; names: Set<string> }>();
for (const f of allFiles) {
	const src = readFileSync(f, "utf8");
	refs.set(f, { targets: importTargets(src, f), names: importedNames(src) });
}

// 反向引用：文件 → 引用它的文件（仅同仓 .ts/.tsx，忽略 .d.ts）
const rev = new Map<string, string[]>();
for (const [f, info] of refs) {
	for (const t of info.targets) {
		if (!rev.has(t)) rev.set(t, []);
		rev.get(t)!.push(f);
	}
}

// 入口/特殊文件：不作为孤儿判定
const ENTRY_PATTERN = /(vite\.config|service-launcher|release-server|install-service|(^|[\\/])(main|embed)\.tsx?$|bootstrap-recovery)/;
const CLI_PATTERN = /(tools[\\/]|scripts[\\/]|core[\\/]hooks[\\/](scan-stale|lore-watcher|post-commit-update|install-git-hook)|core[\\/]annotation[\\/]scan-stale|adapters[\\/]ue5-code[\\/](extract-classes|epic-api-sync))/;

console.log("=== 文件级孤儿（无任何同仓 import 引用，且非入口/CLI main）===");
const orphans: string[] = [];
for (const f of files) {
	if (ENTRY_PATTERN.test(f) || CLI_PATTERN.test(f)) continue;
	const isCliMain = (() => {
		const src = readFileSync(f, "utf8");
		return src.includes("process.argv[1]") || src.includes("import.meta.url)") && src.includes("isMain") || /if\s*\(\s*process\.argv\[1\]/.test(src);
	})();
	if (isCliMain) continue;
	const referrers = rev.get(f) ?? [];
	const testRefs = referrers.filter((r) => r.includes("test"));
	const codeRefs = referrers.filter((r) => !r.includes("test"));
	if (codeRefs.length === 0) orphans.push(`${relative(ROOT, f).replaceAll("\\", "/")} (测试引用 ${testRefs.length} 处${testRefs.length ? ":" + testRefs.map((r) => relative(ROOT, r).replaceAll("\\", "/")).join(",") : ""})`);
}
console.log(orphans.join("\n") || "(无)");

console.log("\n=== 符号级：导出但全仓（含测试）无 import 引用 ===");
for (const f of files) {
	const src = readFileSync(f, "utf8");
	const exports = exportedNames(src);
	if (exports.size === 0) continue;
	const used = new Set<string>();
	for (const [rf, info] of refs) {
		if (rf === f) continue;
		for (const n of info.names) used.add(n);
	}
	// 同文件内部使用（非导出声明处）
	for (const n of exports) {
		const count = (src.match(new RegExp(`\\b${n}\\b`, "g")) ?? []).length;
		if (count > 1) used.add(n);
	}
	const unused = [...exports].filter((n) => !used.has(n));
	if (unused.length > 0) console.log(`${relative(ROOT, f).replaceAll("\\", "/")}: ${unused.join(", ")}`);
}
