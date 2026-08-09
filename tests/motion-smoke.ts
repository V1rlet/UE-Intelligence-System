// Motion and responsive smoke for the viewer-only shell.
import { BASE, launchBrowser, waitForSelector, waitUntil } from "./browser-smoke-lib.js";

interface MotionState {
	reduce: boolean;
	animationMs: number[];
	transitionMs: number[];
}

function motionExpression(): string {
	return `(() => {
		const parse = (value) => value.split(',').map((item) => item.trim()).map((item) => item.endsWith('ms') ? parseFloat(item) : parseFloat(item) * 1000).filter(Number.isFinite);
		const nodes = ['.home-title-lockup', '.home-doc'].map((selector) => document.querySelector(selector)).filter(Boolean);
		return {
			reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
			animationMs: nodes.flatMap((node) => parse(getComputedStyle(node).animationDuration)),
			transitionMs: nodes.flatMap((node) => parse(getComputedStyle(node).transitionDuration)),
		};
	})()`;
}

const reduced = await launchBrowser(`${BASE}/`, { reducedMotion: true });
try {
	await waitForSelector(reduced.cdp, ".home-doc");
	const state = await reduced.cdp.evaluate<MotionState>(motionExpression());
	if (!state.reduce) throw new Error("浏览器未进入 reduced-motion 模式");
	if ([...state.animationMs, ...state.transitionMs].some((duration) => duration > 0.02)) {
		throw new Error(`减弱动效仍有长动画：${JSON.stringify(state)}`);
	}
} finally {
	await reduced.close();
}

const normal = await launchBrowser(`${BASE}/`, { reducedMotion: false });
try {
	await waitForSelector(normal.cdp, ".home-doc");
	const state = await normal.cdp.evaluate<MotionState>(motionExpression());
	if (state.reduce) throw new Error("普通模式被错误识别为 reduced-motion");
	if (![...state.animationMs, ...state.transitionMs].some((duration) => duration >= 1)) {
		throw new Error(`普通模式没有保留任何可见过渡：${JSON.stringify(state)}`);
	}
} finally {
	await normal.close();
}

const mobile = await launchBrowser(`${BASE}/`, { reducedMotion: true, windowSize: "430,900" });
try {
	await mobile.cdp.send("Emulation.setDeviceMetricsOverride", { width: 430, height: 900, deviceScaleFactor: 1, mobile: true });
	await waitForSelector(mobile.cdp, ".home-code-viewer");
	await waitForSelector(mobile.cdp, ".home-doc");
	const overflow = await mobile.cdp.evaluate<number>(`document.documentElement.scrollWidth - window.innerWidth`);
	if (overflow > 1) throw new Error(`窄屏发生 ${overflow}px 横向溢出`);
	if (!await mobile.cdp.evaluate<boolean>(`!!document.querySelector('.rail') && !!document.querySelector('.home-code-catalog')`)) {
		throw new Error("窄屏缺少导航或代码目录");
	}
	const mobileTools = await mobile.cdp.evaluate<{ left: number; right: number; searchWidth: number; refreshWidth: number; viewport: number }>(`(() => {
		const tools = document.querySelector('.home-catalog-tools').getBoundingClientRect();
		const search = document.querySelector('.home-catalog-search').getBoundingClientRect();
		const refresh = document.querySelector('.home-refresh').getBoundingClientRect();
		return { left: tools.left, right: tools.right, searchWidth: search.width, refreshWidth: refresh.width, viewport: window.innerWidth };
	})()`);
	if (mobileTools.left < -1 || mobileTools.right > mobileTools.viewport + 1 || mobileTools.searchWidth < 240 || mobileTools.refreshWidth < 40) {
		throw new Error(`窄屏目录工具栏发生裁切：${JSON.stringify(mobileTools)}`);
	}
	await mobile.cdp.send("Page.navigate", { url: `${BASE}/?view=architecture&scope=root` });
	await waitForSelector(mobile.cdp, ".architecture-workspace");
	await waitForSelector(mobile.cdp, ".graph-controls[data-zoom-pct]");
	const architectureMobile = await mobile.cdp.evaluate<{ overflow: number; commandbarHeight: number; canvasHeight: number; canvasWidthDelta: number; persistentPanels: number; controlsLeft: number; controlsRight: number; hasZoomPair: boolean; zoom: number }>(`(() => {
		const stage = document.querySelector('.architecture-stage').getBoundingClientRect();
		const commandbar = document.querySelector('.architecture-commandbar').getBoundingClientRect();
		const canvas = document.querySelector('.mindmap-canvas').getBoundingClientRect();
		const controls = document.querySelector('.graph-controls').getBoundingClientRect();
		return {
			overflow: document.documentElement.scrollWidth - window.innerWidth,
			commandbarHeight: Math.round(commandbar.height),
			canvasHeight: Math.round(canvas.height),
			canvasWidthDelta: Math.abs(stage.width - canvas.width),
			persistentPanels: document.querySelectorAll('.architecture-overlay-panel,.architecture-selection-card').length,
			controlsLeft: Math.round(controls.left),
			controlsRight: Math.round(controls.right),
			hasZoomPair: !!document.querySelector('.zoom-slider') && !!document.querySelector('.zoom-number input'),
			zoom: Number(document.querySelector('.graph-controls')?.dataset.zoomPct),
		};
	})()`);
	if (architectureMobile.overflow > 1 || architectureMobile.commandbarHeight > 62 || architectureMobile.canvasHeight < 650 || architectureMobile.canvasWidthDelta > 1 || architectureMobile.persistentPanels || architectureMobile.controlsLeft < -1 || architectureMobile.controlsRight > 431 || !architectureMobile.hasZoomPair || architectureMobile.zoom > 75) {
		throw new Error(`窄屏架构布局异常：${JSON.stringify(architectureMobile)}`);
	}
	await mobile.cdp.evaluate(`document.querySelector('.architecture-scope-trigger')?.click()`);
	await waitForSelector(mobile.cdp, ".architecture-scope-panel .architecture-scope-tree button");
	const mobileScopeOverlay = await mobile.cdp.evaluate<{ panelInside: boolean; position: string; canvasHeight: number }>(`(() => {
		const panel = document.querySelector('.architecture-scope-panel').getBoundingClientRect();
		const canvas = document.querySelector('.mindmap-canvas').getBoundingClientRect();
		return {
			panelInside: panel.left >= 0 && panel.right <= innerWidth && panel.top >= 0 && panel.bottom <= innerHeight,
			position: getComputedStyle(document.querySelector('.architecture-scope-panel')).position,
			canvasHeight: Math.round(canvas.height),
		};
	})()`);
	if (!mobileScopeOverlay.panelInside || mobileScopeOverlay.position !== "absolute" || Math.abs(mobileScopeOverlay.canvasHeight - architectureMobile.canvasHeight) > 1) {
		throw new Error(`窄屏范围浮层挤压画布：${JSON.stringify(mobileScopeOverlay)}`);
	}
	await mobile.cdp.evaluate(`document.querySelector('[aria-label="关闭范围面板"]')?.click()`);
	await waitUntil(async () => !await mobile.cdp.evaluate<boolean>(`!!document.querySelector('.architecture-scope-panel')`) ? true : null, "关闭窄屏范围浮层");
	const focusPoint = await mobile.cdp.evaluate<{ x: number; y: number }>(`(() => {
		const canvas = document.querySelector('.graph-canvas').getBoundingClientRect();
		const zoom = Number(document.querySelector('.graph-controls')?.dataset.zoomPct) / 100;
		return { x: canvas.left + canvas.width / 2 - 165 * zoom, y: canvas.top + canvas.height / 2 };
	})()`);
	await mobile.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: focusPoint.x, y: focusPoint.y, button: "left", clickCount: 1 });
	await mobile.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: focusPoint.x, y: focusPoint.y, button: "left", clickCount: 1 });
	await waitForSelector(mobile.cdp, ".graph-toggles .focus-exit");
	const stableTapZoom = await mobile.cdp.evaluate<number>(`Number(document.querySelector('.graph-controls')?.dataset.zoomPct)`);
	if (Math.abs(stableTapZoom - architectureMobile.zoom) > 2) throw new Error(`屏内节点首次点击发生跳转：${architectureMobile.zoom}% → ${stableTapZoom}%`);
	await mobile.cdp.evaluate(`document.querySelector('.graph-toggles .focus-exit')?.click()`);
	await waitUntil(async () => !await mobile.cdp.evaluate<boolean>(`!!document.querySelector('.graph-toggles .focus-exit')`) ? true : null, "退出节点聚焦");
	await mobile.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: focusPoint.x, y: focusPoint.y, button: "left", clickCount: 1 });
	await mobile.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: focusPoint.x, y: focusPoint.y, button: "left", clickCount: 1 });
	await mobile.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: focusPoint.x, y: focusPoint.y, button: "left", clickCount: 2 });
	await mobile.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: focusPoint.x, y: focusPoint.y, button: "left", clickCount: 2 });
	await waitUntil(async () => await mobile.cdp.evaluate<boolean>(`document.querySelector('.architecture-stage')?.getAttribute('data-active-scope') === 'engine'`) ? true : null, "屏内节点稳定双击进入范围");
} finally {
	await mobile.close();
}

console.log("[motion-smoke] 动效降级、普通过渡与窄屏布局通过");
