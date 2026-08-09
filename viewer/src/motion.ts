// Graph Brain / viewer - 动效共享工具：系统"减少动画"偏好探测 + 时长门控
//
// DECISION: 所有 Cytoscape 侧动效（视口动画/入场编排/聚焦脉冲/样式过渡）统一走本模块门控，
//           CSS 侧动效则由 app.css 末尾的 prefers-reduced-motion 全局规则归零。
// REASON: 动效是状态变化的物理反馈而非装饰，但无障碍偏好必须一票否决；
//         分散在各组件的 matchMedia 探测（F6 起）收拢到一处，避免遗漏。
// DATE: 2026-07-11

import type cytoscape from "cytoscape";

const reducedMotionQuery =
	typeof window !== "undefined" && window.matchMedia
		? window.matchMedia("(prefers-reduced-motion: reduce)")
		: null;

// ES module 的 live binding 让 Cytoscape 与后续交互在系统偏好改变后立即读取新值。
export let REDUCED_MOTION = reducedMotionQuery?.matches ?? false;

reducedMotionQuery?.addEventListener?.("change", (event) => {
	REDUCED_MOTION = event.matches;
});

export const MOTION = {
	instant: 110,
	popover: 160,
	view: 220,
	camera: 300,
	slow: 380,
	hero: 560,
	enter: "cubic-bezier(.16, 1, .3, 1)",
	spatial: "cubic-bezier(.2, 0, 0, 1)",
	exit: "cubic-bezier(.4, 0, 1, 1)",
	spring: "cubic-bezier(.34, 1.56, .64, 1)",
	smooth: "cubic-bezier(.25, .1, .25, 1)",
} as const;

/**
 * 退出动画周期 ms —— 与 CSS `--motion-fast`（design-tokens.ts 注入，同源于 MOTION.popover）
 * 严格一致的 JS 侧值。退出动画库（.gb-exiting / gb-exit-*，motion.css）时长即此值；
 * 组件卸载延迟（useExitGate / ContextMenu / ConfirmDialog / Toast EXIT_MS）一律引用本常量，
 * 禁止在各组件内硬编码 160——改时长只改这一处。
 */
export const EXIT_MS = MOTION.popover;

/** 聚焦脉冲的琥珀信号色（design-tokens 注入为 --gb-signal-amber，此处是 TS 侧唯一值） */
export const PULSE_COLOR = "#e3a44c";

/** 视口/样式动画时长门控：偏好减少动画时归零（Cytoscape duration 0 = 瞬时跳转） */
export const ANIM = (ms: number) => (REDUCED_MOTION ? 0 : ms);

/** 聚焦"锁定"脉冲：琥珀 overlay 闪烁一次。
 *  用 overlay 而非描边——不与 dimmed/highlighted 类样式及规范卡片的 inline 样式冲突 */
export function pulseNode(node: cytoscape.NodeSingular) {
	if (REDUCED_MOTION) return;
	node.animate(
		{ style: { "overlay-color": PULSE_COLOR, "overlay-opacity": 0.25 } },
		{
			duration: 160,
			easing: "ease-out",
			complete: () =>
				node.animate(
					{ style: { "overlay-opacity": 0 } },
					{
						duration: 340,
						easing: "ease-out",
						complete: () => {
							node.removeStyle("overlay-color");
							node.removeStyle("overlay-opacity");
						},
					},
				),
		},
	);
}
