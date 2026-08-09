// Interaction smoke: navigation, read-only class facts, annotations and help.
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { VIEWER_PERFORMANCE_BUDGETS, VIEWER_PERFORMANCE_NAMES } from "../viewer/src/viewerPerformance.js";
import { BASE, captureScreenshot, launchBrowser, navigate, resolveCodeFixture, waitForSelector, waitUntil } from "./browser-smoke-lib.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "logs", "smoke");
const fixture = await resolveCodeFixture();
const session = await launchBrowser(`${BASE}/`);

try {
	const { cdp } = session;
	mkdirSync(OUT_DIR, { recursive: true });
	await waitForSelector(cdp, ".home-code-viewer");
	const initialHomeCards = await waitUntil(async () => {
		const count = await cdp.evaluate<number>(`document.querySelectorAll('.home-catalog-entry').length`);
		return count >= 2 ? count : null;
	}, "首页代码目录加载");
	if (initialHomeCards < 2) throw new Error("首页代码目录没有足够的筛选夹具");
	const homeHierarchy = await cdp.evaluate<{ primary: number; references: number; referencePreviews: number; evidence: number; duplicateTrust: number }>(`({
		primary: document.querySelectorAll('.home-primary-list .home-doc.primary').length,
		references: document.querySelectorAll('.home-reference-list .home-reference-entry').length,
		referencePreviews: document.querySelectorAll('.home-reference-list .home-card-preview').length,
		evidence: document.querySelectorAll('.home-primary-list .home-project-evidence').length,
		duplicateTrust: document.querySelectorAll('.home-trust-banner').length,
	})`);
	if (homeHierarchy.primary !== 1 || homeHierarchy.references < 1 || homeHierarchy.referencePreviews !== 0 || homeHierarchy.evidence !== 1 || homeHierarchy.duplicateTrust !== 0) throw new Error(`首页事实层级或可信度入口没有收敛：${JSON.stringify(homeHierarchy)}`);
	const initialDataRequests = await cdp.evaluate<string[]>(`performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname).filter((path) => path.startsWith('/data/graphs/') || path === '/api/engine-catalog')`);
	if (initialDataRequests.length > 0) throw new Error(`首页提前加载了重型代码事实：${JSON.stringify(initialDataRequests)}`);
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
	await cdp.evaluate(`Array.from(document.querySelectorAll('.rail-btn')).find((node) => node.textContent.includes('探索'))?.click()`);
	await waitForSelector(cdp, ".architecture-workspace");
	const projectGraphPath = `/data/graphs/${encodeURIComponent(fixture.file)}`;
	const architectureProjectPreload = await cdp.evaluate<boolean>(`performance.getEntriesByType('resource').some((entry) => new URL(entry.name).pathname === ${JSON.stringify(`/data/graphs/${encodeURIComponent(fixture.file)}`)})`);
	if (architectureProjectPreload) throw new Error(`架构画布提前加载了项目事实图：${projectGraphPath}`);
	const architectureRoute = await cdp.evaluate<{ view: string | null; mode: string | null }>(`(() => { const params = new URL(location.href).searchParams; return { view: params.get('view'), mode: params.get('mode') }; })()`);
	if (architectureRoute.view !== "explore" || architectureRoute.mode !== "architecture") throw new Error(`架构导航没有同步规范 URL：${JSON.stringify(architectureRoute)}`);
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
	await waitForSelector(cdp, ".graph-controls[data-zoom-pct]");
	const rootZoom = await waitUntil(async () => {
		const zoom = await cdp.evaluate<number>(`Number(document.querySelector('.graph-controls')?.dataset.zoomPct)`);
		return zoom >= 108 ? zoom : null;
	}, "根范围初始视口");
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
	await waitUntil(async () => Math.abs(await cdp.evaluate<number>(`Number(document.querySelector('.graph-controls')?.dataset.zoomPct)`) - rootZoom) <= 2 ? true : null, "受限全图适配");
	const canvasBeforeScopePanel = await cdp.evaluate<{ width: number; height: number }>(`(() => {
		const rect = document.querySelector('.mindmap-canvas').getBoundingClientRect();
		return { width: rect.width, height: rect.height };
	})()`);
	await cdp.evaluate(`document.querySelector('.architecture-scope-trigger')?.click()`);
	await waitUntil(async () => await cdp.evaluate<number>(`document.querySelectorAll('.architecture-scope-tree button').length`) >= 3 ? true : null, "按需架构范围面板加载");
	const scopeOverlay = await cdp.evaluate<{ position: string; width: number; height: number; currentRoot: boolean; branchTones: number; hasEndBranches: boolean; hasContinuations: boolean }>(`(() => {
		const panel = document.querySelector('.architecture-scope-panel');
		const canvas = document.querySelector('.mindmap-canvas').getBoundingClientRect();
		return {
			position: getComputedStyle(panel).position,
			width: canvas.width,
			height: canvas.height,
			currentRoot: document.querySelector('.architecture-scope-tree [data-scope-id="root"]')?.getAttribute('aria-current') === 'page',
			branchTones: new Set(Array.from(document.querySelectorAll('.architecture-tree-branch')).map((node) => node.getAttribute('data-tone'))).size,
			hasEndBranches: !!document.querySelector('.architecture-tree-branch[data-segment="elbow-end"]'),
			hasContinuations: !!document.querySelector('.architecture-tree-branch[data-segment="continuation"],.architecture-tree-branch[data-segment="elbow-through"]'),
		};
	})()`);
	if (scopeOverlay.position !== "absolute" || !scopeOverlay.currentRoot || scopeOverlay.branchTones < 2 || !scopeOverlay.hasEndBranches || !scopeOverlay.hasContinuations || Math.abs(scopeOverlay.width - canvasBeforeScopePanel.width) > 1 || Math.abs(scopeOverlay.height - canvasBeforeScopePanel.height) > 1) {
		throw new Error(`范围面板挤压了画布：${JSON.stringify({ canvasBeforeScopePanel, scopeOverlay })}`);
	}
	await captureScreenshot(cdp, join(OUT_DIR, "architecture-scope-panel.png"));
	await cdp.evaluate(`document.querySelector('.architecture-scope-tree [data-scope-id="engine"]')?.click()`);
	await waitUntil(async () => await cdp.evaluate<boolean>(`new URL(location.href).searchParams.get('scope') === 'engine' && document.querySelector('.architecture-stage')?.getAttribute('data-active-scope') === 'engine' && !document.querySelector('.architecture-scope-panel')`) ? true : null, "架构范围直接导航");
	const engineZoom = await waitUntil(async () => {
		const zoom = await cdp.evaluate<number>(`Number(document.querySelector('.graph-controls')?.dataset.zoomPct)`);
		return zoom < rootZoom - 10 ? zoom : null;
	}, "切换 scope 后重新适配视口");
	if (engineZoom < 45) throw new Error(`引擎范围被过度缩小：${engineZoom}%`);
	await cdp.evaluate(`document.querySelector('.architecture-scope-trigger')?.click()`);
	await waitForSelector(cdp, ".architecture-scope-tree [data-scope-id=\"root\"]");
	await cdp.evaluate(`document.querySelector('.architecture-scope-tree [data-scope-id="root"]')?.click()`);
	await waitUntil(async () => {
		const state = await cdp.evaluate<{ root: boolean; zoom: number }>(`({
			root: document.querySelector('.architecture-stage')?.getAttribute('data-active-scope') === 'root',
			zoom: Number(document.querySelector('.graph-controls')?.dataset.zoomPct),
		})`);
		return state.root && Math.abs(state.zoom - rootZoom) <= 2 ? true : null;
	}, "返回 scope 后恢复独立视口");
	const canvasBeforeLegend = await cdp.evaluate<string>(`JSON.stringify(document.querySelector('.mindmap-canvas').getBoundingClientRect().toJSON())`);
	await cdp.evaluate(`document.querySelector('.architecture-tool-button[aria-controls="architecture-legend-panel"]')?.click()`);
	await waitForSelector(cdp, ".architecture-legend-panel .mindmap-relation-legend");
	const legendOverlay = await cdp.evaluate<{ position: string; canvas: string }>(`({
		position: getComputedStyle(document.querySelector('.architecture-legend-panel')).position,
		canvas: JSON.stringify(document.querySelector('.mindmap-canvas').getBoundingClientRect().toJSON()),
	})`);
	if (legendOverlay.position !== "absolute" || legendOverlay.canvas !== canvasBeforeLegend) throw new Error(`关系图例挤压了画布：${JSON.stringify(legendOverlay)}`);
	await cdp.evaluate(`document.querySelector('.architecture-tool-button[aria-controls="architecture-legend-panel"]')?.click()`);
	await waitUntil(async () => !await cdp.evaluate<boolean>(`!!document.querySelector('.architecture-legend-panel')`) ? true : null, "关闭关系图例");

	await cdp.evaluate(`Array.from(document.querySelectorAll('.architecture-explore-switch button')).find((node) => node.textContent.trim() === '关系')?.click()`);
	await waitForSelector(cdp, ".graph-col");
	await waitForSelector(cdp, ".forest-semantic-bar");
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
	await navigate(cdp, `${BASE}/?view=explore&mode=relations&source=project&file=${encodeURIComponent(fixture.file)}`, ".forest-semantic-bar");
	await waitUntil(async () => {
		const state = await cdp.evaluate<{ branch: string | null; detail: boolean }>(`(() => ({
			branch: new URL(location.href).searchParams.get('branch'),
			detail: !!document.querySelector('.detail-panel'),
		}))()`);
		return !state.branch && !state.detail ? true : null;
	}, "分支验证后恢复森林根态");
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

	await cdp.evaluate(`document.querySelector('[aria-label="打开帮助"]')?.click()`);
	await waitForSelector(cdp, '[role="dialog"][aria-label="帮助中心"]');
	await waitUntil(async () => await cdp.evaluate<boolean>(`document.body.innerText.includes('只读代码架构查看器')`) ? true : null, "查看器帮助内容");

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
	await cdp.evaluate(`Array.from(document.querySelectorAll('.change-row-actions button')).find((node) => node.textContent.trim().startsWith('证据'))?.click()`);
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
	await cdp.evaluate(`Array.from(document.querySelectorAll('.changes-tabs button')).find((node) => node.querySelector('span')?.textContent.trim() === '修改')?.click()`);
	await waitForSelector(cdp, ".changes-field-summary");
	const changedEvidence = await cdp.evaluate<{ fields: number; staleDrawer: boolean; rows: number }>(`({
		fields: document.querySelectorAll('.changes-field-summary span').length,
		staleDrawer: !!document.querySelector('.change-row-evidence'),
		rows: document.querySelectorAll('.change-row-card').length,
	})`);
	if (changedEvidence.fields < 1 || changedEvidence.staleDrawer || changedEvidence.rows < 1) throw new Error(`变化字段摘要或标签页状态异常：${JSON.stringify(changedEvidence)}`);
	await captureScreenshot(cdp, join(OUT_DIR, "changes-evidence-drilldown.png"));
	console.log("[interactive-smoke] 导航、性能预算、分支深链、变化证据与只读详情通过");
} finally {
	await session.close();
}
