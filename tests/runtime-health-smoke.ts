// Cross-workspace runtime gate: uncaught exceptions and console errors must stay at zero.
import { BASE, delay, launchBrowser, navigate, resolveCodeFixture, waitForSelector } from "./browser-smoke-lib.js";

const fixture = await resolveCodeFixture();
const session = await launchBrowser("about:blank");
const diagnostics: string[] = [];

try {
	const { cdp } = session;
	cdp.on<{ exceptionDetails?: { text?: string; url?: string; lineNumber?: number; exception?: { description?: string; value?: unknown } } }>("Runtime.exceptionThrown", ({ exceptionDetails }) => {
		const detail = exceptionDetails?.exception?.description ?? exceptionDetails?.exception?.value ?? exceptionDetails?.text ?? "unknown exception";
		diagnostics.push(`exception: ${String(detail)} @ ${exceptionDetails?.url ?? "unknown"}:${exceptionDetails?.lineNumber ?? 0}`);
	});
	cdp.on<{ type?: string; args?: Array<{ value?: unknown; description?: string }> }>("Runtime.consoleAPICalled", ({ type, args }) => {
		if (type !== "error" && type !== "assert") return;
		diagnostics.push(`console.${type}: ${(args ?? []).map((arg) => String(arg.value ?? arg.description ?? "")).join(" ")}`);
	});
	await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `
		window.__graphBrainRuntimeProblems = [];
		window.addEventListener('error', (event) => window.__graphBrainRuntimeProblems.push('error: ' + (event.message || 'unknown')));
		window.addEventListener('unhandledrejection', (event) => window.__graphBrainRuntimeProblems.push('rejection: ' + String(event.reason?.stack || event.reason || 'unknown')));
	` });

	const routes = [
		{ label: "home", path: "/", selector: ".home-code-viewer" },
		{ label: "architecture", path: "/?view=explore&mode=architecture", selector: ".architecture-commandbar" },
		{ label: "relations", path: `/?view=explore&mode=relations&source=project&file=${encodeURIComponent(fixture.file)}`, selector: '.graph-wrap[data-layout-capability="forest"]' },
		{ label: "api", path: `/?view=explore&mode=api&source=project&file=${encodeURIComponent(fixture.file)}`, selector: ".api-view" },
		{ label: "changes", path: "/?view=changes", selector: ".changes-view" },
	] as const;
	for (const route of routes) {
		await navigate(cdp, `${BASE}${route.path}`, route.selector);
		if (route.label === "changes") await waitForSelector(cdp, ".change-row-card");
		await delay(250);
		const pageProblems = await cdp.evaluate<string[]>("window.__graphBrainRuntimeProblems ?? []");
		for (const problem of pageProblems) diagnostics.push(`${route.label}: ${problem}`);
	}

	if (diagnostics.length > 0) throw new Error(`运行时诊断不为空：${JSON.stringify([...new Set(diagnostics)])}`);
	console.log(`[runtime-health-smoke] 通过：${routes.map((route) => route.label).join("、")} 均无未捕获异常或 console.error`);
} finally {
	await session.close();
}
