export type AppHistoryWriteMode = "push" | "replace";

export interface AppHistoryCommand {
	method: "pushState" | "replaceState";
	target: string;
}

/**
 * Keeps top-level workspace navigation in browser history while allowing
 * filters and other within-workspace state to update the current entry.
 */
export function appHistoryCommand(
	pathname: string,
	currentSearch: string,
	nextSearch: string,
	mode: AppHistoryWriteMode,
): AppHistoryCommand | null {
	const target = nextSearch || pathname;
	if (currentSearch === nextSearch) return null;
	return { method: mode === "push" ? "pushState" : "replaceState", target };
}
