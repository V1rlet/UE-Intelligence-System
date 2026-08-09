import {
	defaultCodeLens,
	isCodeLens,
	isCodeSource,
	normalizeCodeWorkspace,
	type CodeLens,
	type CodeSource,
} from "./codeWorkspaceModel";
import type { ChangeNodeSummary, ChangeReport } from "../../core/query/change-report";
import {
	asChangeReportQueryIndex,
	type ChangeReportQueryIndex,
} from "../../core/query/change-report-query";

export type AppView = "home" | "code" | "architecture" | "changes";
export type ChangeRouteTab = "added" | "changed" | "removed" | "impact";
export type ChangeRouteFact = "nodes" | "edges";
export type ChangeRouteScope = "code" | "structure" | "all";

export interface ChangeEvidenceRoute {
	report: string | null;
	tab: ChangeRouteTab;
	fact: ChangeRouteFact;
	scope: ChangeRouteScope;
	module: string | null;
	nodeType: string | null;
	node: string | null;
}

export type ChangeRouteDiagnosticCode =
	| "unsupported-version"
	| "unversioned-state"
	| "invalid-parameter"
	| "missing-report"
	| "missing-module"
	| "missing-type"
	| "missing-node";

export interface ChangeRouteDiagnostic {
	code: ChangeRouteDiagnosticCode;
	title: string;
	detail: string;
	requested: string;
}

export interface ChangeRouteResolution {
	route: ChangeEvidenceRoute;
	diagnostics: ChangeRouteDiagnostic[];
}

export const DEFAULT_CHANGE_EVIDENCE_ROUTE: ChangeEvidenceRoute = {
	report: null,
	tab: "added",
	fact: "nodes",
	scope: "code",
	module: null,
	nodeType: null,
	node: null,
};

export interface AppDeepLink {
	view: AppView;
	file: string | null;
	spec: string | null;
	focus: string | null;
	forestBranch: string | null;
	changes: ChangeEvidenceRoute;
	changeDiagnostics: ChangeRouteDiagnostic[];
	codeSource: CodeSource;
	codeLens: CodeLens;
	architectureScope: string | null;
	issue: { kind: "unknown-view" | "retired-view"; value: string } | null;
}

const INTERNAL_VIEWS = new Set<AppView>(["home", "code", "architecture", "changes"]);
const CANONICAL_VIEWS = new Set(["overview", "explore", "changes"]);
const LEGACY_CODE_VIEWS = new Set(["graph", "api"]);
const RETIRED_VIEWS = new Set([
	"atlas",
	"design-delivery",
	"delivery",
	"docs",
	"planning",
	"review",
]);
export const FOREST_ROUTE_VERSION = 1 as const;
export const CHANGE_EVIDENCE_ROUTE_VERSION = 1 as const;

const CHANGE_TABS = new Set<ChangeRouteTab>(["added", "changed", "removed", "impact"]);
const CHANGE_FACTS = new Set<ChangeRouteFact>(["nodes", "edges"]);
const CHANGE_SCOPES = new Set<ChangeRouteScope>(["code", "structure", "all"]);
const CHANGE_ROUTE_FIELDS = ["report", "tab", "fact", "change_scope", "module", "type", "node"] as const;

function nonEmptyParam(params: URLSearchParams, name: string): string | null {
	const value = params.get(name)?.trim();
	return value ? value : null;
}

/** Central normalization boundary for active and retired deep links. */
export function resolveAppDeepLink(search: string): AppDeepLink {
	const params = new URLSearchParams(search);
	const requestedView = params.get("view");
	const retiredView = requestedView !== null && RETIRED_VIEWS.has(requestedView);
	const retiredDesignLink = params.get("design_delivery") === "open" || params.get("mindmap_kind") === "design";
	const legacyCodeMindmap = params.get("mindmap") === "open" && !retiredDesignLink;
	const retired = retiredView || retiredDesignLink;
	const legacyCodeView = requestedView !== null && LEGACY_CODE_VIEWS.has(requestedView);
	const view: AppView = retired
		? "home"
		: legacyCodeMindmap
			? "architecture"
			: requestedView === "overview"
				? "home"
				: requestedView === "explore"
					? params.get("mode") === "architecture" || !params.get("mode") ? "architecture" : "code"
			: legacyCodeView
				? "code"
				: INTERNAL_VIEWS.has(requestedView as AppView)
					? requestedView as AppView
					: "home";
	const issue = retired
		? { kind: "retired-view" as const, value: retiredView ? requestedView! : "design-authoring" }
		: requestedView && !INTERNAL_VIEWS.has(requestedView as AppView) && !CANONICAL_VIEWS.has(requestedView) && !legacyCodeView
			? { kind: "unknown-view" as const, value: requestedView }
			: null;
	const requestedSource = params.get("source");
	const requestedLens = params.get("lens");
	const exploreMode = requestedView === "explore" ? params.get("mode") : null;
	const legacyApi = requestedView === "api" || exploreMode === "api";
	const legacyEngineSource = requestedView === "graph" && params.get("spec_layer") === "engine";
	const legacySourceLens = requestedLens === "source";
	const source: CodeSource = legacyApi
		? "all"
		: legacyEngineSource
			? "engine"
			: isCodeSource(requestedSource)
				? requestedSource
				: "project";
	const lens: CodeLens = legacyApi
		? "api"
		: legacyEngineSource || legacySourceLens
			? "relations"
			: isCodeLens(requestedLens)
				? requestedLens
				: defaultCodeLens(source);
	const code = normalizeCodeWorkspace(source, lens);
	const forestBranch = !retired && params.get("forest_v") === String(FOREST_ROUTE_VERSION)
		? params.get("branch")
		: null;
	const requestedChangeVersion = nonEmptyParam(params, "changes_v");
	const hasVersionedChanges = !retired
		&& view === "changes"
		&& requestedChangeVersion === String(CHANGE_EVIDENCE_ROUTE_VERSION);
	const requestedChangeTab = params.get("tab") as ChangeRouteTab | null;
	const requestedChangeFact = params.get("fact") as ChangeRouteFact | null;
	const requestedChangeScope = params.get("change_scope") as ChangeRouteScope | null;
	const changeDiagnostics: ChangeRouteDiagnostic[] = [];
	if (!retired && view === "changes" && requestedChangeVersion && !hasVersionedChanges) {
		changeDiagnostics.push({
			code: "unsupported-version",
			title: "变化链接版本不受支持",
			detail: `changes_v=${requestedChangeVersion} 不能无损解释，已回到当前变化总览。`,
			requested: requestedChangeVersion,
		});
	} else if (!retired && view === "changes" && !requestedChangeVersion && CHANGE_ROUTE_FIELDS.some((field) => params.has(field))) {
		changeDiagnostics.push({
			code: "unversioned-state",
			title: "变化链接缺少格式版本",
			detail: "未版本化的筛选与证据参数不会被猜测，已回到当前变化总览。",
			requested: "missing changes_v",
		});
	}
	const invalidChangeFields: string[] = [];
	if (hasVersionedChanges) {
		if (requestedChangeTab && !CHANGE_TABS.has(requestedChangeTab)) invalidChangeFields.push(`tab=${requestedChangeTab}`);
		if (requestedChangeFact && !CHANGE_FACTS.has(requestedChangeFact)) invalidChangeFields.push(`fact=${requestedChangeFact}`);
		if (requestedChangeScope && !CHANGE_SCOPES.has(requestedChangeScope)) invalidChangeFields.push(`change_scope=${requestedChangeScope}`);
	}
	if (invalidChangeFields.length > 0) changeDiagnostics.push({
		code: "invalid-parameter",
		title: "变化链接包含无效参数",
		detail: `${invalidChangeFields.join("、")} 已按 v${CHANGE_EVIDENCE_ROUTE_VERSION} 结构默认值归一化。`,
		requested: invalidChangeFields.join("&"),
	});
	const changes: ChangeEvidenceRoute = hasVersionedChanges ? {
		report: nonEmptyParam(params, "report"),
		tab: requestedChangeTab && CHANGE_TABS.has(requestedChangeTab) ? requestedChangeTab : DEFAULT_CHANGE_EVIDENCE_ROUTE.tab,
		fact: requestedChangeFact && CHANGE_FACTS.has(requestedChangeFact) ? requestedChangeFact : DEFAULT_CHANGE_EVIDENCE_ROUTE.fact,
		scope: requestedChangeScope && CHANGE_SCOPES.has(requestedChangeScope) ? requestedChangeScope : DEFAULT_CHANGE_EVIDENCE_ROUTE.scope,
		module: nonEmptyParam(params, "module"),
		nodeType: nonEmptyParam(params, "type"),
		node: nonEmptyParam(params, "node"),
	} : { ...DEFAULT_CHANGE_EVIDENCE_ROUTE };
	return {
		view,
		file: retired ? null : params.get("file"),
		spec: retired ? null : params.get("spec"),
		focus: retired ? null : params.get("focus"),
		forestBranch,
		changes,
		changeDiagnostics,
		codeSource: code.source,
		codeLens: code.lens,
		architectureScope: retired ? null : params.get("scope") ?? params.get("mindmap_scope"),
		issue,
	};
}

function diagnostic(code: ChangeRouteDiagnosticCode, title: string, detail: string, requested: string): ChangeRouteDiagnostic {
	return { code, title, detail, requested };
}

function sameChangeRoute(left: ChangeEvidenceRoute, right: ChangeEvidenceRoute): boolean {
	return CHANGE_ROUTE_FIELDS.every((field) => {
		const key = field === "change_scope" ? "scope" : field === "type" ? "nodeType" : field;
		return left[key as keyof ChangeEvidenceRoute] === right[key as keyof ChangeEvidenceRoute];
	});
}

export function normalizeChangeRouteForCatalog(route: ChangeEvidenceRoute, catalog: {
	default_report: string | null;
	reports: readonly { file: string }[];
}): ChangeRouteResolution {
	const reportFiles = new Set(catalog.reports.map((entry) => entry.file));
	if (!route.report || reportFiles.size === 0 || reportFiles.has(route.report)) return { route, diagnostics: [] };
	return {
		route: { ...DEFAULT_CHANGE_EVIDENCE_ROUTE, report: catalog.default_report },
		diagnostics: [diagnostic(
			"missing-report",
			"变化报告已不可用",
			`请求的报告 ${route.report} 不在当前目录中，筛选状态已清除并打开默认报告。`,
			route.report,
		)],
	};
}

export function changeNodesInRouteScope(reportOrIndex: ChangeReport | ChangeReportQueryIndex, route: ChangeEvidenceRoute): ChangeNodeSummary[] {
	const index = asChangeReportQueryIndex(reportOrIndex);
	return [...index.selectNodes({ tab: route.tab, scope: route.scope, module: route.module, nodeType: null }).scopedNodes];
}

export function normalizeChangeRouteForReport(route: ChangeEvidenceRoute, reportOrIndex: ChangeReport | ChangeReportQueryIndex): ChangeRouteResolution {
	const index = asChangeReportQueryIndex(reportOrIndex);
	let normalized = { ...route };
	const diagnostics: ChangeRouteDiagnostic[] = [];
	const modules = new Set(index.modules);
	if (normalized.module && normalized.module !== "*" && !modules.has(normalized.module)) {
		diagnostics.push(diagnostic("missing-module", "链接中的模块已不可用", `模块 ${normalized.module} 不存在于当前报告，已恢复为全部模块。`, normalized.module));
		normalized = { ...normalized, module: "*", nodeType: null, node: null };
	}
	const scoped = index.selectNodes({ tab: normalized.tab, scope: normalized.scope, module: normalized.module, nodeType: null });
	if (normalized.nodeType && !scoped.nodeTypeCounts.some(([type]) => type === normalized.nodeType)) {
		diagnostics.push(diagnostic("missing-type", "链接中的节点类型已不可用", `类型 ${normalized.nodeType} 在当前范围没有事实，已清除类型与节点定位。`, normalized.nodeType));
		normalized = { ...normalized, nodeType: null, node: null };
	}
	const visible = index.selectNodes({ tab: normalized.tab, scope: normalized.scope, module: normalized.module, nodeType: normalized.nodeType }).visibleNodes;
	if (normalized.node && (normalized.fact !== "nodes" || normalized.tab === "impact" || !visible.some((node) => node.id === normalized.node))) {
		diagnostics.push(diagnostic("missing-node", "链接中的变化证据已不可用", `节点 ${normalized.node} 不在当前报告与筛选范围内，已保留其余有效条件。`, normalized.node));
		normalized = { ...normalized, node: null };
	}
	return { route: sameChangeRoute(route, normalized) ? route : normalized, diagnostics };
}

export interface AppRouteState {
	view: AppView;
	file: string | null;
	codeSource: CodeSource;
	codeLens: CodeLens;
	architectureScope: string;
	spec: string | null;
	forestBranch?: string | null;
	changes?: ChangeEvidenceRoute;
}

/** Writes only the new Overview / Explore / Changes information architecture. */
export function buildAppSearch(state: AppRouteState): string {
	const params = new URLSearchParams();
	if (state.view === "home") return "";
	if (state.view === "changes") {
		params.set("view", "changes");
		const changes = state.changes ?? DEFAULT_CHANGE_EVIDENCE_ROUTE;
		const hasEvidenceState = Boolean(
			changes.report || changes.module || changes.nodeType || changes.node
			|| changes.tab !== DEFAULT_CHANGE_EVIDENCE_ROUTE.tab
			|| changes.fact !== DEFAULT_CHANGE_EVIDENCE_ROUTE.fact
			|| changes.scope !== DEFAULT_CHANGE_EVIDENCE_ROUTE.scope,
		);
		if (hasEvidenceState) {
			params.set("changes_v", String(CHANGE_EVIDENCE_ROUTE_VERSION));
			if (changes.report) params.set("report", changes.report);
			params.set("tab", changes.tab);
			params.set("fact", changes.fact);
			params.set("change_scope", changes.scope);
			if (changes.module) params.set("module", changes.module);
			if (changes.nodeType) params.set("type", changes.nodeType);
			if (changes.node) params.set("node", changes.node);
		}
		return `?${params}`;
	}
	params.set("view", "explore");
	params.set("mode", state.view === "architecture" ? "architecture" : state.codeLens);
	if (state.view === "architecture") {
		if (state.architectureScope !== "root") params.set("scope", state.architectureScope);
	} else {
		if (state.file) params.set("file", state.file);
		params.set("source", state.codeSource);
		if (state.codeLens !== "api" && state.spec) params.set("spec", state.spec);
		if (state.codeLens === "relations" && state.codeSource === "project" && state.forestBranch) {
			params.set("forest_v", String(FOREST_ROUTE_VERSION));
			params.set("branch", state.forestBranch);
		}
	}
	return `?${params}`;
}
