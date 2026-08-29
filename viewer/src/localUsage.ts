import type { AppView } from "./appRoute";
import type { CodeLens } from "./codeWorkspaceModel";

export type ViewerWorkspaceUsage = "workspace.overview" | "workspace.explore.architecture" | "workspace.explore.relations" | "workspace.explore.api" | "workspace.changes";

export function viewerWorkspaceUsage(view: AppView, lens: CodeLens): ViewerWorkspaceUsage {
	if (view === "home") return "workspace.overview";
	if (view === "changes") return "workspace.changes";
	if (view === "architecture") return "workspace.explore.architecture";
	return lens === "api" ? "workspace.explore.api" : "workspace.explore.relations";
}

export function recordViewerWorkspace(event: ViewerWorkspaceUsage): void {
	void fetch("/api/usage/v1/event", {
		method: "POST",
		headers: { "Content-Type": "application/json", "X-GraphBrain-Local": "1" },
		body: JSON.stringify({ event }),
		keepalive: true,
	}).catch(() => undefined);
}
