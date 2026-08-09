// Single browser compatibility boundary for pre-reading-context favorite keys.
export interface LegacyFavoriteImport {
	kind: "class" | "function";
	source: "project" | "engine" | "unknown";
	node_id: string;
	label?: string;
	parent_id?: string;
	module?: string;
	source_path?: string;
}

const LEGACY_KEYS = [
	"gb-api-class-favorites",
	"gb-api-function-favorite-refs",
	"gb-engine-starred",
	"gb-api-quick-entry-version",
] as const;

function parsedArray(key: string): Array<Record<string, unknown>> {
	try {
		const raw = localStorage.getItem(key);
		const value = raw ? JSON.parse(raw) : [];
		return Array.isArray(value) ? value.map((item) => typeof item === "string" ? { name: item } : item).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
	} catch {
		return [];
	}
}

export function collectLegacyBrowserFavorites(): LegacyFavoriteImport[] {
	const imports: LegacyFavoriteImport[] = [];
	for (const item of [...parsedArray("gb-api-class-favorites"), ...parsedArray("gb-engine-starred")]) {
		const name = String(item.name ?? "").trim();
		if (!name) continue;
		const source = item.source === "project" || item.source === "engine" ? item.source : "engine";
		imports.push({
			kind: "class",
			source,
			node_id: name,
			...(typeof item.module === "string" ? { module: item.module } : {}),
			...(typeof item.sourcePath === "string" ? { source_path: item.sourcePath } : {}),
		});
	}
	for (const item of parsedArray("gb-api-function-favorite-refs")) {
		const id = String(item.id ?? item.node_id ?? "").trim();
		if (!id) continue;
		imports.push({
			kind: "function",
			source: item.layer === "engine" || item.source === "engine" ? "engine" : item.layer === "project" || item.source === "project" ? "project" : "unknown",
			node_id: id,
			...(typeof item.label === "string" ? { label: item.label } : {}),
			...(typeof item.parent === "string" ? { parent_id: item.parent } : {}),
			...(typeof item.module === "string" ? { module: item.module } : {}),
			...(typeof item.source_path === "string" ? { source_path: item.source_path } : {}),
		});
	}
	return [...new Map(imports.map((favorite) => [`${favorite.kind}:${favorite.source}:${favorite.node_id}`, favorite])).values()];
}

export function clearLegacyBrowserFavorites(): void {
	for (const key of LEGACY_KEYS) localStorage.removeItem(key);
}
