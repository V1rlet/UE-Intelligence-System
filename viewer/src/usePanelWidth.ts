// Graph Brain / viewer - 面板宽度拖拽 hook（F6）：拖动手柄调宽 + localStorage 持久化
//
// side 指面板贴靠的屏幕侧："right"（详情/Spec 面板，手柄在左缘，向左拖变宽）、
// "left"（API 导航，手柄在右缘，向右拖变宽）。拖动中给 body 挂 col-resize 光标类。

import { useCallback, useRef, useState } from "react";
import { loadPref, savePref } from "./uiPrefs";

export type PanelSide = "left" | "right";

/** usePanelWidth 返回值——拖拽手柄与键盘调宽所需的面板状态。 */
export interface PanelWidthState {
	width: number;
	min: number;
	max: number;
	onResizeStart: (e: React.MouseEvent) => void;
	onResizeKeyDown: (e: React.KeyboardEvent) => void;
}

/** 将分隔器按键转换为面板宽度；右侧面板的增长方向与屏幕 X 轴相反。 */
export function resizedPanelWidth(
	width: number,
	key: string,
	min: number,
	max: number,
	side: PanelSide,
	coarse = false,
): number | null {
	if (key === "Home") return min;
	if (key === "End") return max;
	if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
	const step = coarse ? 160 : 16;
	const screenDelta = key === "ArrowRight" ? step : -step;
	const widthDelta = side === "right" ? -screenDelta : screenDelta;
	return Math.min(Math.max(width + widthDelta, min), max);
}

export function usePanelWidth(key: string, defaults: { width: number; min: number; max: number; side: PanelSide }): PanelWidthState {
	const { min, max, side } = defaults;
	const [width, setWidth] = useState<number>(() => {
		const w = loadPref<number>(`panelWidth.${key}`, defaults.width);
		return Math.min(Math.max(w, min), max);
	});
	const widthRef = useRef(width);
	widthRef.current = width;

	const onResizeStart = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			const startX = e.clientX;
			const startWidth = widthRef.current;
			document.body.classList.add("resizing-x");
			const onMove = (ev: MouseEvent) => {
				const delta = side === "right" ? startX - ev.clientX : ev.clientX - startX;
				setWidth(Math.min(Math.max(startWidth + delta, min), max));
			};
			const onUp = () => {
				window.removeEventListener("mousemove", onMove);
				window.removeEventListener("mouseup", onUp);
				document.body.classList.remove("resizing-x");
				savePref(`panelWidth.${key}`, widthRef.current);
			};
			window.addEventListener("mousemove", onMove);
			window.addEventListener("mouseup", onUp);
		},
		[key, min, max, side],
	);

	const onResizeKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			const next = resizedPanelWidth(widthRef.current, event.key, min, max, side, event.shiftKey);
			if (next === null) return;
			event.preventDefault();
			setWidth(next);
			widthRef.current = next;
			savePref(`panelWidth.${key}`, next);
		},
		[key, min, max, side],
	);

	return { width, min, max, onResizeStart, onResizeKeyDown };
}
