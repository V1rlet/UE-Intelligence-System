// Graph Brain / viewer - 设计令牌单一事实源（工程宪法第 5/11 条）
//
// DECISION: 全查看器的语义颜色与动效令牌只在本文件声明一次。
//   - TS 侧（SVG data-URI 节点生成器、Cytoscape 动效帧、Canvas 绘制）直接 import 常量；
//   - CSS 侧通过本模块在应用启动时同步注入的 --gb-* / --motion-* / --ease-* 自定义属性消费，
//     CSS 文件不得再声明这些令牌的字面值。
// REASON: SVG data-URI 无法引用 CSS 变量，过去颜色在 designNode/bpNode/umlNode/ueSpecCard
//   等生成器里各自硬编码，同一语义存在多份漂移副本；动效时长也曾三分裂
//   （app --transition-* / experience --motion-* / wa-motion --wa-duration-*）。
//   收敛到一个 TS 模块 + 启动注入后，任一令牌只有一处可改。
// DATE: 2026-07-28

import { MOTION } from "./motion";
import { GB_PALETTE } from "./design-tokens-palette";

// F41-A：CSS 全量色彩令牌(109 个 --gb-*)由 palette.generated.css 静态承载并最先加载;
// GB_PALETTE 是其 TS 侧镜像，供 TS 消费者、代码绘制与测试断言同源取用。
export { GB_PALETTE };

/* ---------------------------------- 间距刻度 ---------------------------------- */
/**
 * 间距令牌（progress.md #1085）：--sp-1..8 阶梯，统一 8/10/12/16/20px 与
 * 4/6/8/10/12px 的 padding/gap/margin 漂移。CSS 消费 var(--sp-N)；
 * 不属于刻度的细节值（1-3px 分隔线、奇数调整值）保留字面量。
 */
export const SPACING = {
	1: "4px",
	2: "6px",
	3: "8px",
	4: "10px",
	5: "12px",
	6: "16px",
	7: "20px",
	8: "24px",
} as const;

/* ---------------------------------- 动效时长 ---------------------------------- */
/** 规范时长阶梯（ms）。motion.ts 的 MOTION 是 JS 侧别名来源，二者必须保持一致。 */
export const MOTION_SCALE = {
	instant: MOTION.instant, // 110 — 微交互/按下反馈
	fast: MOTION.popover, // 160 — 浮层/hover
	base: MOTION.view, // 220 — 视图与面板进入
	camera: MOTION.camera, // 300 — 相机/聚焦移动
	slow: MOTION.slow, // 380 — 大型面板/抽屉
	hero: MOTION.hero, // 560 — 首屏级编排上限
} as const;

/** 缓动曲线（以 motion.ts MOTION 为源，别名对齐 CSS 语义命名）。 */
export const EASING = {
	enter: MOTION.enter, // cubic-bezier(.16,1,.3,1)
	move: MOTION.spatial, // cubic-bezier(.2,0,0,1)
	exit: MOTION.exit, // cubic-bezier(.4,0,1,1)
	spring: MOTION.spring, // cubic-bezier(.34,1.56,.64,1)
	smooth: MOTION.smooth, // cubic-bezier(.25,.1,.25,1)
} as const;

/* ---------------------------------- 语义颜色 ---------------------------------- */
/** 品牌/信号色 */
export const SIGNAL = {
	amber: "#e3a44c", // 聚焦脉冲、当前态刻痕
	amberSoft: "#f0bd61", // emit 关系信号
	optional: "#ffd35a", // OPTIONAL 角标
} as const;

/** SVG 节点内的文字与底色（无法走 CSS 变量的 data-URI 场景） */
export const SVG_INK = {
	title: "#f7f9fd",
	body: "#b9c5d8",
	muted: "#8fa2b5",
	faint: "#6b7c8c",
	dark: "#0a0f14", // 引脚描边等深线
	bpBody: "#131920", // 蓝图节点体
	bpEdge: "#05070b",
	bpTitle: "#f2f5f8",
	cardBg: "#161e28", // 规范卡片底
	cardItemBox: "#0f151c",
	cardItemBorder: "#3a4a5a",
	cardItem: "#c9d4de",
	cardZoneBand: "#2a3844",
	specPanelBg: "#101521", // SpecView 画布底
} as const;

/** 关系动效六族信号色（relationPresentation） */
export const RELATION_COLORS = {
	emit: SIGNAL.amberSoft,
	hold: "#79b3dc",
	flow: "#72d9e5",
	wire: "#ae9ade",
	type: "#7bc59f",
	related: "#9eb7bd",
} as const;

/** 图例回退色（未登记域缺样式时的最后兜底） */
export const LEGEND_FALLBACK = { node: "#7f8c8d", edge: "#5d6d7c" } as const;

/** 设计域工具主色（domainCatalog 与设计节点共用，禁止再各自写字面值） */
/** UE 蓝图节点标题渐变（bpNode），映射 UE 蓝图语义色 */
export const BP_KIND_STYLE: Record<string, { top: string; bottom: string; icon: string }> = {
	event: { top: "#8e2b2b", bottom: "#5d1d1c", icon: "▶" },
	function: { top: "#2d5f93", bottom: "#1d3f63", icon: "ƒ" },
	object: { top: "#33688f", bottom: "#224664", icon: "●" },
	asset: { top: "#2c7a6b", bottom: "#1c5348", icon: "◈" },
	interface: { top: "#3f7d8c", bottom: "#29545f", icon: "◇" },
	delegate: { top: "#93314e", bottom: "#642036", icon: "▣" },
	class: { top: "#4a5666", bottom: "#323b48", icon: "◻" },
	// UE 蓝图 Byte/Enum 引脚为绿色系——枚举值节点沿用该语义
	enum: { top: "#3f7d3f", bottom: "#2a542a", icon: "≔" },
	hub: { top: "#a06a1e", bottom: "#6b4711", icon: "❖" },
};

/** 蓝图数据引脚颜色（与标题语义同族；委托为方形引脚） */
export const BP_PIN_COLOR: Record<string, string> = {
	object: "#4aa3e8",
	asset: "#35b8a5",
	interface: "#58c7d8",
	delegate: "#e0566e",
	enum: "#6fbf5f",
};

/** 蓝图 BP 徽章色 */
export const BP_BADGE = { fill: "#6bb1e0", text: "#a8d4f0" } as const;

/** UML 分栏节点色板（umlNode） */
export const UML_KIND_COLORS: Record<string, { bg: string; border: string; text: string }> = {
	class: { bg: "#1e3a5f", border: "#4a90d9", text: "#c2d8f0" },
	struct: { bg: "#1a3d37", border: "#3cb4a4", text: "#b8e4dc" },
	interface: { bg: "#2d2245", border: "#9b72cf", text: "#d4c4ec" },
	external: { bg: "#252730", border: "#6b7280", text: "#b0b5c3" },
	flow: { bg: "#1c2d4a", border: "#5b8def", text: "#c2d8f0" },
};

/** 规范卡片专用色（ueSpecCard；border 沿用品牌琥珀族） */
export const SPEC_CARD_COLORS = {
	bg: SVG_INK.cardBg,
	border: "#e8834a",
	title: "#f0d9c8",
	zoneLabel: SVG_INK.faint,
	zoneBand: SVG_INK.cardZoneBand,
	item: SVG_INK.cardItem,
	itemBox: SVG_INK.cardItemBox,
	itemBorder: SVG_INK.cardItemBorder,
	bp: BP_BADGE.fill,
} as const;

/* ---------------------------------- 语义别名层 ---------------------------------- */
/**
 * CSS 语义别名（--accent、--bg-*、--text-*、--border-*、--font-*、--radius-*、
 * --shadow-*、--z-*、--space-*、--transition-*）的单一事实源。
 *
 * 历史：app/workflow/comfort/readability 四套 CSS 各自声明 :root，readability 最后
 * 加载把品牌琥珀 --accent 静默换成 violet（Iris Fog 换色误伤）。现统一由本模块注入，
 * 值 = 重构前各层最后加载生效值快照（workflow 主主题 + comfort 舒适修正），视觉不变；
 * readability 的颜色覆盖废弃，只保留其字号/域色/尺寸职责。
 *
 * 尺寸令牌（--rail-size/--topbar-size/--status-size）例外：它们在 media 断点与
 * readability 层被反复覆盖，若随本表注入会杀死响应式级联，故保留在 CSS。
 */
const SEMANTIC_TOKENS: Record<string, string> = {
	"--bg-base": "var(--gb-violet-20)",
	"--bg-surface": "var(--gb-violet-20)",
	"--bg-raised": "var(--gb-violet-25)",
	"--bg-overlay": "var(--gb-violet-30)",
	"--bg-input": "var(--gb-neutral-15)",
	"--bg-canvas": "var(--gb-violet-20)",
	"--border-subtle": "var(--gb-violet-30)",
	"--border-default": "var(--gb-violet-35)",
	"--border-strong": "var(--gb-violet-50)",
	"--border-accent": "var(--gb-amber-75)",
	"--accent": "var(--gb-amber-75)",
	"--accent-dim": "var(--gb-amber-45)",
	"--accent-soft": "color-mix(in srgb, var(--gb-amber-75) 12%, transparent)",
	"--cyan": "var(--gb-cyan-80)",
	"--cyan-bright": "var(--gb-cyan-90b)",
	"--cyan-soft": "color-mix(in srgb, var(--gb-cyan-75) 12%, transparent)",
	"--violet": "var(--gb-violet-75b)",
	"--violet-soft": "color-mix(in srgb, var(--gb-violet-70b) 12%, transparent)",
	"--text-primary": "var(--gb-neutral-95)",
	"--text-secondary": "var(--gb-violet-80b)",
	"--text-tertiary": "var(--gb-violet-75c)",
	"--text-muted": "var(--gb-violet-60)",
	"--text-accent": "var(--gb-cyan-75)",
	"--text-gold": "var(--gb-amber-75)",
	"--text-green": "var(--gb-green-75)",
	"--text-red": "var(--gb-ember-70)",
	"--font-display": "\"Segoe UI Variable Display\", \"Bahnschrift\", \"Microsoft YaHei UI\", sans-serif",
	"--font-body": "\"Segoe UI Variable Text\", \"Segoe UI\", \"Microsoft YaHei UI\", sans-serif",
	"--font-ui": "var(--font-body)",
	"--font-mono": "\"Cascadia Mono\", \"Cascadia Code\", Consolas, monospace",
	"--radius-sm": "6px",
	"--radius-md": "10px",
	"--radius-lg": "16px",
	"--radius-xl": "22px",
	"--hairline": "inset 0 1px 0 color-mix(in srgb, var(--gb-white) 4%, transparent)",
	"--shadow-panel": "0 12px 34px color-mix(in srgb, var(--gb-blue-10) 20%, transparent), inset 0 1px color-mix(in srgb, var(--gb-white) 3.5%, transparent)",
	"--shadow-float": "0 18px 54px color-mix(in srgb, var(--gb-blue-10) 42%, transparent), inset 0 1px color-mix(in srgb, var(--gb-white) 4.5%, transparent)",
	"--shadow-glow": "0 0 0 1px color-mix(in srgb, var(--gb-cyan-75) 10%, transparent), 0 18px 55px color-mix(in srgb, #0c4e5e 15%, transparent)",
	"--shadow-dropdown": "inset 0 1px 0 color-mix(in srgb, var(--gb-white) 4%, transparent), 0 14px 38px color-mix(in srgb, var(--gb-black) 45%, transparent), 0 0 0 1px var(--border-default)",
	"--shadow-modal": "inset 0 1px 0 color-mix(in srgb, var(--gb-white) 4%, transparent), 0 22px 56px color-mix(in srgb, var(--gb-black) 50%, transparent), 0 0 0 1px var(--border-strong)",
	"--z-dropdown": "1000",
	"--z-overlay": "2000",
	"--z-modal": "2100",
	"--z-palette": "2200",
	"--z-notice": "2300",
	"--z-confirm": "2400",
	"--z-toast": "2500",
	"--space-1": "4px",
	"--space-2": "8px",
	"--space-3": "12px",
	"--space-4": "16px",
	"--space-6": "24px",
	"--space-8": "32px",
	"--transition-fast": "var(--motion-instant) ease",
	"--transition-base": "var(--motion-fast) ease",
};

/* ---------------------------------- CSS 注入 ---------------------------------- */
/**
 * 把令牌注入文档头一个 <style id="gb-design-tokens">（:root 规则）。
 * 模块加载即同步执行（main.tsx / embed.tsx 最先 import），首次渲染前 var(--motion-*) /
 * var(--ease-*) / 语义别名已可解析。
 *
 * 用 <style> 而非内联 style：内联特异性最高，会杀死 media 断点与 @media print 内的
 * :root 覆盖；<style> 参与级联，后加载的覆盖仍生效。
 */
export function installDesignTokens(root: HTMLElement = document.documentElement): void {
	const declarations = new Map<string, string>();
	for (const [name, ms] of Object.entries(MOTION_SCALE)) declarations.set(`--motion-${name}`, `${ms}ms`);
	for (const [name, curve] of Object.entries(EASING)) declarations.set(`--ease-${name}`, curve);
	for (const [step, px] of Object.entries(SPACING)) declarations.set(`--sp-${step}`, px);
	declarations.set("--gb-signal-amber", SIGNAL.amber);
	declarations.set("--gb-signal-amber-soft", SIGNAL.amberSoft);
	for (const [name, value] of Object.entries(SEMANTIC_TOKENS)) declarations.set(name, value);
	const doc = root.ownerDocument;
	if (!doc) return;
	let styleEl = doc.getElementById("gb-design-tokens") as HTMLStyleElement | null;
	if (!styleEl) {
		styleEl = doc.createElement("style");
		styleEl.id = "gb-design-tokens";
		doc.head.prepend(styleEl);
	}
	styleEl.textContent = `:root{\n${[...declarations].map(([name, value]) => `\t${name}:${value};`).join("\n")}\n}`;
}

if (typeof document !== "undefined") installDesignTokens();
