// Interaction smoke: navigation, read-only class facts, annotations and help.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { VIEWER_PERFORMANCE_BUDGETS, VIEWER_PERFORMANCE_NAMES } from "../viewer/src/viewerPerformance.js";
import { BASE, captureScreenshot, delay, launchBrowser, navigate, resolveCodeFixture, waitForSelector, waitUntil } from "./browser-smoke-lib.js";
import { resolveSmokeOutputDirectory } from "./smoke-artifacts.js";

const OUT_DIR = resolveSmokeOutputDirectory("interactive");
const fixture = await resolveCodeFixture();
const session = await launchBrowser(`${BASE}/`);

try {
	const { cdp } = session;
	mkdirSync(OUT_DIR, { recursive: true });
	await waitForSelector(cdp, ".home-code-viewer");
	const shellAccessibility = await cdp.evaluate<{ title: string; skipTarget: string | null; mainTabIndex: number }>(`(() => ({
		title: document.title,
		skipTarget: document.querySelector('.skip-link')?.getAttribute('href') ?? null,
		mainTabIndex: document.querySelector('#main-content')?.tabIndex ?? -2,
	}))()`);
	if (shellAccessibility.title !== "代码事实总览 · GraphBrain" || shellAccessibility.skipTarget !== "#main-content" || shellAccessibility.mainTabIndex !== -1) {
		throw new Error(`页面标题或跳过导航入口异常：${JSON.stringify(shellAccessibility)}`);
	}
	const initialHomeCards = await waitUntil(async () => {
		const count = await cdp.evaluate<number>(`document.querySelectorAll('.home-catalog-entry').length`);
		return count >= 1 ? count : null;
	}, "首页代码目录加载");
	if (initialHomeCards < 1) throw new Error("首页代码目录没有活动项目事实");
	const homeHierarchy = await cdp.evaluate<{ primary: number; references: number; referencePreviews: number; evidence: number; duplicateTrust: number; reportedProjectNodes: number; reportedProjectEdges: number; reportedReferences: number; primaryNodes: number; primaryEdges: number; primaryStatus: string | null }>(`({
		primary: document.querySelectorAll('.home-primary-list .home-doc.primary').length,
		references: document.querySelectorAll('.home-reference-list .home-reference-entry').length,
		referencePreviews: document.querySelectorAll('.home-reference-list .home-card-preview').length,
		evidence: document.querySelectorAll('.home-primary-list .home-project-evidence').length,
		duplicateTrust: document.querySelectorAll('.home-trust-banner').length,
		reportedProjectNodes: Number(document.querySelector('.home-stat-project-nodes b')?.textContent.replace(/,/g, '')),
		reportedProjectEdges: Number(document.querySelector('.home-stat-project-edges b')?.textContent.replace(/,/g, '')),
		reportedReferences: Number(document.querySelector('.home-stat-reference-graphs b')?.textContent.replace(/,/g, '')),
		primaryNodes: Number(document.querySelector('.home-primary-list .home-doc.primary')?.dataset.nodeCount),
		primaryEdges: Number(document.querySelector('.home-primary-list .home-doc.primary')?.dataset.edgeCount),
		primaryStatus: document.querySelector('.home-primary-list .home-doc.primary')?.dataset.evidenceStatus ?? null,
	})`);
	if (homeHierarchy.primary !== 1 || homeHierarchy.references !== 0 || homeHierarchy.referencePreviews !== 0 || homeHierarchy.evidence !== 1 || homeHierarchy.duplicateTrust !== 0 || homeHierarchy.reportedProjectNodes !== homeHierarchy.primaryNodes || homeHierarchy.reportedProjectEdges !== homeHierarchy.primaryEdges || homeHierarchy.reportedReferences !== 0 || !homeHierarchy.primaryStatus) throw new Error(`首页事实层级、统计口径或可信度入口没有收敛：${JSON.stringify(homeHierarchy)}`);
	const initialDataRequests = await cdp.evaluate<string[]>(`performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname).filter((path) => path.startsWith('/data/graphs/') || path === '/api/engine-catalog')`);
	if (initialDataRequests.length > 0) throw new Error(`首页提前加载了重型代码事实：${JSON.stringify(initialDataRequests)}`);
	const homeSearchAvailable = await cdp.evaluate<boolean>(`!!document.querySelector('.home-catalog-search input')`);
	if (homeSearchAvailable) {
	await cdp.evaluate(`(() => {
		const input = document.querySelector('.home-catalog-search input');
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
		setter.call(input, 'project');
		input.dispatchEvent(new Event('input', { bubbles: true }));
	})()`);
	await waitUntil(async () => await cdp.evaluate<number>(`document.querySelectorAll('.home-catalog-entry').length`) === 1 ? true : null, "首页代码图筛选");
	if (!await cdp.evaluate<boolean>(`document.querySelector('.home-doc-list .home-doc-name')?.textContent.toLowerCase().includes('project')`)) {
		throw new Error("首页代码图筛选返回了错误结果");
	}
	await cdp.evaluate(`document.querySelector('[aria-label="清除筛选"]')?.click()`);
	await waitUntil(async () => await cdp.evaluate<number>(`document.querySelectorAll('.home-catalog-entry').length`) === initialHomeCards ? true : null, "清除首页代码图筛选");
	} else if (!await cdp.evaluate<boolean>(`!!document.querySelector('.home-single-source') && !!document.querySelector('.home-current-evidence')`)) {
		throw new Error("单一活动图首页既没有筛选入口，也没有明确的单一事实源状态");
	}
	const initialHistoryLength = await cdp.evaluate<number>("history.length");
	await cdp.evaluate(`Array.from(document.querySelectorAll('.rail-btn')).find((node) => node.textContent.includes('探索'))?.click()`);
	await waitForSelector(cdp, ".architecture-workspace");
	const navigationHistoryLength = await cdp.evaluate<number>("history.length");
	if (navigationHistoryLength <= initialHistoryLength) throw new Error(`顶级工作区导航没有写入浏览器历史：${JSON.stringify({ initialHistoryLength, navigationHistoryLength })}`);
	await cdp.evaluate("history.back()");
	await waitForSelector(cdp, ".home-code-viewer");
	await cdp.evaluate("history.forward()");
	await waitForSelector(cdp, ".architecture-workspace");
	const projectGraphPath = `/data/graphs/${encodeURIComponent(fixture.file)}`;
	const architectureProjectPreload = await cdp.evaluate<boolean>(`performance.getEntriesByType('resource').some((entry) => new URL(entry.name).pathname === ${JSON.stringify(`/data/graphs/${encodeURIComponent(fixture.file)}`)})`);
	if (architectureProjectPreload) throw new Error(`架构画布提前加载了项目事实图：${projectGraphPath}`);
	const architectureRoute = await cdp.evaluate<{ view: string | null; mode: string | null }>(`(() => { const params = new URL(location.href).searchParams; return { view: params.get('view'), mode: params.get('mode') }; })()`);
	if (architectureRoute.view !== "explore" || architectureRoute.mode !== "architecture") throw new Error(`架构导航没有同步规范 URL：${JSON.stringify(architectureRoute)}`);
	const architectureProjection = await cdp.evaluate<{ format: string | null; archiveExcluded: boolean }>(`({
		format: document.querySelector('.architecture-stage')?.getAttribute('data-projection-format') ?? null,
		archiveExcluded: document.querySelector('.architecture-overview-footer')?.textContent.includes('旧策展参考图不参与运行时') ?? false,
	})`);
	if (architectureProjection.format !== "catalog-preview-v1" || !architectureProjection.archiveExcluded) throw new Error(`架构入口没有收敛到活动 catalog 投影：${JSON.stringify(architectureProjection)}`);
	const architectureChrome = await cdp.evaluate<{ canvasWidthDelta: number; canvasHeightDelta: number; persistentPanels: number; duplicateTopbar: boolean; toolbarOverlaps: number; overflow: number }>(`(() => {
		const stage = document.querySelector('.architecture-stage').getBoundingClientRect();
		const canvas = document.querySelector('.mindmap-canvas');
		const canvasRect = canvas.getBoundingClientRect();
		const items = Array.from(document.querySelector('.architecture-commandbar')?.children ?? []).filter((node) => getComputedStyle(node).display !== 'none').map((node) => node.getBoundingClientRect());
		const toolbarOverlaps = items.flatMap((left, index) => items.slice(index + 1).map((right) => Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1 && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1)).filter(Boolean).length;
		return {
			canvasWidthDelta: Math.abs(stage.width - canvasRect.width),
			canvasHeightDelta: Math.abs(stage.height - canvasRect.height),
			persistentPanels: document.querySelectorAll('.architecture-overlay-panel,.architecture-selection-card').length,
			duplicateTopbar: !!document.querySelector('.topbar-explore,.topbar-architecture'),
			toolbarOverlaps,
			overflow: document.documentElement.scrollWidth - window.innerWidth,
		};
	})()`);
	if (architectureChrome.canvasWidthDelta > 1 || architectureChrome.canvasHeightDelta > 1 || architectureChrome.persistentPanels || architectureChrome.duplicateTopbar || architectureChrome.toolbarOverlaps || architectureChrome.overflow > 1) {
		throw new Error(`架构工作页组织或边界异常：${JSON.stringify(architectureChrome)}`);
	}
	const overviewFacts = await cdp.evaluate<{ cards: number; canvas: boolean; nodes: number; cardNodes: number }>(`({
		cards: document.querySelectorAll('.architecture-scope-card').length,
		canvas: !!document.querySelector('.architecture-overview canvas'),
		nodes: Number(document.querySelector('.architecture-overview-total strong')?.textContent),
		cardNodes: Array.from(document.querySelectorAll('.architecture-scope-card-metrics b:first-child')).reduce((sum, node) => sum + Number(node.textContent), 0),
	})`);
	if (overviewFacts.cards < 3 || overviewFacts.canvas || overviewFacts.nodes <= 0 || overviewFacts.cardNodes !== overviewFacts.nodes) throw new Error(`架构根视图没有收敛为完整、可读的范围总览：${JSON.stringify(overviewFacts)}`);
	const canvasBeforeScopePanel = await cdp.evaluate<{ width: number; height: number }>(`(() => {
		const rect = document.querySelector('.mindmap-canvas').getBoundingClientRect();
		return { width: rect.width, height: rect.height };
	})()`);
	await cdp.evaluate(`document.querySelector('.architecture-scope-trigger')?.click()`);
	await waitUntil(async () => await cdp.evaluate<number>(`document.querySelectorAll('.architecture-scope-tree button').length`) >= 3 ? true : null, "按需架构范围面板加载");
	const scopeOverlay = await waitUntil(async () => {
		const state = await cdp.evaluate<{ position: string; width: number; height: number; currentRoot: boolean; dialog: boolean; focusedScope: string | null; tabStops: number }>(`(() => {
		const panel = document.querySelector('.architecture-scope-panel');
		const canvas = document.querySelector('.mindmap-canvas').getBoundingClientRect();
		return {
			position: getComputedStyle(panel).position,
			width: canvas.width,
			height: canvas.height,
			currentRoot: document.querySelector('.architecture-scope-tree [data-scope-id="root"]')?.getAttribute('aria-current') === 'page',
			dialog: panel?.getAttribute('role') === 'dialog' && panel?.getAttribute('aria-modal') === 'true',
			focusedScope: document.activeElement?.getAttribute('data-scope-id') ?? null,
			tabStops: document.querySelectorAll('.architecture-scope-tree [role="treeitem"][tabindex="0"]').length,
		};
	})()`);
		return state.focusedScope === "root" ? state : null;
	}, "范围面板接管当前树节点焦点");
	if (scopeOverlay.position !== "absolute" || !scopeOverlay.currentRoot || !scopeOverlay.dialog || scopeOverlay.tabStops !== 1 || Math.abs(scopeOverlay.width - canvasBeforeScopePanel.width) > 1 || Math.abs(scopeOverlay.height - canvasBeforeScopePanel.height) > 1) {
		throw new Error(`范围面板挤压了画布：${JSON.stringify({ canvasBeforeScopePanel, scopeOverlay })}`);
	}
	await cdp.evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
	const movedScopeFocus = await waitUntil(async () => {
		const state = await cdp.evaluate<{ focused: string | null; tabStop: string | null; current: string | null }>(`({
			focused: document.activeElement?.getAttribute('data-scope-id') ?? null,
			tabStop: document.querySelector('.architecture-scope-tree [role="treeitem"][tabindex="0"]')?.getAttribute('data-scope-id') ?? null,
			current: document.querySelector('.architecture-scope-tree [aria-current="page"]')?.getAttribute('data-scope-id') ?? null,
		})`);
		return state.focused && state.focused !== "root" ? state : null;
	}, "方向键移动架构范围树焦点");
	if (movedScopeFocus.tabStop !== movedScopeFocus.focused || movedScopeFocus.current !== "root") throw new Error(`范围树焦点、Tab 停靠点或当前选择发生漂移：${JSON.stringify(movedScopeFocus)}`);
	await cdp.evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))`);
	if (!await cdp.evaluate<boolean>(`document.activeElement?.getAttribute('aria-label') === '关闭范围面板'`)) throw new Error("范围面板没有圈定正向 Tab 焦点");
	await cdp.evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))`);
	if (!await cdp.evaluate<boolean>(`document.activeElement?.getAttribute('data-scope-id') === ${JSON.stringify(movedScopeFocus.focused)}`)) throw new Error("范围面板没有圈定反向 Tab 焦点");
	await cdp.evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
	await waitUntil(async () => !await cdp.evaluate<boolean>(`!!document.querySelector('.architecture-scope-panel')`) && await cdp.evaluate<boolean>(`document.activeElement?.classList.contains('architecture-scope-trigger') ?? false`) ? true : null, "关闭范围面板后恢复触发器焦点");
	await cdp.evaluate(`document.querySelector('.architecture-scope-trigger')?.click()`);
	await waitForSelector(cdp, ".architecture-scope-tree [data-scope-id=\"engine\"]");
	await captureScreenshot(cdp, join(OUT_DIR, "architecture-scope-panel.png"));
	await cdp.evaluate(`document.querySelector('.architecture-scope-tree [data-scope-id="engine"]')?.click()`);
	await waitUntil(async () => await cdp.evaluate<boolean>(`new URL(location.href).searchParams.get('scope') === 'engine' && document.querySelector('.architecture-stage')?.getAttribute('data-active-scope') === 'engine' && !document.querySelector('.architecture-scope-panel')`) ? true : null, "架构范围直接导航");
	await waitForSelector(cdp, ".graph-controls[data-zoom-pct]");
	const engineZoom = await waitUntil(async () => {
		const zoom = await cdp.evaluate<number>(`Number(document.querySelector('.graph-controls')?.dataset.zoomPct)`);
		return Number.isFinite(zoom) && zoom > 0 ? zoom : null;
	}, "切换 scope 后重新适配视口");
	if (engineZoom < 20 || engineZoom > 400) throw new Error(`引擎范围缩放越界：${engineZoom}%`);
	const zoomControlSemantics = await cdp.evaluate<{ slider: boolean; numeric: boolean }>(`({
		slider: document.querySelector('.viewport-zoom-control .zoom-slider')?.getAttribute('aria-label') === '缩放滑杆',
		numeric: document.querySelector('.viewport-zoom-control .zoom-number input')?.getAttribute('aria-label') === '精确缩放百分比',
	})`);
	if (!zoomControlSemantics.slider || !zoomControlSemantics.numeric) throw new Error(`缩放控件缺少滑杆或精确输入：${JSON.stringify(zoomControlSemantics)}`);
	await cdp.evaluate(`(() => {
		const input = document.querySelector('.viewport-zoom-control .zoom-number input');
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
		input.focus();
		setter.call(input, '125');
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.blur();
	})()`);
	await waitUntil(async () => Math.abs(await cdp.evaluate<number>(`Number(document.querySelector('.graph-controls')?.dataset.zoomPct)`) - 125) <= 1 ? true : null, "精确缩放输入");
	await cdp.evaluate(`document.querySelector('.graph-controls [aria-label="适配全图"]')?.click()`);
	await waitUntil(async () => Math.abs(await cdp.evaluate<number>(`Number(document.querySelector('.graph-controls')?.dataset.zoomPct)`) - engineZoom) <= 2 ? true : null, "受限全图适配");
	await cdp.evaluate(`document.querySelector('.architecture-scope-trigger')?.click()`);
	await waitForSelector(cdp, ".architecture-scope-tree [data-scope-id=\"root\"]");
	await cdp.evaluate(`document.querySelector('.architecture-scope-tree [data-scope-id="root"]')?.click()`);
	await waitUntil(async () => {
		const state = await cdp.evaluate<{ root: boolean; overview: boolean; controls: boolean }>(`({
			root: document.querySelector('.architecture-stage')?.getAttribute('data-active-scope') === 'root',
			overview: !!document.querySelector('.architecture-overview'),
			controls: !!document.querySelector('.graph-controls'),
		})`);
		return state.root && state.overview && !state.controls ? true : null;
	}, "返回 scope 后恢复范围总览");
	const canvasBeforeLegend = await cdp.evaluate<string>(`JSON.stringify(document.querySelector('.mindmap-canvas').getBoundingClientRect().toJSON())`);
	await cdp.evaluate(`document.querySelector('.architecture-tool-button[aria-controls="architecture-legend-panel"]')?.click()`);
	await waitForSelector(cdp, ".architecture-legend-panel .mindmap-relation-legend");
	const legendOverlay = await cdp.evaluate<{ position: string; canvas: string }>(`({
		position: getComputedStyle(document.querySelector('.architecture-legend-panel')).position,
		canvas: JSON.stringify(document.querySelector('.mindmap-canvas').getBoundingClientRect().toJSON()),
	})`);
	if (legendOverlay.position !== "absolute" || legendOverlay.canvas !== canvasBeforeLegend) throw new Error(`关系图例挤压了画布：${JSON.stringify(legendOverlay)}`);
	const architectureUrlBeforePanelShortcut = await cdp.evaluate<string>("location.href");
	await cdp.evaluate(`(() => { const close = document.querySelector('[aria-label="关闭关系图例"]'); close.focus(); close.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true })); })()`);
	await delay(100);
	const isolatedArchitecturePanel = await cdp.evaluate<{ url: string; panel: boolean; architecture: boolean }>(`({ url: location.href, panel: !!document.querySelector('.architecture-legend-panel'), architecture: !!document.querySelector('.architecture-workspace') })`);
	if (isolatedArchitecturePanel.url !== architectureUrlBeforePanelShortcut || !isolatedArchitecturePanel.panel || !isolatedArchitecturePanel.architecture) throw new Error(`架构工具面板泄漏了全局导航快捷键：${JSON.stringify(isolatedArchitecturePanel)}`);
	const architectureUrlBeforeHelp = await cdp.evaluate<string>("location.href");
	await cdp.evaluate(`document.querySelector('[aria-label="打开帮助"]')?.click()`);
	await waitForSelector(cdp, '[role="dialog"][aria-label="帮助中心"]');
	await waitUntil(async () => await cdp.evaluate<string>(`document.title`) === "帮助中心 · GraphBrain" ? true : null, "帮助中心页面标题");
	await waitUntil(async () => await cdp.evaluate<boolean>(`document.querySelector('[role="dialog"][aria-label="帮助中心"]')?.contains(document.activeElement) ?? false`) ? true : null, "帮助弹层接管键盘焦点");
	await cdp.evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }))`);
	await cdp.evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true }))`);
	await delay(100);
	const isolatedModal = await cdp.evaluate<{ url: string; architecture: boolean; legend: boolean; help: boolean }>(`({
		url: location.href,
		architecture: !!document.querySelector('.architecture-workspace'),
		legend: !!document.querySelector('.architecture-legend-panel'),
		help: !!document.querySelector('[role="dialog"][aria-label="帮助中心"]'),
	})`);
	if (isolatedModal.url !== architectureUrlBeforeHelp || !isolatedModal.architecture || !isolatedModal.legend || !isolatedModal.help) throw new Error(`模态弹层泄漏了全局快捷键：${JSON.stringify(isolatedModal)}`);
	await cdp.evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
	await waitUntil(async () => !await cdp.evaluate<boolean>(`!!document.querySelector('[role="dialog"][aria-label="帮助中心"]')`) ? true : null, "Esc 关闭顶层帮助弹层");
	if (!await cdp.evaluate<boolean>(`!!document.querySelector('.architecture-legend-panel')`)) throw new Error("帮助弹层的 Esc 泄漏到底层架构面板");
	await cdp.evaluate(`document.querySelector('.architecture-tool-button[aria-controls="architecture-legend-panel"]')?.click()`);
	await waitUntil(async () => !await cdp.evaluate<boolean>(`!!document.querySelector('.architecture-legend-panel')`) ? true : null, "关闭关系图例");

	await cdp.evaluate(`Array.from(document.querySelectorAll('.architecture-explore-switch button')).find((node) => node.textContent.trim() === '关系')?.click()`);
	await waitForSelector(cdp, ".graph-col");
	await waitForSelector(cdp, ".forest-semantic-bar");
	const persistentEvidenceStatus = await cdp.evaluate<string | null>(`document.querySelector('.evidence-status-badge')?.getAttribute('data-evidence-status') ?? null`);
	if (persistentEvidenceStatus !== homeHierarchy.primaryStatus) throw new Error(`项目证据状态没有从总览贯穿到关系图：${JSON.stringify({ home: homeHierarchy.primaryStatus, relations: persistentEvidenceStatus })}`);
	const graphChrome = await cdp.evaluate<{ topbarRight: number; workspaceRight: number; toolbarOverlap: boolean; searchRole: string | null; emptyInspector: boolean; loadMode: string | null; layoutCapability: string | null; visibleNodes: number; totalNodes: number; zoom: number }>(`(() => {
		const topbar = document.querySelector('.topbar-graph').getBoundingClientRect();
		const workspace = document.querySelector('.workspace').getBoundingClientRect();
		const semantic = document.querySelector('.forest-semantic-bar');
		const semanticRect = semantic.getBoundingClientRect();
		return {
			topbarRight: topbar.right,
			workspaceRight: workspace.right,
			toolbarOverlap: Math.min(topbar.right, semanticRect.right) - Math.max(topbar.left, semanticRect.left) > 1 && Math.min(topbar.bottom, semanticRect.bottom) - Math.max(topbar.top, semanticRect.top) > 1,
			searchRole: document.querySelector('.forest-search input')?.getAttribute('role') ?? null,
			emptyInspector: !!document.querySelector('.detail-panel,.inspector-empty'),
			loadMode: document.querySelector('.topbar-code-workspace')?.getAttribute('data-graph-load-mode') ?? null,
			layoutCapability: document.querySelector('.graph-wrap')?.getAttribute('data-layout-capability') ?? null,
			visibleNodes: Number(semantic?.getAttribute('data-visible-nodes')),
			totalNodes: Number(semantic?.getAttribute('data-total-nodes')),
			zoom: Number(document.querySelector('.graph-controls')?.getAttribute('data-zoom-pct')),
		};
	})()`);
	if (graphChrome.topbarRight > graphChrome.workspaceRight + 1 || graphChrome.toolbarOverlap) throw new Error(`代码图工具栏边界异常：${JSON.stringify(graphChrome)}`);
	if (graphChrome.searchRole !== "combobox") throw new Error("代码图搜索没有暴露组合框语义");
	if (graphChrome.emptyInspector) throw new Error(`未选择事实时仍占用空检视器：${JSON.stringify(graphChrome)}`);
	if (graphChrome.loadMode !== "projection" || graphChrome.layoutCapability !== "forest" || graphChrome.visibleNodes <= 0 || graphChrome.visibleNodes >= graphChrome.totalNodes || graphChrome.zoom < 52) {
		throw new Error(`关系图没有进入可读的语义投影：${JSON.stringify(graphChrome)}`);
	}
	const canvasKeyboard = await cdp.evaluate<{ role: string | null; tabIndex: number; shortcuts: string | null }>(`(() => {
		const canvas = document.querySelector('.graph-canvas');
		return { role: canvas?.getAttribute('role') ?? null, tabIndex: canvas?.tabIndex ?? -1, shortcuts: canvas?.getAttribute('aria-keyshortcuts') ?? null };
	})()`);
	if (canvasKeyboard.role !== "region" || canvasKeyboard.tabIndex !== 0 || !canvasKeyboard.shortcuts?.includes("Home")) throw new Error(`图画布缺少键盘入口语义：${JSON.stringify(canvasKeyboard)}`);
	await cdp.evaluate(`(() => { const input = document.querySelector('.forest-search input'); input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true })); })()`);
	await delay(100);
	const offCanvasZoom = await cdp.evaluate<number>(`Number(document.querySelector('.graph-controls')?.getAttribute('data-zoom-pct'))`);
	if (offCanvasZoom !== graphChrome.zoom) throw new Error(`画布未聚焦时缩放快捷键仍穿透：${JSON.stringify({ before: graphChrome.zoom, after: offCanvasZoom })}`);
	await cdp.evaluate(`(() => { const canvas = document.querySelector('.graph-canvas'); canvas.focus(); canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true })); })()`);
	await waitUntil(async () => await cdp.evaluate<number>(`Number(document.querySelector('.graph-controls')?.getAttribute('data-zoom-pct'))`) > graphChrome.zoom ? true : null, "画布聚焦后的缩放快捷键");
	await cdp.evaluate(`document.querySelector('.graph-canvas')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', bubbles: true }))`);
	await waitUntil(async () => Math.abs(await cdp.evaluate<number>(`Number(document.querySelector('.graph-controls')?.getAttribute('data-zoom-pct'))`) - graphChrome.zoom) <= 2 ? true : null, "画布快捷键恢复全图适配");
	await cdp.evaluate(`(() => { const trigger = document.querySelector('.layers-btn'); trigger.focus(); trigger.click(); })()`);
	await waitForSelector(cdp, "#graph-layers-popover");
	const layersSemantics = await cdp.evaluate<boolean>(`document.querySelector('.layers-btn')?.getAttribute('aria-controls') === 'graph-layers-popover' && document.querySelector('#graph-layers-popover')?.getAttribute('aria-labelledby') === 'graph-layers-popover-title'`);
	if (!layersSemantics) throw new Error("图层与显示弹层缺少触发器或标题关联");
	const graphUrlBeforeLayersShortcut = await cdp.evaluate<string>("location.href");
	await cdp.evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }))`);
	await delay(100);
	const isolatedLayers = await cdp.evaluate<{ url: string; open: boolean }>(`({ url: location.href, open: !!document.querySelector('#graph-layers-popover') })`);
	if (isolatedLayers.url !== graphUrlBeforeLayersShortcut || !isolatedLayers.open) throw new Error(`图层弹层泄漏了全局导航快捷键：${JSON.stringify(isolatedLayers)}`);
	await cdp.evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
	await waitUntil(async () => !await cdp.evaluate<boolean>(`!!document.querySelector('#graph-layers-popover')`) ? true : null, "Esc 关闭图层与显示弹层");
	await waitUntil(async () => await cdp.evaluate<boolean>(`document.activeElement?.classList.contains('layers-btn') ?? false`) ? true : null, "图层弹层关闭后恢复触发器焦点");
	await cdp.evaluate(`(() => { const canvas = document.querySelector('.graph-canvas'); canvas.focus(); canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true })); })()`);
	await waitForSelector(cdp, "#graph-canvas-menu");
	const initialCanvasMenu = await waitUntil(async () => {
		const state = await cdp.evaluate<{ count: number; focused: string; blocker: string | null; controlled: boolean }>(`(() => ({
			count: document.querySelectorAll('#graph-canvas-menu [role="menuitem"]:not(:disabled)').length,
			focused: document.activeElement?.getAttribute('role') === 'menuitem' ? document.activeElement.textContent.trim() : '',
			blocker: document.querySelector('#graph-canvas-menu')?.getAttribute('data-app-shortcuts') ?? null,
			controlled: document.querySelector('.graph-canvas')?.getAttribute('aria-controls') === 'graph-canvas-menu',
		}))()`);
		return state.count === 3 && state.focused && state.blocker === "block" && state.controlled ? state : null;
	}, "键盘打开画布操作菜单");
	await cdp.evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
	const movedCanvasMenu = await waitUntil(async () => {
		const label = await cdp.evaluate<string>(`document.activeElement?.getAttribute('role') === 'menuitem' ? document.activeElement.textContent.trim() : ''`);
		return label && label !== initialCanvasMenu.focused ? label : null;
	}, "画布菜单方向键导航");
	if (movedCanvasMenu === initialCanvasMenu.focused) throw new Error("画布菜单方向键没有移动焦点");
	const graphUrlBeforeMenuShortcut = await cdp.evaluate<string>("location.href");
	await cdp.evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }))`);
	await delay(100);
	if (await cdp.evaluate<string>("location.href") !== graphUrlBeforeMenuShortcut || !await cdp.evaluate<boolean>(`!!document.querySelector('#graph-canvas-menu')`)) throw new Error("画布菜单泄漏了全局导航快捷键");
	await cdp.evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
	await waitUntil(async () => !await cdp.evaluate<boolean>(`!!document.querySelector('#graph-canvas-menu')`) ? true : null, "Esc 关闭画布操作菜单");
	await waitUntil(async () => await cdp.evaluate<boolean>(`document.activeElement?.classList.contains('graph-canvas') ?? false`) ? true : null, "画布菜单关闭后恢复画布焦点");
	const projectRelationRequests = await cdp.evaluate<string[]>(`performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname).filter((path) => path === '/api/graph-projection' || path === ${JSON.stringify(projectGraphPath)})`);
	if (!projectRelationRequests.includes('/api/graph-projection') || projectRelationRequests.includes(projectGraphPath)) throw new Error(`关系图加载边界异常：${JSON.stringify(projectRelationRequests)}`);
	const unexpectedForestLayoutRequests = await cdp.evaluate<string[]>(`performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname).filter((path) => /cytoscape-fcose|registerFcose/i.test(path))`);
	if (unexpectedForestLayoutRequests.length) throw new Error(`文件森林错误加载了 fCoSE：${JSON.stringify(unexpectedForestLayoutRequests)}`);
	if (await cdp.evaluate<boolean>(`performance.getEntriesByType('resource').some((entry) => new URL(entry.name).pathname === '/api/engine-catalog')`)) {
		throw new Error("项目关系图提前加载了引擎目录");
	}
	if (await cdp.evaluate<boolean>(`!!document.querySelector('.planned-toolbar,.design-edit-toolbar,.export-btn,.design-schematic-tools')`)) {
		throw new Error("代码图仍暴露创作或导出入口");
	}
	const projectionPerformance = await waitUntil(async () => {
		const value = await cdp.evaluate<{
			download: { duration: number; detail?: { bytes?: number } } | null;
			parse: { duration: number } | null;
			layout: { duration: number } | null;
			interactive: { duration: number } | null;
		}>(`(() => {
			const read = (name) => {
				const entry = performance.getEntriesByName(name, 'measure').at(-1);
				return entry ? { duration: entry.duration, detail: entry.detail } : null;
			};
			return {
				download: read(${JSON.stringify(VIEWER_PERFORMANCE_NAMES.projectionDownload)}),
				parse: read(${JSON.stringify(VIEWER_PERFORMANCE_NAMES.projectionParse)}),
				layout: read(${JSON.stringify(VIEWER_PERFORMANCE_NAMES.projectionLayout)}),
				interactive: read(${JSON.stringify(VIEWER_PERFORMANCE_NAMES.projectionInteractive)}),
			};
		})()`);
		return value.download && value.parse && value.layout && value.interactive ? value : null;
	}, "项目关系图性能度量");
	const projectionBytes = projectionPerformance.download?.detail?.bytes ?? Number.POSITIVE_INFINITY;
	if (
		projectionBytes > VIEWER_PERFORMANCE_BUDGETS.projectionBytes
		|| projectionPerformance.download!.duration > VIEWER_PERFORMANCE_BUDGETS.projectionDownloadMs
		|| projectionPerformance.parse!.duration > VIEWER_PERFORMANCE_BUDGETS.projectionParseMs
		|| projectionPerformance.layout!.duration > VIEWER_PERFORMANCE_BUDGETS.projectionLayoutMs
		|| projectionPerformance.interactive!.duration > VIEWER_PERFORMANCE_BUDGETS.projectionInteractiveMs
	) {
		throw new Error(`项目关系图超过首屏性能预算：${JSON.stringify({ projectionBytes, ...projectionPerformance })}`);
	}
	console.log(`[performance] projection ${projectionBytes} B · download ${projectionPerformance.download!.duration.toFixed(1)} ms · parse ${projectionPerformance.parse!.duration.toFixed(1)} ms · layout ${projectionPerformance.layout!.duration.toFixed(1)} ms · interactive ${projectionPerformance.interactive!.duration.toFixed(1)} ms`);

	await cdp.evaluate(`(() => {
		const input = document.querySelector('.forest-search input');
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
		setter.call(input, ${JSON.stringify(fixture.specId)});
		input.dispatchEvent(new Event('input', { bubbles: true }));
	})()`);
	await waitForSelector(cdp, "#forest-search-options li");
	await cdp.evaluate(`document.querySelector('#forest-search-options li')?.click()`);
	const branchUrl = await waitUntil(async () => {
		const state = await cdp.evaluate<{ url: string; branch: string | null; version: string | null; visible: number }>(`(() => {
			const params = new URL(location.href).searchParams;
			return { url: location.href, branch: params.get('branch'), version: params.get('forest_v'), visible: Number(document.querySelector('.forest-semantic-bar')?.getAttribute('data-visible-nodes')) };
		})()`);
		return state.branch && state.version === "1" && state.visible > graphChrome.visibleNodes ? state : null;
	}, "文件森林稳定分支深链");
	await navigate(cdp, branchUrl.url, ".forest-semantic-bar");
	const restoredBranch = await waitUntil(async () => {
		const state = await cdp.evaluate<{ branch: string | null; version: string | null; visible: number; loadMode: string | null }>(`(() => {
			const params = new URL(location.href).searchParams;
			return {
				branch: params.get('branch'),
				version: params.get('forest_v'),
				visible: Number(document.querySelector('.forest-semantic-bar')?.getAttribute('data-visible-nodes')),
				loadMode: document.querySelector('.topbar-code-workspace')?.getAttribute('data-graph-load-mode'),
			};
		})()`);
		return state.branch === branchUrl.branch && state.version === "1" && state.visible > graphChrome.visibleNodes && state.loadMode === "projection" ? state : null;
	}, "刷新恢复文件森林分支");
	if (restoredBranch.loadMode !== "projection") throw new Error(`分支深链错误升级为完整事实图：${JSON.stringify(restoredBranch)}`);
	await waitForSelector(cdp, ".graph-toggles .focus-exit");
	const hasGraphPicker = await cdp.evaluate<boolean>(`!!document.querySelector('.topbar-graph-picker .hierarchy-select-trigger')`);
	if (hasGraphPicker) {
	await cdp.evaluate(`document.querySelector('.topbar-graph-picker .hierarchy-select-trigger')?.click()`);
	await waitForSelector(cdp, ".hierarchy-select-panel .hierarchy-select-search input");
	const pickerSemantics = await waitUntil(async () => {
		const state = await cdp.evaluate<{ focusedSearch: boolean; triggerControls: string | null; searchControls: string | null; listboxId: string | null; tabStops: number; misplacedActiveDescendant: boolean }>(`(() => {
			const trigger = document.querySelector('.topbar-graph-picker .hierarchy-select-trigger');
			const search = document.querySelector('.hierarchy-select-panel .hierarchy-select-search input');
			const listbox = document.querySelector('.hierarchy-select-panel [role="listbox"]');
			return {
				focusedSearch: document.activeElement === search,
				triggerControls: trigger?.getAttribute('aria-controls') ?? null,
				searchControls: search?.getAttribute('aria-controls') ?? null,
				listboxId: listbox?.id ?? null,
				tabStops: document.querySelectorAll('.hierarchy-select-panel [role="option"][tabindex="0"]').length,
				misplacedActiveDescendant: listbox?.hasAttribute('aria-activedescendant') ?? false,
			};
		})()`);
		return state.focusedSearch ? state : null;
	}, "代码图选择器聚焦筛选入口");
	if (!pickerSemantics.listboxId || pickerSemantics.triggerControls !== pickerSemantics.listboxId || pickerSemantics.searchControls !== pickerSemantics.listboxId || pickerSemantics.tabStops !== 1 || pickerSemantics.misplacedActiveDescendant) throw new Error(`代码图选择器 ARIA 或 roving 焦点异常：${JSON.stringify(pickerSemantics)}`);
	const searchHomePrevented = await cdp.evaluate<boolean>(`(() => {
		const input = document.activeElement;
		const event = new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true });
		input.dispatchEvent(event);
		return event.defaultPrevented;
	})()`);
	if (searchHomePrevented) throw new Error("代码图筛选框错误拦截了文本 Home 键");
	await cdp.evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))`);
	await waitUntil(async () => await cdp.evaluate<boolean>(`document.activeElement?.getAttribute('role') === 'option' && document.activeElement?.tabIndex === 0`) ? true : null, "代码图选择器方向键进入结果");
	await cdp.evaluate(`(() => {
		const input = document.querySelector('.hierarchy-select-panel .hierarchy-select-search input');
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
		input.focus();
		setter.call(input, '__no_matching_graph__');
		input.dispatchEvent(new Event('input', { bubbles: true }));
	})()`);
	await waitUntil(async () => await cdp.evaluate<boolean>(`!!document.querySelector('.hierarchy-select-empty[role="status"]') && document.activeElement === document.querySelector('.hierarchy-select-search input')`) ? true : null, "代码图筛选空状态");
	const graphUrlBeforePickerShortcut = await cdp.evaluate<string>("location.href");
	await cdp.evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }))`);
	await delay(100);
	if (await cdp.evaluate<string>("location.href") !== graphUrlBeforePickerShortcut || !await cdp.evaluate<boolean>(`!!document.querySelector('.hierarchy-select-panel')`)) throw new Error("图谱选择器泄漏了全局导航快捷键");
	await cdp.evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
	await waitUntil(async () => !await cdp.evaluate<boolean>(`!!document.querySelector('.hierarchy-select-panel')`) ? true : null, "Esc 关闭已聚焦图谱的选择器");
	await waitUntil(async () => await cdp.evaluate<boolean>(`document.activeElement?.classList.contains('hierarchy-select-trigger') ?? false`) ? true : null, "代码图选择器关闭后恢复触发器焦点");
	if (!await cdp.evaluate<boolean>(`!!document.querySelector('.graph-toggles .focus-exit')`)) throw new Error("关闭图谱选择器时意外清除了画布聚焦");
	await cdp.evaluate(`document.querySelector('.topbar-graph-picker .hierarchy-select-trigger')?.click()`);
	await waitForSelector(cdp, ".hierarchy-select-panel .hierarchy-select-search input");
	await cdp.evaluate(`document.querySelector('.graph-canvas')?.focus()`);
	await waitUntil(async () => !await cdp.evaluate<boolean>(`!!document.querySelector('.hierarchy-select-panel')`) && await cdp.evaluate<boolean>(`document.activeElement?.classList.contains('graph-canvas') ?? false`) ? true : null, "焦点离开时关闭代码图选择器");
	} else {
		const singleGraphContext = await cdp.evaluate<{ context: boolean; picker: boolean }>(`({
			context: !!document.querySelector('.topbar-source-context'),
			picker: !!document.querySelector('.topbar-graph-picker'),
		})`);
		if (!singleGraphContext.context || singleGraphContext.picker) throw new Error(`单一活动代码图没有收敛为只读来源上下文：${JSON.stringify(singleGraphContext)}`);
		if (!await cdp.evaluate<boolean>(`!!document.querySelector('.graph-toggles .focus-exit')`)) throw new Error("单一来源上下文意外清除了画布聚焦");
	}
	await navigate(cdp, `${BASE}/?view=explore&mode=relations&source=project&file=${encodeURIComponent(fixture.file)}`, ".forest-semantic-bar");
	await waitUntil(async () => {
		const state = await cdp.evaluate<{ branch: string | null; detail: boolean }>(`(() => ({
			branch: new URL(location.href).searchParams.get('branch'),
			detail: !!document.querySelector('.detail-panel'),
		}))()`);
		return !state.branch && !state.detail ? true : null;
	}, "分支验证后恢复森林根态");
	if (hasGraphPicker) {
	await cdp.evaluate(`document.querySelector('.topbar-graph-picker .hierarchy-select-trigger')?.click()`);
	await waitForSelector(cdp, ".hierarchy-select-panel .hierarchy-option-group");
	const graphPicker = await cdp.evaluate<{ position: string; groups: number; tones: number; lastBranches: number; overflow: number }>(`(() => ({
		position: getComputedStyle(document.querySelector('.hierarchy-select-panel')).position,
		groups: document.querySelectorAll('.hierarchy-select-panel .hierarchy-option-group:not(.is-root)').length,
		tones: new Set(Array.from(document.querySelectorAll('.hierarchy-select-panel .hierarchy-option-group:not(.is-root)')).map((node) => node.getAttribute('data-tone'))).size,
		lastBranches: document.querySelectorAll('.hierarchy-select-panel .hierarchy-option[data-last="true"] .hierarchy-option-branch').length,
		overflow: document.documentElement.scrollWidth - window.innerWidth,
	}))()`);
	if (graphPicker.position !== "fixed" || graphPicker.groups < 2 || graphPicker.tones < 2 || graphPicker.lastBranches !== graphPicker.groups || graphPicker.overflow > 1) throw new Error(`代码图分层下拉异常：${JSON.stringify(graphPicker)}`);
	await captureScreenshot(cdp, join(OUT_DIR, "graph-hierarchy-select.png"));
	await cdp.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
	await waitUntil(async () => !await cdp.evaluate<boolean>(`!!document.querySelector('.hierarchy-select-panel')`) ? true : null, "关闭代码图选择器");
	}
	const relationsTopbar = await cdp.evaluate<{ left: number; width: number; height: number; lenses: string[]; sources: Array<{ label: string; left: number; width: number }> }>(`(() => {
		const bar = document.querySelector('.topbar-code-workspace').getBoundingClientRect();
		return {
			left: bar.left, width: bar.width, height: bar.height,
			lenses: Array.from(document.querySelectorAll('.code-lens-switch button')).map((node) => node.textContent.trim()),
			sources: Array.from(document.querySelectorAll('.code-source-switch button')).map((node) => { const rect = node.getBoundingClientRect(); return { label: node.textContent.trim(), left: rect.left, width: rect.width }; }),
		};
	})()`);
	if (relationsTopbar.lenses.join("/") !== "架构/关系图/API" || relationsTopbar.sources.map((item) => item.label).join("/") !== "项目/引擎") throw new Error(`探索层级异常：${JSON.stringify(relationsTopbar)}`);

	await cdp.evaluate(`Array.from(document.querySelectorAll('.code-lens-switch button')).find((node) => node.textContent.trim() === 'API')?.click()`);
	await waitForSelector(cdp, ".api-landing-browse");
	const apiLandingUx = await cdp.evaluate<{ searchIcon: boolean; searchLabel: string | null; removeTargets: Array<{ width: number; height: number; label: string | null }> }>(`(() => ({
		searchIcon: !!document.querySelector('.api-landing-search > svg'),
		searchLabel: document.querySelector('.api-landing-search input')?.getAttribute('aria-label') ?? null,
		removeTargets: Array.from(document.querySelectorAll('.api-common-remove')).map((node) => {
			const rect = node.getBoundingClientRect();
			return { width: rect.width, height: rect.height, label: node.getAttribute('aria-label') };
		}),
	}))()`);
	if (!apiLandingUx.searchIcon || apiLandingUx.searchLabel !== "搜索全部 API" || apiLandingUx.removeTargets.some((target) => target.width < 35 || target.height < 35 || !target.label?.startsWith("从快速入口移除"))) {
		throw new Error(`API 首页搜索或快速入口交互目标异常：${JSON.stringify(apiLandingUx)}`);
	}
	const apiTopbar = await cdp.evaluate<{ left: number; width: number; height: number; sources: Array<{ label: string; left: number; width: number }> }>(`(() => {
		const bar = document.querySelector('.topbar-code-workspace').getBoundingClientRect();
		return {
			left: bar.left, width: bar.width, height: bar.height,
			sources: Array.from(document.querySelectorAll('.code-source-switch button')).map((node) => { const rect = node.getBoundingClientRect(); return { label: node.textContent.trim(), left: rect.left, width: rect.width }; }),
		};
	})()`);
	if (apiTopbar.sources.map((item) => item.label).join("/") !== "项目/引擎/全部") throw new Error(`API 来源层级异常：${JSON.stringify(apiTopbar)}`);
	if (Math.abs(apiTopbar.left - relationsTopbar.left) > 1 || Math.abs(apiTopbar.width - relationsTopbar.width) > 1 || Math.abs(apiTopbar.height - relationsTopbar.height) > 1) throw new Error(`关系图/API 横栏发生跳跃：${JSON.stringify({ relationsTopbar, apiTopbar })}`);
	for (let index = 0; index < 2; index += 1) if (Math.abs(apiTopbar.sources[index].left - relationsTopbar.sources[index].left) > 1 || Math.abs(apiTopbar.sources[index].width - relationsTopbar.sources[index].width) > 1) throw new Error(`关系图/API 的项目、引擎槽位不一致：${JSON.stringify({ relationsTopbar, apiTopbar })}`);
	await cdp.evaluate(`document.querySelector('.api-landing-browse')?.click()`);
	await waitForSelector(cdp, ".api-function-search");
	const apiFunctionSearchUx = await cdp.evaluate<{ label: string | null; wrapperHeight: number; resultStatus: boolean; modePressed: number }>(`(() => {
		const wrapper = document.querySelector('.api-function-search');
		return {
			label: wrapper?.querySelector('input')?.getAttribute('aria-label') ?? null,
			wrapperHeight: wrapper?.getBoundingClientRect().height ?? 0,
			resultStatus: document.querySelector('.api-result-summary')?.getAttribute('role') === 'status',
			modePressed: document.querySelectorAll('.api-mode button[aria-pressed]').length,
		};
	})()`);
	if (apiFunctionSearchUx.label !== "搜索 API 函数" || apiFunctionSearchUx.wrapperHeight < 37 || !apiFunctionSearchUx.resultStatus || apiFunctionSearchUx.modePressed !== 2) {
		throw new Error(`API 函数搜索反馈或筛选语义异常：${JSON.stringify(apiFunctionSearchUx)}`);
	}
	await cdp.evaluate(`Array.from(document.querySelectorAll('.code-source-switch button')).find((node) => node.textContent.trim() === '引擎')?.click()`);
	await waitForSelector(cdp, ".api-nav .engine-module-tree.is-compact");
	const sharedEngineTree = await cdp.evaluate<{ scopes: number; tones: number; sourceTabs: number; apiRailEntry: boolean }>(`(() => ({
		scopes: document.querySelectorAll('.api-nav .engine-forest-scope').length,
		tones: new Set(Array.from(document.querySelectorAll('.api-nav .engine-forest-branch')).map((node) => getComputedStyle(node).getPropertyValue('--engine-branch'))).size,
		sourceTabs: document.querySelectorAll('.api-source-tabs').length,
		apiRailEntry: Array.from(document.querySelectorAll('.rail-btn')).some((node) => node.textContent.trim() === 'API'),
	}))()`);
	if (sharedEngineTree.scopes !== 4 || sharedEngineTree.tones < 4 || sharedEngineTree.sourceTabs !== 0 || sharedEngineTree.apiRailEntry) throw new Error(`引擎源码与 API 未共享统一层级：${JSON.stringify(sharedEngineTree)}`);
	try {
		await waitUntil(async () => await cdp.evaluate<number>(`document.querySelectorAll('.api-nav .engine-module-card').length`) > 0 ? true : null, "共享引擎目录加载");
	} catch (error) {
		const diagnostic = await cdp.evaluate(`(() => ({
			loadMode: document.querySelector('.topbar-code-workspace')?.getAttribute('data-graph-load-mode'),
			source: document.querySelector('.topbar-code-workspace')?.getAttribute('data-code-source'),
			alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((node) => node.textContent.trim()),
			requests: performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('engine-catalog')),
		}))()`);
		throw new Error(`${String(error)}；诊断：${JSON.stringify(diagnostic)}`);
	}
	await cdp.evaluate(`document.querySelector('.api-nav .engine-module-card')?.click()`);
	const selectedModule = await waitUntil(async () => {
		const name = await cdp.evaluate<string>(`document.querySelector('.api-nav .engine-module-card.active b')?.textContent ?? ''`);
		return name || null;
	}, "API 视图选择引擎模块");
	await waitForSelector(cdp, ".api-catalog-class > button:first-child");
	const selectedClass = await cdp.evaluate<string>(`document.querySelector('.api-catalog-class .api-catalog-name')?.textContent ?? ''`);
	await cdp.evaluate(`document.querySelector('.api-catalog-class > button:first-child')?.click()`);
	await captureScreenshot(cdp, join(OUT_DIR, "api-engine-shared-tree.png"));
	await cdp.evaluate(`Array.from(document.querySelectorAll('.code-lens-switch button')).find((node) => node.textContent.trim() === '关系图')?.click()`);
	await waitForSelector(cdp, ".engine-spec-browser .engine-module-card.active");
	const sourceModule = await cdp.evaluate<string>(`document.querySelector('.engine-spec-browser .engine-module-card.active b')?.textContent ?? ''`);
	if (sourceModule !== selectedModule) throw new Error(`API/源码视图没有保留同一模块选择：${selectedModule} -> ${sourceModule}`);
	await waitForSelector(cdp, ".engine-spec-browser .engine-symbol-card.active");
	const sourceClass = await cdp.evaluate<string>(`document.querySelector('.engine-spec-browser .engine-symbol-card.active b')?.textContent ?? ''`);
	if (!selectedClass || sourceClass !== selectedClass) throw new Error(`API/源码视图没有保留同一类型选择：${selectedClass} -> ${sourceClass}`);
	const unifiedRoute = await cdp.evaluate<{ view: string | null; source: string | null; mode: string | null }>(`(() => { const params = new URL(location.href).searchParams; return { view: params.get('view'), source: params.get('source'), mode: params.get('mode') }; })()`);
	if (unifiedRoute.view !== "explore" || unifiedRoute.source !== "engine" || unifiedRoute.mode !== "relations") throw new Error(`统一探索工作区路由异常：${JSON.stringify(unifiedRoute)}`);

	const specUrl = `${BASE}/?view=explore&mode=relations&source=project&file=${encodeURIComponent(fixture.file)}&spec=${encodeURIComponent(fixture.specId)}`;
	await navigate(cdp, specUrl, ".readonly-spec-panel");
	await waitForSelector(cdp, ".topbar-graph .spec-nav");
	await waitUntil(async () => await cdp.evaluate<boolean>(`(() => {
		const topbar = document.querySelector('.topbar-graph')?.getBoundingClientRect();
		const panel = document.querySelector('.readonly-spec-panel')?.getBoundingClientRect();
		return !!topbar && !!panel && topbar.right <= panel.left + 1;
	})()`) ? true : null, "类详情顶栏避让");
	const specChrome = await cdp.evaluate<{ topbarRight: number; panelLeft: number; topbarWidth: number; panelWidth: number; viewport: number; specWidth: string; inheritedSpecWidth: string; topbarPanelWidth: string; topbarInset: string; inlineStyle: string | null; hasSpecNav: boolean; hasSpecClass: boolean }>(`(() => {
		const topbarNode = document.querySelector('.topbar-graph');
		const panelNode = document.querySelector('.readonly-spec-panel');
		const topbar = topbarNode.getBoundingClientRect();
		const panel = panelNode.getBoundingClientRect();
		return {
			topbarRight: topbar.right,
			panelLeft: panel.left,
			topbarWidth: topbar.width,
			panelWidth: panel.width,
			viewport: window.innerWidth,
			specWidth: getComputedStyle(document.querySelector('.deck')).getPropertyValue('--spec-w'),
			inheritedSpecWidth: getComputedStyle(topbarNode).getPropertyValue('--spec-w'),
			topbarPanelWidth: getComputedStyle(topbarNode).getPropertyValue('--code-topbar-panel-w'),
			topbarInset: getComputedStyle(topbarNode).right,
			inlineStyle: topbarNode.getAttribute('style'),
			hasSpecNav: !!topbarNode.querySelector('.spec-nav'),
			hasSpecClass: topbarNode.classList.contains('has-spec-nav'),
		};
	})()`);
	if (specChrome.topbarRight > specChrome.panelLeft + 1) throw new Error(`类详情顶栏压住信息面板：${JSON.stringify(specChrome)}`);
	const desktopOverflow = await cdp.evaluate<number>(`document.documentElement.scrollWidth - window.innerWidth`);
	if (desktopOverflow > 1) {
		const offenders = await cdp.evaluate<Array<{ tag: string; className: string; right: number; width: number }>>(`Array.from(document.querySelectorAll('*')).map((node) => {
			const rect = node.getBoundingClientRect();
			return { tag: node.tagName, className: String(node.className ?? ''), right: Math.round(rect.right), width: Math.round(rect.width) };
		}).filter((item) => item.right > window.innerWidth + 1).sort((left, right) => right.right - left.right).slice(0, 8)`);
		throw new Error(`类详情发生 ${desktopOverflow}px 页面横向溢出：${JSON.stringify(offenders)}`);
	}
	await waitForSelector(cdp, ".ann-panel.knowledge-layer");
	const annotationState = await cdp.evaluate<{ domain: string | null; hasComposer: boolean }>(`({
		domain: document.querySelector('.ann-panel.knowledge-layer')?.className.match(/knowledge-domain-([^ ]+)/)?.[1] ?? null,
		hasComposer: !!document.querySelector('.knowledge-create')
	})`);
	if (annotationState.domain !== "ue5_code" || !annotationState.hasComposer) throw new Error("代码标注面板未正确保留");

	const graphRoute = `${BASE}/?view=explore&mode=relations&source=project&file=${encodeURIComponent(fixture.file)}`;
	await cdp.evaluate(`history.pushState(null, '', ${JSON.stringify(graphRoute)}); window.dispatchEvent(new PopStateEvent('popstate'));`);
	await waitUntil(async () => !await cdp.evaluate<boolean>(`!!document.querySelector('.readonly-spec-panel')`) ? true : null, "后退路由关闭类详情");
	await cdp.evaluate(`history.pushState(null, '', ${JSON.stringify(specUrl)}); window.dispatchEvent(new PopStateEvent('popstate'));`);
	await waitForSelector(cdp, ".readonly-spec-panel");
	await waitUntil(async () => await cdp.evaluate<boolean>(`new URL(location.href).searchParams.get('spec') === ${JSON.stringify(fixture.specId)} && !!document.querySelector('.topbar-graph .spec-nav')`) ? true : null, "前进路由恢复类详情");

	await cdp.evaluate(`document.querySelector('[aria-label="打开帮助"]')?.click()`);
	await waitForSelector(cdp, '[role="dialog"][aria-label="帮助中心"]');
	await waitUntil(async () => await cdp.evaluate<boolean>(`document.activeElement?.getAttribute('aria-label') === '搜索帮助内容'`) ? true : null, "帮助中心搜索框初始焦点");
	await waitUntil(async () => await cdp.evaluate<boolean>(`document.body.innerText.includes('只读代码架构查看器')`) ? true : null, "查看器帮助内容");
	const helpLayout = await cdp.evaluate<{ dialogHeight: number; tabsHeight: number; bodyHeight: number; focusedLabel: string | null }>(`(() => {
		const dialog = document.querySelector('[role="dialog"][aria-label="帮助中心"]');
		const tabs = dialog?.querySelector('[role="tablist"]');
		const body = dialog?.querySelector('[role="tabpanel"]');
		return {
			dialogHeight: dialog?.getBoundingClientRect().height ?? 0,
			tabsHeight: tabs?.getBoundingClientRect().height ?? 0,
			bodyHeight: body?.getBoundingClientRect().height ?? 0,
			focusedLabel: document.activeElement?.getAttribute('aria-label') ?? null,
		};
	})()`);
	if (helpLayout.focusedLabel !== "搜索帮助内容" || helpLayout.tabsHeight > 64 || helpLayout.bodyHeight < helpLayout.dialogHeight * 0.4) {
		throw new Error(`帮助中心首屏空间或初始焦点异常：${JSON.stringify(helpLayout)}`);
	}
	const initialHelpTabs = await cdp.evaluate<{ selected: string; tabStops: number[] }>(`(() => {
		const tabs = Array.from(document.querySelectorAll('[aria-label="帮助内容"] [role="tab"]'));
		return { selected: tabs.find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent.trim() ?? '', tabStops: tabs.map((tab) => tab.tabIndex) };
	})()`);
	if (initialHelpTabs.selected !== "当前页面" || initialHelpTabs.tabStops.join(",") !== "0,-1,-1") throw new Error(`帮助标签页初始焦点语义异常：${JSON.stringify(initialHelpTabs)}`);
	await cdp.evaluate(`(() => { const tab = document.querySelector('[aria-label="帮助内容"] [role="tab"][aria-selected="true"]'); tab.focus(); tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); })()`);
	const movedHelpTab = await waitUntil(async () => {
		const state = await cdp.evaluate<{ selected: string; focused: string }>(`(() => ({
			selected: document.querySelector('[aria-label="帮助内容"] [role="tab"][aria-selected="true"]')?.textContent.trim() ?? '',
			focused: document.activeElement?.getAttribute('role') === 'tab' ? document.activeElement.textContent.trim() : '',
		}))()`);
		return state.selected === "事实流" && state.focused === "事实流" ? state : null;
	}, "帮助标签页方向键导航");
	if (movedHelpTab.selected !== movedHelpTab.focused) throw new Error(`帮助标签页焦点与选择状态漂移：${JSON.stringify(movedHelpTab)}`);
	await cdp.evaluate(`(() => { const tab = document.activeElement; tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); })()`);
	await waitUntil(async () => await cdp.evaluate<boolean>(`document.querySelector('[aria-label="帮助内容"] [role="tab"][aria-selected="true"]')?.textContent.trim() === '当前页面'`) ? true : null, "恢复帮助当前页面标签");

	await captureScreenshot(cdp, join(OUT_DIR, "readonly-annotations-and-help.png"));

	await navigate(cdp, `${BASE}/?view=changes`, ".changes-view");
	await waitForSelector(cdp, ".changes-summary");
	await waitForSelector(cdp, ".changes-type-facets");
	const addedEvidence = await cdp.evaluate<{ facets: number; rowCards: number; evidenceButton: boolean; overflow: number }>(`({
		facets: document.querySelectorAll('.changes-type-facets button').length,
		rowCards: document.querySelectorAll('.change-row-card').length,
		evidenceButton: Array.from(document.querySelectorAll('.change-row-actions button')).some((node) => node.textContent.trim().startsWith('证据')),
		overflow: document.documentElement.scrollWidth - window.innerWidth,
	})`);
	if (addedEvidence.facets < 3 || addedEvidence.rowCards < 1 || !addedEvidence.evidenceButton || addedEvidence.overflow > 1) throw new Error(`变化页类型切片或证据入口异常：${JSON.stringify(addedEvidence)}`);
	await cdp.evaluate(`Array.from(document.querySelectorAll('.changes-scope-switch button')).find((node) => node.textContent.trim() === '结构')?.click()`);
	await waitUntil(async () => await cdp.evaluate<boolean>(`Array.from(document.querySelectorAll('.change-row-actions button')).some((node) => Number(node.dataset.relationCount) > 0)`) ? true : null, "结构变化关系证据加载");
	await cdp.evaluate(`(() => {
		const buttons = Array.from(document.querySelectorAll('.change-row-actions button'));
		const withRelations = buttons.find((node) => Number(node.dataset.relationCount) > 0);
		(withRelations ?? buttons.find((node) => node.textContent.trim().startsWith('证据')))?.click();
	})()`);
	await waitForSelector(cdp, ".change-row-evidence");
	const changeEvidenceUrl = await waitUntil(async () => {
		const state = await cdp.evaluate<{ url: string; version: string | null; report: string | null; node: string | null }>(`(() => {
			const params = new URL(location.href).searchParams;
			return { url: location.href, version: params.get('changes_v'), report: params.get('report'), node: params.get('node') };
		})()`);
		return state.version === "1" && state.report && state.node ? state.url : null;
	}, "变化证据稳定深链");
	await captureScreenshot(cdp, join(OUT_DIR, "changes-evidence-expanded.png"));
	const evidenceDrawer = await cdp.evaluate<{ blocks: number; oneHop: boolean; semanticRelations: number; rawRelations: number }>(`({
		blocks: document.querySelectorAll('.change-row-evidence > div').length,
		oneHop: Array.from(document.querySelectorAll('.change-row-actions button')).some((node) => node.textContent.trim() === '看一跳' && !node.disabled),
		semanticRelations: document.querySelectorAll('.change-row-evidence [data-motion] .change-relation-semantic').length,
		rawRelations: Array.from(document.querySelectorAll('.change-row-evidence .change-relation-semantic')).filter((node) => /implements|inherits|depends_on|composes/.test(node.textContent)).length,
	})`);
	if (evidenceDrawer.blocks !== 3 || !evidenceDrawer.oneHop || evidenceDrawer.semanticRelations < 1 || evidenceDrawer.rawRelations > 0) throw new Error(`变化证据下钻或关系语义不完整：${JSON.stringify(evidenceDrawer)}`);
	await navigate(cdp, changeEvidenceUrl, ".change-row-evidence");
	if (!await cdp.evaluate<boolean>(`new URL(location.href).searchParams.get('changes_v') === '1' && !!document.querySelector('.change-row-card.expanded')`)) throw new Error("刷新后没有恢复变化证据深链");
	const changedReportFile = await cdp.evaluate<string | null>(`fetch('/api/change-reports').then((response) => response.json()).then((catalog) => catalog.reports.find((entry) => entry.summary.nodes.changed > 0)?.file ?? null)`);
	if (changedReportFile) {
		await navigate(cdp, `${BASE}/?view=changes&changes_v=1&report=${encodeURIComponent(changedReportFile)}&tab=changed&fact=nodes&scope=code`, ".changes-field-summary");
		const changedEvidence = await cdp.evaluate<{ fields: number; staleDrawer: boolean; rows: number }>(`({
			fields: document.querySelectorAll('.changes-field-summary span').length,
			staleDrawer: !!document.querySelector('.change-row-evidence'),
			rows: document.querySelectorAll('.change-row-card').length,
		})`);
		if (changedEvidence.fields < 1 || changedEvidence.staleDrawer || changedEvidence.rows < 1) throw new Error(`变化字段摘要或标签页状态异常：${JSON.stringify(changedEvidence)}`);
	} else {
		await cdp.evaluate(`Array.from(document.querySelectorAll('.changes-tabs button')).find((node) => node.querySelector('span')?.textContent.trim() === '修改')?.click()`);
		await waitForSelector(cdp, ".changes-empty");
	}
	await captureScreenshot(cdp, join(OUT_DIR, "changes-evidence-drilldown.png"));

	const retiredEmbed = await cdp.evaluate<{ status: number; code?: string; surface?: string }>(`fetch('/embed/ue5_code/project', { headers: { Accept: 'text/html' } }).then(async (response) => ({ status: response.status, ...(await response.json()) }))`);
	if (retiredEmbed.status !== 410 || retiredEmbed.code !== "VIEWER_SURFACE_RETIRED" || retiredEmbed.surface !== "generic-embed") {
		throw new Error(`退役嵌入入口没有稳定返回可诊断 410：${JSON.stringify(retiredEmbed)}`);
	}
	console.log("[interactive-smoke] 导航、性能预算、分支深链、变化证据与只读详情通过");
} finally {
	await session.close();
}
