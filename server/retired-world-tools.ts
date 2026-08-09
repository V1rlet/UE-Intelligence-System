import { type ApiHandler, sendJson } from "./http.js";

const RETIRED_PREFIXES = [
	"/api/world-atlas",
	"/api/world-projects",
	"/api/quest-program",
	"/api/world-project-export",
] as const;

/**
 * Centralized compatibility boundary for retired World Atlas endpoints.
 *
 * It deliberately exposes no legacy data and performs no mutation. Old clients
 * receive a deterministic exit diagnostic instead of falling through to Vite or
 * silently recreating a second spatial source of truth.
 */
export const handleRetiredWorldTools: ApiHandler = ({ res, url }) => {
	if (!RETIRED_PREFIXES.some((prefix) => url === prefix || url.startsWith(`${prefix}/`))) return false;
	sendJson(res, 410, {
		error: "GraphBrain World Atlas has been retired; Unreal Engine assets now own level, spatial, sequence, and runtime facts.",
		code: "GRAPHBRAIN_WORLD_TOOLS_RETIRED",
		retired_at: "2026-08-08",
		archive: "data/archive/world-atlas-v18/",
		replacement: {
			spatial: "Unreal Level and Actors",
			sequence: "Unreal Sequencer",
			planning: "ClaudeGameStudios architecture decisions, stories, review, and delivery",
		},
	});
	return true;
};
