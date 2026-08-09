// Real-browser visual smoke for the read-only code architecture viewer.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, captureScreenshot, findChrome, launchBrowser, resolveCodeFixture, waitForSelector, waitUntil } from "./browser-smoke-lib.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "logs", "smoke");
const chrome = findChrome();

interface PageCheck {
	name: string;
	path: string;
	windowSize?: string;
	markers: Array<{ label: string; test: (dom: string) => boolean }>;
}

function args(extra: string[], size = "1600,900"): string[] {
	return ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-first-run", "--no-default-browser-check", "--disable-background-mode", "--disable-background-networking", "--disable-component-update", "--disable-default-apps", "--mute-audio", "--force-prefers-reduced-motion=reduce", `--window-size=${size}`, "--virtual-time-budget=15000", ...extra];
}

function dom(url: string, size?: string): string {
	return execFileSync(chrome, args(["--dump-dom", url], size), { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 90_000 });
}

async function screenshot(url: string, path: string, size?: string): Promise<void> {
	const session = await launchBrowser(url, { windowSize: size });
	try {
		await waitUntil(async () => await session.cdp.evaluate<boolean>(`
			document.readyState === "complete"
			&& (document.querySelector("#root")?.childElementCount ?? 0) > 0
			&& (document.body.innerText?.trim().length ?? 0) > 50
		`) ? true : null, "截图页面内容挂载");
		await session.cdp.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 250))))");
		let lastError: unknown;
		for (let attempt = 0; attempt < 3; attempt += 1) {
			try {
				await captureScreenshot(session.cdp, path);
				return;
			} catch (error) {
				lastError = error;
				await session.cdp.evaluate("new Promise((resolve) => setTimeout(resolve, 350))");
			}
		}
		throw lastError;
	} finally {
		await session.close();
	}
}

async function mobileScreenshot(url: string, path: string, readySelector: string): Promise<void> {
	const session = await launchBrowser(url, { windowSize: "500,900" });
	try {
		await session.cdp.send("Emulation.setDeviceMetricsOverride", { width: 430, height: 900, deviceScaleFactor: 1, mobile: true });
		await waitForSelector(session.cdp, readySelector);
		if (readySelector === ".home-code-viewer") {
			await waitUntil(async () => await session.cdp.evaluate<number>(`document.querySelectorAll('.home-catalog-entry').length`) > 1 ? true : null, "移动端代码目录");
		} else if (readySelector === ".changes-view") {
			await waitForSelector(session.cdp, ".changes-summary");
			const overflow = await session.cdp.evaluate<{ amount: number; offenders: Array<{ className: string; right: number; width: number }> }>(`(() => ({
				amount: document.documentElement.scrollWidth - window.innerWidth,
				offenders: Array.from(document.querySelectorAll('*')).map((node) => { const rect = node.getBoundingClientRect(); return { className: String(node.className ?? ''), right: Math.round(rect.right), width: Math.round(rect.width) }; }).filter((item) => item.right > window.innerWidth + 1).sort((a, b) => b.right - a.right).slice(0, 6),
			}))()`);
			if (overflow.amount > 1) throw new Error(`移动端变化页横向溢出：${JSON.stringify(overflow)}`);
		} else {
			await waitForSelector(session.cdp, ".graph-controls[data-zoom-pct]");
			await waitUntil(async () => await session.cdp.evaluate<number>(`Number(document.querySelector('.graph-controls')?.dataset.zoomPct)`) <= 75 ? true : null, "移动端架构全览适配");
			const toolbar = await session.cdp.evaluate<{ overflow: number; overlaps: number }>(`(() => {
				const items = Array.from(document.querySelector('.architecture-commandbar')?.children ?? []).filter((node) => getComputedStyle(node).display !== 'none').map((node) => node.getBoundingClientRect());
				return {
					overflow: document.documentElement.scrollWidth - window.innerWidth,
					overlaps: items.flatMap((left, index) => items.slice(index + 1).map((right) => Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1 && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1)).filter(Boolean).length,
				};
			})()`);
			if (toolbar.overflow > 1 || toolbar.overlaps > 0) throw new Error(`移动端探索工具栏边界异常：${JSON.stringify(toolbar)}`);
		}
		await captureScreenshot(session.cdp, path);
	} finally {
		await session.close();
	}
}

async function engineModuleScreenshot(url: string, path: string): Promise<void> {
	const session = await launchBrowser(url, { windowSize: "1600,900" });
	try {
		await waitForSelector(session.cdp, ".engine-module-card");
		const clicked = await session.cdp.evaluate<boolean>(`(() => {
			const cards = Array.from(document.querySelectorAll('.engine-module-card'));
			const engine = cards.find((card) => card.querySelector('b')?.textContent?.trim() === 'Engine');
			if (!(engine instanceof HTMLButtonElement)) return false;
			engine.click();
			return true;
		})()`);
		if (!clicked) throw new Error("UE Runtime / Engine 模块入口不存在");
		await waitForSelector(session.cdp, ".engine-symbol-card");
		const visual = await session.cdp.evaluate<{ backgroundImage: string; borderColor: string; color: string; selected: boolean; breadcrumb: string; scopesVisible: boolean }>(`(() => {
			const card = document.querySelector('.engine-symbol-card');
			const selected = document.querySelector('.engine-module-card.active');
			const tree = document.querySelector('.engine-module-tree');
			if (!(card instanceof HTMLElement)) throw new Error('UE declaration card missing');
			const style = getComputedStyle(card);
			const treeRect = tree?.getBoundingClientRect();
			return {
				backgroundImage: style.backgroundImage,
				borderColor: style.borderColor,
				color: style.color,
				selected: selected?.querySelector('b')?.textContent?.trim() === 'Engine',
				breadcrumb: document.querySelector('.engine-symbol-breadcrumb')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
				scopesVisible: !!treeRect && Array.from(document.querySelectorAll('.engine-forest-scope')).every((scope) => {
					const rect = scope.getBoundingClientRect();
					return rect.top >= treeRect.top && rect.bottom <= treeRect.bottom;
				}),
			};
		})()`);
		if (visual.backgroundImage === "none" || visual.borderColor === "rgba(0, 0, 0, 0)" || !visual.selected || !visual.scopesVisible || !visual.breadcrumb.includes("Engine Source/Runtime/")) {
			throw new Error(`UE 声明卡视觉未加工：${JSON.stringify(visual)}`);
		}
		await captureScreenshot(session.cdp, path);
	} finally {
		await session.close();
	}
}

const fixture = await resolveCodeFixture();
const file = encodeURIComponent(fixture.file);
const spec = encodeURIComponent(fixture.specId);
const retired = ["planned-toolbar", "design-schematic-tools", "workflow-hub", "export-dialog", "task-foundry"];
const noRetiredUi = (value: string) => retired.every((marker) => !value.includes(marker));
const pages: PageCheck[] = [
	{
		name: "home",
		path: "/",
		markers: [
			{ label: "只读代码查看器首页", test: (value) => value.includes("home home-code-viewer") && value.includes("代码架构查看器") },
			{ label: "代码目录来自版本化事实缩略图", test: (value) => value.includes("home-code-catalog") && value.includes("catalog-preview-v1") },
			{ label: "主项目卡内收敛可信度证据", test: (value) => value.includes("home-project-evidence") && !value.includes("home-trust-banner") },
			{ label: "代码目录支持本地筛选", test: (value) => value.includes("home-catalog-search") && value.includes("筛选代码架构图") },
			{ label: "无创作工具 UI", test: noRetiredUi },
		],
	},
	{
		name: "architecture",
		path: "/?view=explore&mode=architecture&scope=root",
		markers: [
			{ label: "单一探索工具栏", test: (value) => value.includes("architecture-workspace mindmap-code") && value.includes("architecture-commandbar") && value.includes("architecture-explore-switch") && value.includes("architecture-scope-trigger") && value.includes("architecture-stage") && !value.includes("topbar-explore") },
			{ label: "工具面板默认不常驻", test: (value) => !value.includes('class="architecture-scope-tree"') && !value.includes('class="mindmap-relation-legend"') && !value.includes('class="architecture-selection-card') },
			{ label: "无创作工具 UI", test: noRetiredUi },
		],
	},
	{
		name: "architecture-engine",
		path: "/?view=explore&mode=architecture&scope=engine",
		markers: [
			{ label: "引擎职责范围深链", test: (value) => value.includes("data-active-scope=\"engine\"") && value.includes("引擎层") && value.includes("architecture-scope-trigger") },
			{ label: "复杂范围仍为只读架构", test: noRetiredUi },
		],
	},
	{
		name: "graph",
		path: `/?view=explore&mode=relations&source=project&file=${file}`,
		markers: [
			{ label: "代码事实画布", test: (value) => value.includes("graph-col") && value.includes("<canvas") && value.includes("只读代码事实") },
			{ label: "分层关系图与按需检视器", test: (value) => value.includes("forest-semantic-bar") && !value.includes("inspector-empty") },
			{ label: "无创作工具 UI", test: noRetiredUi },
		],
	},
	{
		name: "engine-spec-browser",
		path: `/?view=explore&mode=relations&source=engine&file=${file}`,
		markers: [
			{ label: "UE 引擎源码森林层级", test: (value) => value.includes("engine-spec-browser") && value.includes("engine-forest-root") && value.includes("engine-forest-branches") },
			{ label: "森林索引与声明卡保留各自优势", test: (value) => value.includes("engine-module-card") && value.includes("engine-spec-shortcuts") },
			{ label: "无创作工具 UI", test: noRetiredUi },
		],
	},
	{
		name: "spec",
		path: `/?view=explore&mode=relations&source=project&file=${file}&spec=${spec}`,
		markers: [
			{ label: "只读类详情", test: (value) => value.includes("readonly-spec-panel") && value.includes("代码事实") },
			{ label: "工程标注入口", test: (value) => value.includes("ann-panel knowledge-layer knowledge-domain-ue5_code") && value.includes("工程标注") },
			{ label: "无编辑与导出入口", test: noRetiredUi },
		],
	},
	{
		name: "api",
		path: `/?view=explore&mode=api&source=all&file=${file}`,
		markers: [
			{ label: "统一代码工作区 API 视图", test: (value) => value.includes("api-view api-landing-view") && value.includes("当前范围") && value.includes("code-workspace-switches") },
			{ label: "无创作工具 UI", test: noRetiredUi },
		],
	},
	{
		name: "changes",
		path: "/?view=changes",
		markers: [
			{ label: "版本化代码变化", test: (value) => value.includes("changes-view") && value.includes("VERSIONED EVIDENCE") && value.includes("一跳影响") },
			{ label: "基线可信度显式呈现", test: (value) => value.includes("无可验证指纹") && value.includes("与活动图指纹一致") },
			{ label: "节点与关系不再混算", test: (value) => value.includes("changes-fact-toolbar") && value.includes("节点 ·") && value.includes("默认聚焦类型与函数") },
			{ label: "类型切片与证据下钻", test: (value) => value.includes("changes-type-facets") && value.includes("change-row-card") && value.includes("看一跳") },
			{ label: "无计划和实现状态", test: noRetiredUi },
		],
	},
	{
		name: "retired-route",
		path: "/?view=delivery",
		markers: [
			{ label: "旧入口确定性降级", test: (value) => value.includes("创作工具已迁出 GraphBrain") && value.includes("ClaudeGameStudios") },
			{ label: "不挂载旧页面", test: noRetiredUi },
		],
	},
	{
		name: "mobile-home",
		path: "/",
		windowSize: "430,900",
		markers: [
			{ label: "窄屏仍为代码查看器", test: (value) => value.includes("home home-code-viewer") && value.includes("代码架构查看器") },
			{ label: "窄屏保留目录筛选", test: (value) => value.includes("home-catalog-search") },
			{ label: "窄屏无创作工具 UI", test: noRetiredUi },
		],
	},
	{
		name: "mobile-architecture",
		path: "/?view=explore&mode=architecture&scope=root",
		windowSize: "430,900",
		markers: [
			{ label: "窄屏范围入口按需展开", test: (value) => value.includes("architecture-scope-trigger") && value.includes("当前范围") && !value.includes('class="architecture-scope-tree"') },
			{ label: "窄屏保留聚焦画布", test: (value) => value.includes("mindmap-canvas") && value.includes("<canvas") },
			{ label: "窄屏无创作工具 UI", test: noRetiredUi },
		],
	},
	{
		name: "mobile-changes",
		path: "/?view=changes",
		windowSize: "430,900",
		markers: [
			{ label: "窄屏保留变化证据", test: (value) => value.includes("changes-view") && value.includes("changes-summary") && value.includes("changes-tabs") },
			{ label: "窄屏无创作工具 UI", test: noRetiredUi },
		],
	},
];

mkdirSync(OUT_DIR, { recursive: true });
const failures: string[] = [];
for (const page of pages) {
	const url = `${BASE}${page.path}`;
	const rendered = dom(url, page.windowSize);
	for (const marker of page.markers) {
		const passed = marker.test(rendered);
		console.log(`${passed ? "✓" : "✗"} ${page.name}: ${marker.label}`);
		if (!passed) failures.push(`${page.name}: ${marker.label}`);
	}
	if (page.name === "mobile-home") await mobileScreenshot(url, join(OUT_DIR, `${page.name}.png`), ".home-code-viewer");
	else if (page.name === "mobile-architecture") await mobileScreenshot(url, join(OUT_DIR, `${page.name}.png`), ".architecture-workspace");
	else if (page.name === "mobile-changes") await mobileScreenshot(url, join(OUT_DIR, `${page.name}.png`), ".changes-view");
	else await screenshot(url, join(OUT_DIR, `${page.name}.png`), page.windowSize);
}

await engineModuleScreenshot(
	`${BASE}/?view=explore&mode=relations&source=engine&file=${file}`,
	join(OUT_DIR, "engine-spec-module-selected.png"),
);

if (failures.length) throw new Error(`视觉冒烟失败：\n${failures.map((item) => `- ${item}`).join("\n")}`);
console.log(`[visual-smoke] ${pages.length} 个只读视图通过`);
