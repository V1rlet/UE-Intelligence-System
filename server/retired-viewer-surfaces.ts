// Centralized 0.x compatibility boundary for viewer surfaces retired after the
// consumer audit. These routes intentionally expose diagnostics only; they do
// not load archived data or reactivate the old implementations.
import { type ApiHandler, methodNotAllowed, sendJson } from "./http";

interface RetiredSurface {
	name: "generic-embed" | "mermaid";
	replacement: string;
}

function retiredSurface(url: string): RetiredSurface | null {
	if (url === "/embed" || url.startsWith("/embed/")) {
		return {
			name: "generic-embed",
			replacement: "Use the GraphBrain viewer deep link or the Evidence v1 API.",
		};
	}
	if (url === "/api/mermaid" || url === "/data/mermaid" || url.startsWith("/data/mermaid/")) {
		return {
			name: "mermaid",
			replacement: "Use the canonical Cytoscape relationship view backed by current code evidence.",
		};
	}
	return null;
}

export const handleRetiredViewerSurfaces: ApiHandler = ({ req, res, url }) => {
	const surface = retiredSurface(url);
	if (!surface) return false;
	if (req.method !== "GET") {
		methodNotAllowed(res);
		return true;
	}
	sendJson(res, 410, {
		code: "VIEWER_SURFACE_RETIRED",
		error: `${surface.name} viewer surface is retired`,
		surface: surface.name,
		replacement: surface.replacement,
		compatibility: "0.x diagnostic adapter; no archived content is activated",
	});
	return true;
};
