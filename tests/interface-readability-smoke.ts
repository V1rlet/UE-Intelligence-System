// Computed-style gate for the denser typography used by overview and change entries.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BASE, captureScreenshot, launchBrowser, navigate, waitForSelector, waitUntil } from "./browser-smoke-lib.js";
import { resolveSmokeOutputDirectory } from "./smoke-artifacts.js";

const OUT_DIR = resolveSmokeOutputDirectory("readability");

type ReadabilitySnapshot = {
	fonts: Record<string, number | null>;
	overflow: number;
};

type DpiCase = {
	name: string;
	physicalWidth: number;
	physicalHeight: number;
	scale: number;
};

type LayoutSnapshot = {
	viewport: { width: number; height: number; scale: number };
	pageOverflow: number;
	componentOverflow: Record<string, number | null>;
	overlaps: string[];
};

const DPI_CASES: DpiCase[] = [
	{ name: "1366x768-125", physicalWidth: 1366, physicalHeight: 768, scale: 1.25 },
	{ name: "1920x1080-150", physicalWidth: 1920, physicalHeight: 1080, scale: 1.5 },
	{ name: "3840x2160-150", physicalWidth: 3840, physicalHeight: 2160, scale: 1.5 },
];

function assertMinimums(label: string, snapshot: ReadabilitySnapshot, minimums: Record<string, number>): void {
	for (const [name, minimum] of Object.entries(minimums)) {
		const actual = snapshot.fonts[name];
		if (actual === null || actual < minimum) {
			throw new Error(`${label} 的 ${name} 字号异常：期望 >= ${minimum}px，实际 ${actual ?? "missing"}`);
		}
	}
	if (snapshot.overflow > 1) throw new Error(`${label} 放大字体后发生 ${snapshot.overflow}px 横向溢出`);
}

function snapshotExpression(selectors: Record<string, string>): string {
	return `(() => {
		const selectors = ${JSON.stringify(selectors)};
		const fonts = Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
			const element = document.querySelector(selector);
			return [name, element ? Number.parseFloat(getComputedStyle(element).fontSize) : null];
		}));
		return { fonts, overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth) };
	})()`;
}

function layoutExpression(components: Record<string, string>, overlapGroups: Record<string, string>): string {
	return `(() => {
		const components = ${JSON.stringify(components)};
		const overlapGroups = ${JSON.stringify(overlapGroups)};
		const visible = (element) => {
			if (!(element instanceof HTMLElement)) return false;
			const style = getComputedStyle(element);
			const rect = element.getBoundingClientRect();
			return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
		};
		const overlaps = [];
		for (const [group, selector] of Object.entries(overlapGroups)) {
			const elements = Array.from(document.querySelectorAll(selector)).filter(visible);
			for (let i = 0; i < elements.length; i += 1) for (let j = i + 1; j < elements.length; j += 1) {
				const a = elements[i].getBoundingClientRect();
				const b = elements[j].getBoundingClientRect();
				const intersectionWidth = Math.min(a.right, b.right) - Math.max(a.left, b.left);
				const intersectionHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
				if (intersectionWidth > 1 && intersectionHeight > 1) overlaps.push(group + ':' + i + '-' + j);
			}
		}
		return {
			viewport: { width: innerWidth, height: innerHeight, scale: devicePixelRatio },
			pageOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
			componentOverflow: Object.fromEntries(Object.entries(components).map(([name, selector]) => {
				const element = document.querySelector(selector);
				return [name, element instanceof HTMLElement ? Math.max(0, element.scrollWidth - element.clientWidth) : null];
			})),
			overlaps,
		};
	})()`;
}

function assertLayout(label: string, snapshot: LayoutSnapshot): void {
	for (const [component, overflow] of Object.entries(snapshot.componentOverflow)) {
		if (overflow === null) throw new Error(`${label} 的布局监控组件 ${component} 不在 DOM 中（覆盖收缩即失败）：${JSON.stringify(snapshot)}`);
		if (overflow > 1) throw new Error(`${label} 的 ${component} 发生 ${overflow}px 内部溢出：${JSON.stringify(snapshot)}`);
	}
	if (snapshot.overlaps.length > 0) throw new Error(`${label} 工具栏项目重叠：${JSON.stringify(snapshot)}`);
}

mkdirSync(OUT_DIR, { recursive: true });
const session = await launchBrowser(`${BASE}/`, { windowSize: "1440,900" });
try {
	await waitForSelector(session.cdp, ".home-primary-list .home-doc-name");
	await waitUntil(async () => await session.cdp.evaluate<number>("document.querySelectorAll('.home-catalog-entry').length") >= 1 ? true : null, "总览目录条目");
	const home = await session.cdp.evaluate<ReadabilitySnapshot>(snapshotExpression({
		primaryTitle: ".home-primary-list .home-doc-name",
		primaryEvidence: ".home-primary-list .home-project-evidence strong",
		primaryMeta: ".home-primary-list .home-project-evidence small",
	}));
	assertMinimums("总览条目", home, {
		primaryTitle: 18,
		primaryEvidence: 13,
		primaryMeta: 11,
	});
	await captureScreenshot(session.cdp, join(OUT_DIR, "readability-home.png"));

	await navigate(session.cdp, `${BASE}/?view=changes`, ".changes-view");
	await waitForSelector(session.cdp, ".change-row-card");
	await session.cdp.evaluate("document.querySelector('.change-row-actions button')?.click()");
	await waitForSelector(session.cdp, ".change-row-evidence");
	const changes = await session.cdp.evaluate<ReadabilitySnapshot>(snapshotExpression({
		tabTitle: ".changes-tabs button span",
		tabMeta: ".changes-tabs button small",
		kind: ".change-kind",
		rowTitle: ".change-identity strong",
		rowMeta: ".change-identity code",
		action: ".change-row-actions button",
		evidenceLabel: ".change-row-evidence small",
		evidenceBody: ".change-row-evidence strong",
		evidenceMeta: ".change-row-evidence > div > code",
	}));
	assertMinimums("变化条目", changes, {
		tabTitle: 13,
		tabMeta: 10,
		kind: 10,
		rowTitle: 13,
		rowMeta: 11,
		action: 11,
		evidenceLabel: 10,
		evidenceBody: 12,
		evidenceMeta: 11,
	});
	await captureScreenshot(session.cdp, join(OUT_DIR, "readability-changes.png"));

	await navigate(session.cdp, `${BASE}/?view=changes&changes_v=1&report=missing-report.json&tab=changed&fact=edges&change_scope=all&module=Ghost&type=uactor&node=Old`, ".changes-route-diagnostics");
	const repairedRoute = await waitUntil(async () => {
		const state = await session.cdp.evaluate<{ report: string | null; tab: string | null; fact: string | null; scope: string | null; notice: string; overflow: number }>(`(() => {
			const params = new URL(location.href).searchParams;
			return {
				report: params.get('report'),
				tab: params.get('tab'),
				fact: params.get('fact'),
				scope: params.get('change_scope'),
				notice: document.querySelector('.changes-route-diagnostics')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
				overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
			};
		})()`);
		return state.report && state.report !== "missing-report.json" ? state : null;
	}, "失效变化链接归一化");
	if (repairedRoute.tab !== "added" || repairedRoute.fact !== "nodes" || repairedRoute.scope !== "code" || !repairedRoute.notice.includes("变化报告已不可用") || repairedRoute.overflow > 1) {
		throw new Error(`失效变化链接没有安全降级并说明原因：${JSON.stringify(repairedRoute)}`);
	}
	await captureScreenshot(session.cdp, join(OUT_DIR, "changes-route-diagnostic.png"));

	const dpiMatrix: Record<string, { home: LayoutSnapshot; changes: LayoutSnapshot; architecture: LayoutSnapshot }> = {};
	for (const dpiCase of DPI_CASES) {
		const width = Math.floor(dpiCase.physicalWidth / dpiCase.scale);
		const height = Math.floor(dpiCase.physicalHeight / dpiCase.scale);
		await session.cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpiCase.scale, mobile: false });

		await navigate(session.cdp, `${BASE}/`, ".home-primary-list .home-doc-name");
		const homeLayout = await session.cdp.evaluate<LayoutSnapshot>(layoutExpression({
			primaryList: ".home-primary-list",
		}, {}));
		assertLayout(`${dpiCase.name} 总览`, homeLayout);

		await navigate(session.cdp, `${BASE}/?view=changes`, ".changes-view");
		await waitForSelector(session.cdp, ".changes-fact-toolbar");
		const changesLayout = await session.cdp.evaluate<LayoutSnapshot>(layoutExpression({
			hero: ".changes-hero",
			factToolbar: ".changes-fact-toolbar",
			tabs: ".changes-tabs",
		}, {
			hero: ".changes-hero > *",
			factToolbar: ".changes-fact-toolbar > *",
		}));
		assertLayout(`${dpiCase.name} 变化`, changesLayout);

		await navigate(session.cdp, `${BASE}/?view=architecture`, ".architecture-commandbar");
		const architectureLayout = await session.cdp.evaluate<LayoutSnapshot>(layoutExpression({
			commandbar: ".architecture-commandbar",
		}, {
			commandbar: ".architecture-commandbar > *",
		}));
		assertLayout(`${dpiCase.name} 探索工具栏`, architectureLayout);

		dpiMatrix[dpiCase.name] = { home: homeLayout, changes: changesLayout, architecture: architectureLayout };
		if (dpiCase === DPI_CASES[0]) {
			await captureScreenshot(session.cdp, join(OUT_DIR, `dpi-${dpiCase.name}-architecture.png`));
		}
		if (dpiCase === DPI_CASES[DPI_CASES.length - 1]) {
			await navigate(session.cdp, `${BASE}/?view=changes`, ".changes-view");
			await captureScreenshot(session.cdp, join(OUT_DIR, `dpi-${dpiCase.name}-changes.png`));
		}
	}
	await session.cdp.send("Emulation.clearDeviceMetricsOverride");

	console.log(`[interface-readability-smoke] 通过：${JSON.stringify({ home, changes, repairedRoute, dpiMatrix })}`);
} finally {
	await session.close();
}
