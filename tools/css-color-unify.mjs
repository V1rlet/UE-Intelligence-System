// Graph Brain / tools - CSS 色彩归一执行器(F41-A)
// 用法:
//   node tools/css-color-unify.mjs            干跑(dry-run), 只打印计划与覆盖率
//   node tools/css-color-unify.mjs --write    执行替换并生成 viewer/src/design-tokens-palette.ts
//   node tools/css-color-unify.mjs --check    校验模式: 发现令牌外硬编码颜色即 exit 1(残留门禁)
//
// 机制(与 css-color-audit.mjs 同一套聚类):
//   1. 扫描 viewer/styles/*.css 全部 hex/rgb(a) 字面量 → OKLCH 聚类(ΔE≤0.035 视觉无差)
//   2. 出现≥3次的簇成为设计令牌 --gb-<family>-<lightness>; 其余成员值对齐到簇种子(去漂移)
//   3. 替换: 实心色 → var(--gb-*); 带alpha → color-mix(in srgb, var(--gb-*) α%, transparent)
//      (color-mix 需 Chrome 111+, 本工具面向本机现代 Chrome, 与 smoke 链路一致)
//   4. 保护: 注释、url(...)内容、字符串字面量不触碰
// 令牌单一事实源仍是 design-tokens.ts —— palette 文件由本脚本生成, 头部注明勿手改。

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSS_DIR = join(ROOT, "viewer", "styles");
const PALETTE_OUT = join(ROOT, "viewer", "src", "design-tokens-palette.ts");
const PALETTE_CSS_OUT = join(ROOT, "viewer", "styles", "palette.generated.css");
const MODE = process.argv.includes("--write") ? "write" : process.argv.includes("--check") ? "check" : "dry";
const MIN_CLUSTER_USES = 3;

/* ---------------- 颜色解析/色彩空间(与 audit 一致) ---------------- */
function parseHex(hex) {
	let h = hex.slice(1);
	if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
	const int = parseInt(h.slice(0, 6), 16);
	const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
	return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255, a };
}
function parseRgb(str) {
	const m = str.match(/rgba?\(([^)]*)\)/);
	if (!m) return null;
	const parts = m[1].split(/[\s,/]+/).filter(Boolean);
	if (parts.length < 3) return null;
	const chan = (p) => p.endsWith("%") ? Math.round(parseFloat(p) * 2.55) : parseFloat(p);
	const alpha = (p) => p === undefined ? 1 : p.endsWith("%") ? parseFloat(p) / 100 : parseFloat(p);
	return { r: chan(parts[0]), g: chan(parts[1]), b: chan(parts[2]), a: alpha(parts[3]) };
}
function srgbToLinear(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function rgbToOklch({ r, g, b }) {
	const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
	const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
	const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
	const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
	const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
	const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
	const A = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
	const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
	const C = Math.sqrt(A * A + B * B);
	let H = Math.atan2(B, A) * 180 / Math.PI;
	if (H < 0) H += 360;
	return { L, C, H };
}
function oklchDist(a, b) {
	const dL = a.L - b.L;
	const h1 = a.H * Math.PI / 180, h2 = b.H * Math.PI / 180;
	return Math.sqrt(dL * dL + (a.C * Math.cos(h1) - b.C * Math.cos(h2)) ** 2 + (a.C * Math.sin(h1) - b.C * Math.sin(h2)) ** 2);
}
const hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/* ---------------- 扫描(记录每个文件的内容, 以便重写) ---------------- */
// 生成出来的令牌定义本身必须保留颜色字面量；把它再次计入输入会抬高使用次数，
// 让检查器误判普通样式中的一次性颜色，还会在 --write 时生成自引用变量。
const files = readdirSync(CSS_DIR).filter((f) => f.endsWith(".css") && f !== "palette.generated.css");
const occurrences = [];
for (const file of files) {
	const text = readFileSync(join(CSS_DIR, file), "utf8");
	for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
		const p = parseHex(m[0]);
		if (p.a > 0) occurrences.push({ file, literal: m[0].toLowerCase(), ...p });
	}
	for (const m of text.matchAll(/rgba?\([^)]*\)/g)) {
		const p = parseRgb(m[0]);
		if (p && p.a > 0) occurrences.push({ file, literal: m[0], ...p });
	}
}

/* ---------------- 聚类 ---------------- */
const byRgb = new Map();
for (const o of occurrences) {
	const key = `${o.r},${o.g},${o.b}`;
	let e = byRgb.get(key);
	if (!e) { e = { r: o.r, g: o.g, b: o.b, count: 0 }; byRgb.set(key, e); }
	e.count++;
}
const colors = [...byRgb.values()].map((e) => ({ ...e, oklch: rgbToOklch(e) }));
const THRESHOLD = 0.035;
colors.sort((a, b) => b.count - a.count);
const clusters = [];
for (const c of colors) {
	let best = null, bestD = Infinity;
	for (const cl of clusters) {
		const d = oklchDist(c.oklch, cl.seed.oklch);
		if (d < bestD) { bestD = d; best = cl; }
	}
	if (best && bestD <= THRESHOLD) { best.members.push(c); best.total += c.count; }
	else clusters.push({ seed: c, members: [c], total: c.count });
}
clusters.sort((a, b) => b.total - a.total);

/* ---------------- 命名 ---------------- */
function familyOf({ C, H }) {
	if (C <= 0.018) return "neutral";
	if (H < 20 || H >= 340) return "red";
	if (H < 55) return "ember";
	if (H < 95) return "amber";
	if (H < 140) return "lime";
	if (H < 175) return "green";
	if (H < 230) return "cyan";
	if (H < 260) return "blue";
	if (H < 320) return "violet";
	return "magenta";
}
const usedNames = new Set();
function nameCluster(cl) {
	const s = cl.seed;
	const { L, C } = s.oklch;
	if (L >= 0.985 && C <= 0.02) return "white";
	if (L <= 0.015 && C <= 0.02) return "black";
	const fam = familyOf(s.oklch);
	const step = Math.max(5, Math.round(L * 100 / 5) * 5);
	let name = `${fam}-${step}`;
	let i = 1;
	while (usedNames.has(name)) name = `${fam}-${step}${String.fromCharCode(96 + ++i)}`;
	usedNames.add(name);
	return name;
}

/* rgb key -> {token|null, seedHex} 映射 */
const rgbToToken = new Map();
const tokenDefs = new Map(); // name -> seedHex
for (const cl of clusters) {
	const seedHex = hex(cl.seed.r, cl.seed.g, cl.seed.b);
	const token = cl.total >= MIN_CLUSTER_USES ? nameCluster(cl) : null;
	if (token) tokenDefs.set(token, seedHex);
	for (const m of cl.members) rgbToToken.set(`${m.r},${m.g},${m.b}`, { token, seedHex });
}

/* ---------------- 保护分段 + 替换 ---------------- */
function replaceInCode(code, replacer) {
	return code
		.replace(/#[0-9a-fA-F]{3,8}\b/g, (lit) => replacer(lit.toLowerCase(), parseHex(lit)))
		.replace(/rgba?\([^)]*\)/g, (lit) => {
			const p = parseRgb(lit);
			return p ? replacer(lit, p) : lit;
		});
}
function makeReplacer(stats) {
	return (literal, p) => {
		if (p.a === 0) return literal;
		const entry = rgbToToken.get(`${p.r},${p.g},${p.b}`);
		if (!entry) { stats.missed++; return literal; }
		const { token, seedHex } = entry;
		if (p.a >= 1) {
			stats.hits++;
			return token ? `var(--gb-${token})` : seedHex;
		}
		const pct = Math.round(p.a * 10000) / 100;
		stats.hits++;
		const base = token ? `var(--gb-${token})` : seedHex;
		return `color-mix(in srgb, ${base} ${pct}%, transparent)`;
	};
}
function transformSource(text, stats) {
	// 分段: 注释 / url(...) / 字符串 原样保留, 其余做替换
	const pattern = /(\/\*[\s\S]*?\*\/)|(url\("[^"]*"\)|url\('[^']*'\)|url\([^)"']*\))|("[^"]*"|'[^']*')/g;
	let out = "", last = 0;
	for (const m of text.matchAll(pattern)) {
		out += replaceInCode(text.slice(last, m.index), makeReplacer(stats));
		out += m[0];
		last = m.index + m[0].length;
	}
	out += replaceInCode(text.slice(last), makeReplacer(stats));
	return out;
}

/* ---------------- check 模式: 只报告令牌外硬编码 ---------------- */
if (MODE === "check") {
	// check 只统计「应该被令牌化却仍裸露」的出现(出现≥3次的簇成员)
	let bare = 0;
	const details = [];
	for (const o of occurrences) {
		const entry = rgbToToken.get(`${o.r},${o.g},${o.b}`);
		if (entry?.token) { bare++; if (details.length < 20) details.push(`${o.file}: ${o.literal}`); }
	}
	if (bare > 0) {
		console.log(`[color-check] 发现 ${bare} 处应走令牌的颜色字面量:`);
		for (const d of details) console.log(`  ${d}`);
		process.exit(1);
	}
	console.log(`[color-check] 通过: 无令牌级颜色硬编码(扫描 ${occurrences.length} 处)`);
	process.exit(0);
}

/* ---------------- dry / write ---------------- */
const stats = { hits: 0, missed: 0 };
const outputs = new Map();
for (const file of files) {
	const src = readFileSync(join(CSS_DIR, file), "utf8");
	outputs.set(file, transformSource(src, stats));
}

const covered = clusters.filter((cl) => cl.total >= MIN_CLUSTER_USES).reduce((n, cl) => n + cl.total, 0);
console.log(`模式: ${MODE === "write" ? "写入" : "干跑"}`);
console.log(`令牌数: ${tokenDefs.size} (覆盖 ${covered}/${occurrences.length} = ${Math.round(covered / occurrences.length * 100)}% 颜色出现)`);
console.log(`替换点: ${stats.hits}, 未命中: ${stats.missed}`);
console.log(`\n== 令牌表(按使用量) ==`);
const tokenList = [...tokenDefs.entries()];
const clusterByToken = clusters.filter((cl) => cl.total >= MIN_CLUSTER_USES).map((cl, i) => ({ cl, name: tokenList[i]?.[0] }));
// 直接按簇顺序对齐打印
let idx = 0;
for (const cl of clusters) {
	if (cl.total < MIN_CLUSTER_USES) continue;
	const name = tokenList[idx]?.[0] ?? "?";
	const s = cl.seed;
	console.log(`--gb-${name}: ${hex(s.r, s.g, s.b)};  ×${cl.total} (漂移成员 ${cl.members.length})`);
	idx++;
}

if (MODE === "write") {
	for (const [file, content] of outputs) writeFileSync(join(CSS_DIR, file), content, "utf8");
	// 生成 palette TS
	const lines = [
		`// GENERATED by tools/css-color-unify.mjs — 请勿手改; 改色请改设计意图后重跑 unify`,
		`// F41-A: viewer/styles 全部 CSS 颜色的单一事实源(簇种子值, OKLCH ΔE≤0.035 去漂移)`,
		`export const GB_PALETTE = {`,
	];
	let j = 0;
	for (const cl of clusters) {
		if (cl.total < MIN_CLUSTER_USES) continue;
		const name = tokenList[j]?.[0];
		lines.push(`\t"${name}": "${hex(cl.seed.r, cl.seed.g, cl.seed.b)}",`);
		j++;
	}
	lines.push(`} as const;`, ``, `export type GbPaletteToken = keyof typeof GB_PALETTE;`, ``);
	writeFileSync(PALETTE_OUT, lines.join("\n"), "utf8");
	// 静态 CSS 层: 首导入即生效, 不依赖 JS 运行时注入(消除 FOUC 与注入时序风险)
	const cssLines = [
		`/* GENERATED by tools/css-color-unify.mjs — 请勿手改; 改色请改设计意图后重跑 unify */`,
		`/* F41-A: 全部 --gb-* 色彩令牌的静态定义层。TS 侧镜像在 viewer/src/design-tokens-palette.ts */`,
		`:root {`,
	];
	j = 0;
	for (const cl of clusters) {
		if (cl.total < MIN_CLUSTER_USES) continue;
		const name = tokenList[j]?.[0];
		cssLines.push(`\t--gb-${name}: ${hex(cl.seed.r, cl.seed.g, cl.seed.b)};`);
		j++;
	}
	cssLines.push(`}`, ``);
	writeFileSync(PALETTE_CSS_OUT, cssLines.join("\n"), "utf8");
	console.log(`\n已写入 ${files.length} 个 CSS 文件 + ${PALETTE_OUT} + ${PALETTE_CSS_OUT}`);
}
