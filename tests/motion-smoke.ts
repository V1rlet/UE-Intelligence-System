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
		const targets = ['.home-title-lockup', '.home-doc'].map((selector) => [selector, document.querySelector(selector)]);
		const missing = targets.filter(([, node]) => !node).map(([selector]) => selector);
		if (missing.length > 0) throw new Error('动效测量目标缺失（覆盖收缩即失败）: ' + missing.join(', '));
		return {
			reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
			animationMs: targets.flatMap(([, node]) => parse(getComputedStyle(node).animationDuration)),
			transitionMs: targets.flatMap(([, node]) => parse(getComputedStyle(node).transitionDuration)),
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
	const mobileRail = await mobile.cdp.evaluate<{ brandVisible: boolean; spacerVisible: boolean; buttons: number; minWidth: number }>(`(() => {
		const visible = (selector) => { const node = document.querySelector(selector); return !!node && getComputedStyle(node).display !== 'none'; };
		const widths = Array.from(document.querySelectorAll('.rail-btn')).map((node) => node.getBoundingClientRect().width);
		return { brandVisible: visible('.rail-brand'), spacerVisible: visible('.rail-spacer'), buttons: widths.length, minWidth: Math.min(...widths) };
	})()`);
	if (mobileRail.brandVisible || mobileRail.spacerVisible || mobileRail.buttons !== 4 || mobileRail.minWidth < 72) {
		throw new Error(`窄屏导航没有收敛为四个稳定触控目标：${JSON.stringify(mobileRail)}`);
	}
	await waitUntil(async () => await mobile.cdp.evaluate<string | null>(`document.querySelector('.home-refresh')?.getAttribute('aria-busy')`) === "false" ? true : null, "首页目录刷新稳定态");
	const mobileTools = await mobile.cdp.evaluate<{ left: number; right: number; searchWidth: number | null; singleSource: boolean; refreshWidth: number; viewport: number; refreshLabel: string | null; refreshBusy: string | null }>(`(() => {
		const tools = document.querySelector('.home-catalog-tools').getBoundingClientRect();
		const search = document.querySelector('.home-catalog-search')?.getBoundingClientRect();
		const refreshNode = document.querySelector('.home-refresh');
		const refresh = refreshNode.getBoundingClientRect();
		return { left: tools.left, right: tools.right, searchWidth: search?.width ?? null, singleSource: !!document.querySelector('.home-single-source'), refreshWidth: refresh.width, viewport: window.innerWidth, refreshLabel: refreshNode.getAttribute('aria-label'), refreshBusy: refreshNode.getAttribute('aria-busy') };
	})()`);
	if (mobileTools.left < -1 || mobileTools.right > mobileTools.viewport + 1 || (mobileTools.searchWidth === null ? !mobileTools.singleSource : mobileTools.searchWidth < 240) || mobileTools.refreshWidth < 40 || mobileTools.refreshLabel !== "重新检查代码图目录" || mobileTools.refreshBusy !== "false") {
		throw new Error(`窄屏目录工具栏发生裁切：${JSON.stringify(mobileTools)}`);
	}
	if (mobileTools.searchWidth !== null) {
	await mobile.cdp.evaluate(`(() => {
		const input = document.querySelector('.home-catalog-search input');
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
		setter.call(input, 'project');
		input.dispatchEvent(new Event('input', { bubbles: true }));
	})()`);
	await waitForSelector(mobile.cdp, '.home-catalog-search [aria-label="清除筛选"]');
	const mobileFilterFeedback = await mobile.cdp.evaluate<{ width: number; height: number; count: string }>(`(() => {
		const clear = document.querySelector('.home-catalog-search [aria-label="清除筛选"]').getBoundingClientRect();
		return { width: clear.width, height: clear.height, count: document.querySelector('.home-section-head h2 em')?.textContent.trim() ?? '' };
	})()`);
	if (mobileFilterFeedback.width < 43 || mobileFilterFeedback.height < 31 || !/^1 \/ \d+ 项$/.test(mobileFilterFeedback.count)) {
		throw new Error(`窄屏筛选反馈或清除热区异常：${JSON.stringify(mobileFilterFeedback)}`);
	}
	}
	await mobile.cdp.send("Page.navigate", { url: `${BASE}/?view=architecture&scope=root` });
	await waitForSelector(mobile.cdp, ".architecture-workspace");
	await waitForSelector(mobile.cdp, ".architecture-overview .architecture-scope-card");
	const architectureOverviewMobile = await mobile.cdp.evaluate<{ overflow: number; commandbarHeight: number; canvasHeight: number; canvasWidthDelta: number; persistentPanels: number; cards: number; minCardWidth: number; canvasMounted: boolean }>(`(() => {
		const stage = document.querySelector('.architecture-stage').getBoundingClientRect();
		const commandbar = document.querySelector('.architecture-commandbar').getBoundingClientRect();
		const canvas = document.querySelector('.mindmap-canvas').getBoundingClientRect();
		const cards = Array.from(document.querySelectorAll('.architecture-scope-card')).map((node) => node.getBoundingClientRect());
		return {
			overflow: document.documentElement.scrollWidth - window.innerWidth,
			commandbarHeight: Math.round(commandbar.height),
			canvasHeight: Math.round(canvas.height),
			canvasWidthDelta: Math.abs(stage.width - canvas.width),
			persistentPanels: document.querySelectorAll('.architecture-overlay-panel,.architecture-selection-card').length,
			cards: cards.length,
			minCardWidth: Math.min(...cards.map((rect) => rect.width)),
			canvasMounted: !!document.querySelector('.architecture-overview canvas'),
		};
	})()`);
	if (architectureOverviewMobile.overflow > 1 || architectureOverviewMobile.commandbarHeight > 62 || architectureOverviewMobile.canvasHeight < 650 || architectureOverviewMobile.canvasWidthDelta > 1 || architectureOverviewMobile.persistentPanels || architectureOverviewMobile.cards < 3 || architectureOverviewMobile.minCardWidth < 360 || architectureOverviewMobile.canvasMounted) {
		throw new Error(`窄屏架构总览异常：${JSON.stringify(architectureOverviewMobile)}`);
	}
	await mobile.cdp.evaluate(`document.querySelector('.architecture-scope-card[data-scope-id="engine"]')?.click()`);
	await waitForSelector(mobile.cdp, ".graph-controls[data-zoom-pct]");
	const architectureMobile = await waitUntil(async () => {
		const state = await mobile.cdp.evaluate<{ controlsLeft: number; controlsRight: number; controlsBottom: number; navTop: number; unnamedTools: number; hasZoomPair: boolean; zoom: number; contextNodes: number }>(`(() => {
			const controls = document.querySelector('.graph-controls').getBoundingClientRect();
			const nav = document.querySelector('.rail').getBoundingClientRect();
			return {
				controlsLeft: Math.round(controls.left), controlsRight: Math.round(controls.right), controlsBottom: Math.round(controls.bottom), navTop: Math.round(nav.top),
				unnamedTools: Array.from(document.querySelectorAll('.architecture-tool-button')).filter((node) => !node.getAttribute('aria-label')).length,
				hasZoomPair: !!document.querySelector('.zoom-slider') && !!document.querySelector('.zoom-number input'),
				zoom: Number(document.querySelector('.graph-controls')?.dataset.zoomPct),
				contextNodes: document.querySelectorAll('.graph-wrap node').length,
			};
		})()`);
		return Number.isFinite(state.zoom) && state.zoom > 0 ? state : null;
	}, "窄屏范围图适配");
	if (architectureMobile.controlsLeft < -1 || architectureMobile.controlsRight > 431 || architectureMobile.controlsBottom > architectureMobile.navTop - 4 || architectureMobile.unnamedTools || !architectureMobile.hasZoomPair || architectureMobile.zoom > 140) throw new Error(`窄屏架构范围图异常：${JSON.stringify(architectureMobile)}`);
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
	if (!mobileScopeOverlay.panelInside || mobileScopeOverlay.position !== "absolute" || Math.abs(mobileScopeOverlay.canvasHeight - architectureOverviewMobile.canvasHeight) > 1) {
		throw new Error(`窄屏范围浮层挤压画布：${JSON.stringify(mobileScopeOverlay)}`);
	}
	await mobile.cdp.evaluate(`document.querySelector('[aria-label="关闭范围面板"]')?.click()`);
	await waitUntil(async () => !await mobile.cdp.evaluate<boolean>(`!!document.querySelector('.architecture-scope-panel')`) ? true : null, "关闭窄屏范围浮层");
	await mobile.cdp.evaluate(`document.querySelector('.architecture-scope-trigger')?.click()`);
	await waitForSelector(mobile.cdp, '.architecture-scope-tree [data-scope-id="sabotage"]');
	await mobile.cdp.evaluate(`document.querySelector('.architecture-scope-tree [data-scope-id="sabotage"]')?.click()`);
	await waitUntil(async () => await mobile.cdp.evaluate<boolean>(`document.querySelector('.architecture-stage')?.getAttribute('data-active-scope') === 'sabotage'`) ? true : null, "窄屏切换项目事实分组");
} finally {
	await mobile.close();
}

console.log("[motion-smoke] 动效降级、普通过渡与窄屏布局通过");
