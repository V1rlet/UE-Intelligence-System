export type SpecFunctionKind = "interface" | "delegate_response" | "accessor" | "static" | "dispatch";

export interface SpecFunctionLike {
	id: string;
	label?: unknown;
	tags?: unknown;
	is_static?: unknown;
	api?: unknown;
}

export interface SpecFunctionPartitions<T> {
	accessors: T[];
	statics: T[];
	interfaceFunctions: T[];
	delegateResponses: T[];
	dispatch: T[];
}

export interface PaginatedSpecFunctions<T> {
	all: SpecFunctionPartitions<T>;
	page: SpecFunctionPartitions<T>;
	pageCount: number;
	pageIndex: number;
	total: number;
}

const PARTITION_ORDER: (keyof SpecFunctionPartitions<unknown>)[] = [
	"statics",
	"dispatch",
	"interfaceFunctions",
	"accessors",
	"delegateResponses",
];

function functionName(fn: SpecFunctionLike): string {
	const label = String(fn.label ?? "").trim();
	if (label) return label;
	return fn.id.includes("::") ? fn.id.slice(fn.id.lastIndexOf("::") + 2) : fn.id;
}

export function isStaticFunction(fn: SpecFunctionLike): boolean {
	const api = (fn.api ?? {}) as { is_static?: unknown; signature?: unknown };
	const tags = Array.isArray(fn.tags) ? fn.tags.map(String) : [];
	return fn.is_static === true
		|| api.is_static === true
		|| tags.some((tag) => tag.replace(/^#/, "").toLowerCase() === "static")
		|| /^\s*static\b/.test(String(api.signature ?? ""));
}

export function specFunctionKind(fn: SpecFunctionLike): SpecFunctionKind {
	const tags = Array.isArray(fn.tags) ? fn.tags.map(String) : [];
	if (tags.includes("delegate_response")) return "delegate_response";
	if (tags.some((tag) => tag.startsWith("interface:"))) return "interface";
	if (isStaticFunction(fn)) return "static";
	return /^(?:Get|Set|Init|Initialize|Setup)(?=$|[A-Z0-9_])/.test(functionName(fn)) ? "accessor" : "dispatch";
}

export function partitionSpecFunctions<T extends SpecFunctionLike>(functions: T[]): SpecFunctionPartitions<T> {
	const result: SpecFunctionPartitions<T> = { accessors: [], statics: [], interfaceFunctions: [], delegateResponses: [], dispatch: [] };
	for (const fn of functions) {
		const kind = specFunctionKind(fn);
		if (kind === "interface") result.interfaceFunctions.push(fn);
		else if (kind === "delegate_response") result.delegateResponses.push(fn);
		else if (kind === "accessor") result.accessors.push(fn);
		else if (kind === "static") result.statics.push(fn);
		else result.dispatch.push(fn);
	}
	return result;
}

function orderedFunctions<T>(partitions: SpecFunctionPartitions<T>): T[] {
	return PARTITION_ORDER.flatMap((key) => partitions[key]);
}

/** One global page budget shared by every function zone; no zone can bypass pagination. */
export function paginateSpecFunctions<T extends SpecFunctionLike>(
	functions: T[],
	requestedPage: number,
	pageSize: number,
): PaginatedSpecFunctions<T> {
	const all = partitionSpecFunctions(functions);
	const ordered = orderedFunctions(all);
	const safePageSize = Math.max(1, Math.floor(pageSize));
	const pageCount = Math.ceil(ordered.length / safePageSize);
	const pageIndex = pageCount > 0 ? Math.min(Math.max(Math.floor(requestedPage), 0), pageCount - 1) : 0;
	const pageItems = ordered.slice(pageIndex * safePageSize, (pageIndex + 1) * safePageSize);
	return { all, page: partitionSpecFunctions(pageItems), pageCount, pageIndex, total: ordered.length };
}

export function specFunctionPageIndex<T extends SpecFunctionLike>(functions: T[], functionId: string, pageSize: number): number {
	const ordered = orderedFunctions(partitionSpecFunctions(functions));
	const index = ordered.findIndex((fn) => fn.id === functionId);
	return index >= 0 ? Math.floor(index / Math.max(1, Math.floor(pageSize))) : -1;
}
