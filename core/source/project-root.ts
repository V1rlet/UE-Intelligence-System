import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One capability boundary for files that belong to the live GraphBrain project.
 * Source execution keeps the historical relative fallback; immutable release
 * bundles receive the explicit GB_PROJECT_ROOT from their launcher.
 */
export function resolveGraphBrainProjectRoot(importMetaUrl: string, ...fallbackSegments: string[]): string {
	const explicit = process.env.GB_PROJECT_ROOT?.trim();
	return explicit ? resolve(explicit) : resolve(dirname(fileURLToPath(importMetaUrl)), ...fallbackSegments);
}
