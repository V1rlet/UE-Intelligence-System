/**
 * Canonical code-workspace capability model.
 *
 * Lens is the primary navigation level (how code facts are inspected). Source
 * is the contextual secondary level (which facts participate). Keeping this
 * matrix here prevents routes and views from inventing different hierarchies.
 */
export type CodeSource = "project" | "engine" | "all";
export type CodeLens = "relations" | "api";

export interface CodeWorkspaceState {
	source: CodeSource;
	lens: CodeLens;
}

export interface CodeLensCapability {
	id: CodeLens;
	label: string;
	description: string;
}

export interface CodeSourceCapability {
	id: CodeSource;
	label: string;
	description: string;
}

const LENSES: readonly CodeLensCapability[] = [
	{ id: "relations", label: "关系图", description: "查看代码结构、依赖与源码声明层级" },
	{ id: "api", label: "API", description: "查看类型、函数与跨来源检索资料" },
];

const SOURCES_BY_LENS: Record<CodeLens, readonly CodeSourceCapability[]> = {
	relations: [
		{ id: "project", label: "项目", description: "项目源码森林与代码关系" },
		{ id: "engine", label: "引擎", description: "UE 引擎模块、头文件与声明关系" },
	],
	api: [
		{ id: "project", label: "项目", description: "项目类型与函数资料" },
		{ id: "engine", label: "引擎", description: "UE 引擎类型与函数资料" },
		{ id: "all", label: "全部", description: "跨项目与引擎检索" },
	],
};

export function codeLensCapabilities(): readonly CodeLensCapability[] {
	return LENSES;
}

export function codeSourceCapabilities(lens: CodeLens): readonly CodeSourceCapability[] {
	return SOURCES_BY_LENS[lens];
}

export function isCodeSource(value: string | null): value is CodeSource {
	return value === "project" || value === "engine" || value === "all";
}

export function isCodeLens(value: string | null): value is CodeLens {
	return value === "relations" || value === "api";
}

export function defaultCodeLens(source: CodeSource): CodeLens {
	return source === "all" ? "api" : "relations";
}

/** Deterministic, idempotent normalization for URLs and UI transitions. */
export function normalizeCodeWorkspace(source: CodeSource, lens: CodeLens): CodeWorkspaceState {
	const supported = SOURCES_BY_LENS[lens];
	return supported.some((entry) => entry.id === source)
		? { source, lens }
		: { source: supported[0].id, lens };
}

/** Changing the primary lens retains its source when that source has meaning. */
export function changeCodeLens(current: CodeWorkspaceState, lens: CodeLens): CodeWorkspaceState {
	return normalizeCodeWorkspace(current.source, lens);
}

/** Changing the contextual source keeps the active lens as the primary fact. */
export function changeCodeSource(current: CodeWorkspaceState, source: CodeSource): CodeWorkspaceState {
	return normalizeCodeWorkspace(source, current.lens);
}
