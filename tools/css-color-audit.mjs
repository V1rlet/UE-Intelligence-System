// Graph Brain / tools - CSS 颜色审计与聚类（F41-A 色彩归一的分析引擎）
// 用法: node tools/css-color-audit.mjs [--json]
// 产出: 全部 hex/rgb(a) 字面量的 OKLCH 聚类报告, 供令牌归一决策。
// 不写任何文件——纯只读分析。

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSS_DIR = join(ROOT, "viewer", "styles");

/* ---------------- 颜色解析 ---------------- */
function parseHex(hex) {
	let h = hex.slice(1);
	if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
	const hasAlpha = h.length === 8;
	const int = parseInt(h.slice(0, 6), 16);
	const a = hasAlpha ? parseInt(h.slice(6, 8), 16) / 255 : 1;
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

/* ---------------- sRGB -> OKLCH ---------------- */
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
	const c1 = a.C * Math.cos(h1), s1 = a.C * Math.sin(h1);
	const c2 = b.C * Math.cos(h2), s2 = b.C * Math.sin(h2);
	return Math.sqrt(dL * dL + (c1 - c2) ** 2 + (s1 - s2) ** 2);
}

/* ---------------- 扫描 ---------------- */
const files = readdirSync(CSS_DIR).filter((f) => f.endsWith(".css"));
const occurrences = []; // {file,line,literal,r,g,b,a}
for (const file of files) {
	const lines = readFileSync(join(CSS_DIR, file), "utf8").split("\n");
	lines.forEach((text, i) => {
		// 跳过自定义属性定义行里的值? 不——变量定义也要归一(它们往往是第二份事实)
		const hexes = text.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
		for (const h of hexes) occurrences.push({ file, line: i + 1, literal: h.toLowerCase(), ...parseHex(h) });
		const rgbas = text.match(/rgba?\([^)]*\)/g) ?? [];
		for (const s of rgbas) {
			const p = parseRgb(s);
			if (p) occurrences.push({ file, line: i + 1, literal: s, ...p });
		}
	});
}

/* ---------------- 聚类(含透明度分桶) ---------------- */
// 先按 (r,g,b) 精确归并, 再按 OKLCH 距离聚类; alpha 单独记录(聚类键不含 alpha,
// 因为 rgba 常用于同一色相的不同透明层级, 归一目标是 (rgb) 颜色本身)。
const byRgb = new Map(); // key -> {r,g,b,count,alphas:Map,files:Set,lines:[]}
for (const o of occurrences) {
	if (o.a === 0) continue; // 全透明无视觉意义
	const key = `${o.r},${o.g},${o.b}`;
	let e = byRgb.get(key);
	if (!e) { e = { r: o.r, g: o.g, b: o.b, count: 0, alphas: new Map(), files: new Set(), samples: [] }; byRgb.set(key, e); }
	e.count++;
	e.alphas.set(o.a, (e.alphas.get(o.a) ?? 0) + 1);
	e.files.add(o.file);
	if (e.samples.length < 3) e.samples.push(`${o.file}:${o.line}`);
}
const colors = [...byRgb.values()].map((e) => ({ ...e, oklch: rgbToOklch(e) }));

// 贪心凝聚聚类: 按使用频次降序播种, 阈值内归入最近簇
const THRESHOLD = 0.035; // OKLCH 近似 ΔE, 视觉几乎不可分辨
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

const hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/* ---------------- 报告 ---------------- */
console.log(`CSS 文件: ${files.length} 个; 颜色出现 ${occurrences.length} 次; 唯一 RGB ${colors.length} 个; 聚类 ${clusters.length} 簇 (阈值 ${THRESHOLD})`);
console.log(`\n== 使用最多的 40 簇 ==`);
for (const cl of clusters.slice(0, 40)) {
	const s = cl.seed;
	const { L, C, H } = s.oklch;
	const alphas = [...s.alphas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a, n]) => `α${a}×${n}`).join(" ");
	console.log(
		`${hex(s.r, s.g, s.b)}  ×${String(cl.total).padStart(4)}  成员${String(cl.members.length).padStart(2)}  ` +
		`L${L.toFixed(2)} C${C.toFixed(2)} H${Math.round(H).toString().padStart(3)}  ${alphas}  [${[...s.files].join(",")}]`
	);
	if (cl.members.length > 1) {
		const drift = cl.members.slice(1, 6).map((m) => hex(m.r, m.g, m.b)).join(" ");
		console.log(`    漂移副本: ${drift}${cl.members.length > 6 ? ` …共${cl.members.length}个` : ""}`);
	}
}
const driftTotal = clusters.reduce((n, cl) => n + cl.members.length - 1, 0);
console.log(`\n可归并的漂移副本总数: ${driftTotal} / ${colors.length} 唯一值`);
console.log(`出现≥3次的颜色: ${colors.filter((c) => c.count >= 3).length} 个; 仅出现1次: ${colors.filter((c) => c.count === 1).length} 个`);
