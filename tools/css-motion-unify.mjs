// Graph Brain / tools - 动效 keyframes 归一 codemod(F41-B)
// 用法: node tools/css-motion-unify.mjs [--write]
// 把 12+ 个结构重复的「淡入位移」与「呼吸透明度」keyframes 收敛到 motion.css 标准库:
//   gb-enter-up/down/left/right/scale/fade(--enter-d/--enter-s 参数化)
//   gb-breathe(--breathe-min)、gb-pulse-ring(--pulse-color/--pulse-r)、gb-dash-flow(--dash-from/--dash-to)
// 步骤: 1) 改写全部 animation 用法名并就地补参数变量; 2) 断言零残留后删除旧定义;
//       3) 生成 viewer/styles/motion.css 标准库。复杂多属性帧(ambient/liquid 等)不动。

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSS_DIR = join(ROOT, "viewer", "styles");
const WRITE = process.argv.includes("--write");

// old -> { to: 标准名, vars: 追加到同一声明块的自定义属性 }
const MAP = {
	"view-in": { to: "gb-enter-up" },
	"view-reveal": { to: "gb-enter-up" },
	"stat-rise": { to: "gb-enter-up", vars: { "--enter-d": "5px" } },
	"list-item-in": { to: "gb-enter-up" },
	"foundry-stage-in": { to: "gb-enter-up", vars: { "--enter-d": "5px" } },
	"seg-in": { to: "gb-enter-up", vars: { "--enter-d": "3px" } },
	"copy-rise": { to: "gb-enter-up", vars: { "--enter-d": "10px" } },
	"panel-reveal": { to: "gb-enter-up", vars: { "--enter-d": "8px" } },
	"toast-in": { to: "gb-enter-up", vars: { "--enter-d": "8px" } },
	"delivery-area-enter": { to: "gb-enter-up", vars: { "--enter-d": "7px" } },
	"wa-fade-up": { to: "gb-enter-up", vars: { "--enter-d": "12px" } },
	"receipt-row-enter": { to: "gb-enter-left", vars: { "--enter-d": "5px" } },
	"panel-in": { to: "gb-enter-right", vars: { "--enter-d": "10px" } },
	"inspector-in": { to: "gb-enter-right", vars: { "--enter-d": "12px" } },
	"wa-slide-in-right": { to: "gb-enter-right", vars: { "--enter-d": "24px" } },
	"c3d-panel-in": { to: "gb-enter-down", vars: { "--enter-d": "4px" } },
	"fade-in": { to: "gb-enter-fade" },
	"shell-reveal": { to: "gb-enter-fade" },
	"wa-fade-scale": { to: "gb-enter-scale", vars: { "--enter-s": ".92" } },
	"atlasAppFadeIn": { to: "gb-enter-scale", vars: { "--enter-s": ".995" } },
	"dot-breathe": { to: "gb-breathe", vars: { "--breathe-min": ".6" } },
	"seg-warn-pulse": { to: "gb-breathe", vars: { "--breathe-min": ".55" } },
	"pulse-dot": { to: "gb-breathe", vars: { "--breathe-min": ".3" } },
	"wa-glow-breathe": { to: "gb-breathe", vars: { "--breathe-min": ".6" } },
	"wa-dash-flow": { to: "gb-dash-flow" },
	"neonDashFlow": { to: "gb-dash-flow", vars: { "--dash-to": "-20" } },
	"experienceFlowPulse": { to: "gb-dash-flow", vars: { "--dash-from": "28", "--dash-to": "0" } },
	"wa-pulse-ring": { to: "gb-pulse-ring" },
};

const files = readdirSync(CSS_DIR).filter((f) => f.endsWith(".css") && f !== "motion.css");
let totalUsages = 0, totalDefs = 0;
const report = [];

for (const file of files) {
	let src = readFileSync(join(CSS_DIR, file), "utf8");
	let changed = false;
	for (const [old, spec] of Object.entries(MAP)) {
		// animation  shorthand 或 animation-name 中的名字token(词边界), 逐处替换+补变量
		const usageRe = new RegExp(`(animation(?:-name)?\\s*:[^;}]*?)\\b${old}\\b([^;}]*);`, "g");
		src = src.replace(usageRe, (m, pre, post) => {
			// 防御: 若该行其实是 @keyframes 定义头(不含冒号结构)不会匹配; 多动画逗号串只改首个命中名
			const vars = spec.vars
				? Object.entries(spec.vars).map(([k, v]) => `${k}: ${v};`).join(" ")
				: "";
			changed = true;
			totalUsages++;
			return `${pre}${spec.to}${post};${vars ? ` ${vars}` : ""}`;
		});
	}
	if (!changed) continue;
	// 删除已收敛的 @keyframes 定义(要求定义计数与使用计数断言后清零)
	for (const old of Object.keys(MAP)) {
		const defRe = new RegExp(`@keyframes\\s+${old}\\s*\\{`);
		let m;
		while ((m = defRe.exec(src)) !== null) {
			// brace match
			let i = m.index + m[0].length, depth = 1;
			while (depth > 0 && i < src.length) {
				if (src[i] === "{") depth++;
				else if (src[i] === "}") depth--;
				i++;
			}
			// 确认删除后没有其它引用残留(在剩余文本里)
			const rest = src.slice(0, m.index) + src.slice(i);
			if (new RegExp(`\\b${old}\\b`).test(rest)) {
				report.push(`!! ${file}: ${old} 定义未删(仍有引用)`);
				break;
			}
			src = rest;
			totalDefs++;
			report.push(`✓ ${file}: 删除 @keyframes ${old}`);
		}
	}
	if (WRITE) writeFileSync(join(CSS_DIR, file), src, "utf8");
}

const motionCss = `/* Graph Brain / motion.css - 动效标准库(F41-B 收敛产物)
   时长/缓动令牌: --motion-* 与 --ease-*(design-tokens.ts 注入)。距离/强度参数:
   --enter-d(位移,默认6px)、--enter-s(缩放,默认.96)、--breathe-min(呼吸低谷,默认.55)、
   --pulse-color/--pulse-r(脉冲环)、--dash-from/--dash-to(虚线流动)。
   复杂编排(home-card/ambient/liquid 等页面级特效)保留在各自样式表, 不在本库。 */

@keyframes gb-enter-up    { from { opacity: 0; transform: translateY(var(--enter-d, 6px)); } to { opacity: 1; transform: none; } }
@keyframes gb-enter-down  { from { opacity: 0; transform: translateY(calc(var(--enter-d, 6px) * -1)); } to { opacity: 1; transform: none; } }
@keyframes gb-enter-left  { from { opacity: 0; transform: translateX(calc(var(--enter-d, 8px) * -1)); } to { opacity: 1; transform: none; } }
@keyframes gb-enter-right { from { opacity: 0; transform: translateX(var(--enter-d, 8px)); } to { opacity: 1; transform: none; } }
@keyframes gb-enter-scale { from { opacity: 0; transform: scale(var(--enter-s, .96)); } to { opacity: 1; transform: none; } }
@keyframes gb-enter-fade  { from { opacity: 0; } to { opacity: 1; } }

@keyframes gb-breathe { 0%, 100% { opacity: 1; } 50% { opacity: var(--breathe-min, .55); } }
@keyframes gb-pulse-ring {
	0% { box-shadow: 0 0 0 0 var(--pulse-color, color-mix(in srgb, var(--gb-cyan-75) 40%, transparent)); }
	70% { box-shadow: 0 0 0 var(--pulse-r, 8px) transparent; }
	100% { box-shadow: 0 0 0 0 transparent; }
}
@keyframes gb-dash-flow { from { stroke-dashoffset: var(--dash-from, 0); } to { stroke-dashoffset: var(--dash-to, -24); } }
@keyframes gb-spin { to { transform: rotate(360deg); } }

/* 编排: 列表/卡片级联入场。容器挂 .gb-stagger, 子项按 --stagger-step(默认 28ms) 递进。 */
.gb-stagger > * { animation: gb-enter-up var(--motion-base, 220ms) var(--ease-enter, cubic-bezier(.16,1,.3,1)) both; }
.gb-stagger > *:nth-child(1)  { animation-delay: 0ms; }
.gb-stagger > *:nth-child(2)  { animation-delay: calc(var(--stagger-step, 28ms) * 1); }
.gb-stagger > *:nth-child(3)  { animation-delay: calc(var(--stagger-step, 28ms) * 2); }
.gb-stagger > *:nth-child(4)  { animation-delay: calc(var(--stagger-step, 28ms) * 3); }
.gb-stagger > *:nth-child(5)  { animation-delay: calc(var(--stagger-step, 28ms) * 4); }
.gb-stagger > *:nth-child(6)  { animation-delay: calc(var(--stagger-step, 28ms) * 5); }
.gb-stagger > *:nth-child(7)  { animation-delay: calc(var(--stagger-step, 28ms) * 6); }
.gb-stagger > *:nth-child(8)  { animation-delay: calc(var(--stagger-step, 28ms) * 7); }
.gb-stagger > *:nth-child(n+9) { animation-delay: calc(var(--stagger-step, 28ms) * 8); }
`;

console.log(`模式: ${WRITE ? "写入" : "干跑"}; 改写用法 ${totalUsages} 处; 删除定义 ${totalDefs} 个`);
for (const line of report) console.log(" ", line);
if (WRITE) {
	writeFileSync(join(CSS_DIR, "motion.css"), motionCss, "utf8");
	console.log(`已生成 ${join(CSS_DIR, "motion.css")}`);
}
