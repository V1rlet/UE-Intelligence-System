import { type ApiHandler, sendJson } from "./http";

export const RETIRED_AUTHORING_PREFIXES = [
	"/api/design-deliveries",
	"/api/design-export",
	"/api/design-graph",
	"/api/doc-registry",
	"/api/entity-registry",
	"/api/planned-brief",
	"/api/planned-export",
	"/api/planned-graph",
	"/api/review-highlights",
	"/api/timeline",
	"/api/timeline-snapshot",
	"/api/workbench",
	"/api/world-anchors",
] as const;

/** One compatibility boundary for every authoring API retired in viewer-only mode. */
export const handleRetiredAuthoringTools: ApiHandler = ({ res, url }) => {
	if (!RETIRED_AUTHORING_PREFIXES.some((prefix) => url === prefix || url.startsWith(`${prefix}/`))) return false;
	sendJson(res, 410, {
		error: "GraphBrain authoring has been retired; architecture decisions and implementation plans now belong to ClaudeGameStudios.",
		code: "GRAPHBRAIN_AUTHORING_RETIRED",
		scope: "read-only UE code architecture viewer",
		deletion_receipt: "data/archive/authoring-platform-v1/deletion-manifest.json",
		annotations_retained_for: "ue5_code",
	});
	return true;
};
