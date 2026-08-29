import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

test("the active shell exposes only read-only code architecture destinations", () => {
	const app = read("viewer/src/App.tsx");
	const home = read("viewer/components/home/HomeView.tsx");
	const workspace = read("viewer/components/graph-view/GraphWorkspaceView.tsx");
	const evidenceBadge = read("viewer/components/common/EvidenceStatusBadge.tsx");
	const evidenceStatus = read("viewer/src/evidenceStatus.ts");
	for (const destination of ['"home"', '"architecture"', '"graph"', '"api"', '"changes"']) {
		assert.equal(app.includes(destination), true, `missing active destination ${destination}`);
	}
	for (const retiredIdentifier of [
		"designDeliveryOpen", "pendingExportFile", "codeWorkflow", "useWorkbench",
		"plannedGraph", "TimelineBar", "DesignEditToolbar", "TaskPackage",
	]) {
		assert.equal((app + home + workspace).includes(retiredIdentifier), false, `retired identifier leaked: ${retiredIdentifier}`);
	}
	assert.equal(app.includes("EvidenceStatusBadge"), true, "the active shell must retain the canonical project evidence entry");
	assert.equal(evidenceBadge.includes("只读代码事实"), true);
	for (const label of [">总览<", ">探索<", ">变化<"]) assert.equal(app.includes(label), true, `missing top-level IA label ${label}`);
	assert.equal(home.includes("ClaudeGameStudios"), true);
	assert.equal(home.includes("relativeTime(entry.updated_at)"), false, "file mtime must not be presented as fact freshness");
	assert.equal(home.includes("home-project-evidence"), true, "project trust evidence must live inside the primary workset card");
	assert.equal(home.includes("home-trust-banner"), false, "duplicate project trust banner must stay retired");
	assert.equal(home.includes("resolveEvidenceStatus(entry)"), true, "the primary card must use the canonical freshness presentation boundary");
	assert.equal(evidenceStatus.includes("来源未验证"), true);
	assert.equal(home.includes("重新检查"), true);
});

test("deleted authoring components and adapters do not remain as duplicate entry points", () => {
	for (const path of [
		"viewer/components/brief",
		"viewer/components/design",
		"viewer/components/workflows",
		"viewer/components/topbar",
		"adapters/design",
		"adapters/level-design",
		"adapters/narrative",
		"adapters/quest",
		"adapters/ue5-planned",
		"core/design-delivery",
		"core/extraction",
		"core/gdd-impact",
	]) assert.equal(existsSync(join(ROOT, path)), false, `${path} should be deleted`);
});

test("package commands cannot recreate retired plans, design packages, or task packages", () => {
	const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string>; dependencies: Record<string, string> };
	for (const script of [
		"extract:design", "prepare:claude-extraction", "ingest:claude-extraction",
		"export:task-package", "export:design-package", "plan:audit", "build:design-mindmap",
		"registry:rebuild", "doc-registry:scan", "gdd-impact", "smoke:design-delivery",
	]) assert.equal(script in pkg.scripts, false, `retired script remains: ${script}`);
	assert.equal("marked" in pkg.dependencies, false, "documentation authoring renderer should not ship");
});

test("help and keyboard definitions share the viewer-only navigation contract", () => {
	const app = read("viewer/src/App.tsx");
	const help = read("viewer/components/help/HelpCenter.tsx");
	const shortcuts = read("viewer/src/shortcutCatalog.ts");
	assert.equal((app.match(/className="rail-btn rail-help"/g) ?? []).length, 1);
	assert.equal(help.includes("shortcutHelpGroups(view)"), true);
	assert.equal(help.includes("ClaudeGameStudios"), true);
	for (const key of ["overview", "exploreArchitecture", "exploreRelations", "changes", "exploreApi", "search", "help"]) {
		assert.match(shortcuts, new RegExp(`\\b${key}:`));
	}
	for (const retired of ["design", "planning", "review", "delivery"]) {
		assert.equal(new RegExp(`\\b${retired}:`).test(shortcuts), false);
	}
});

test("runtime and workspace surfaces retain recoverable loading boundaries", () => {
	const app = read("viewer/src/App.tsx");
	const workspace = read("viewer/components/graph-view/GraphWorkspaceView.tsx");
	const main = read("viewer/src/main.tsx");
	const boundary = read("viewer/components/common/AsyncSurface.tsx");
	const css = read("viewer/styles/async-surface.css");
	assert.equal(main.includes("<AppRuntimeBoundary><App /></AppRuntimeBoundary>"), true);
	assert.equal((app + workspace).includes("<AsyncSurface"), true);
	assert.equal(boundary.includes("static getDerivedStateFromError"), true);
	assert.equal(boundary.includes("previous.resetKey !== this.props.resetKey"), true);
	assert.equal(css.includes(".async-state-root"), true);
	assert.equal(css.includes("@media (forced-colors: active)"), true);
});
