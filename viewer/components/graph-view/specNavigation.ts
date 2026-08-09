/**
 * Advances a Spec breadcrumb trail without allowing A → B → A cycles.
 * Returning to an existing target truncates the trail to that target; revisiting
 * the current target only refreshes its metadata.
 */
export function advanceSpecTrail<T extends { id: string }>(trail: readonly T[], target: T): T[] {
	const existingIndex = trail.findIndex((entry) => entry.id === target.id);
	if (existingIndex < 0) return [...trail, target];
	return [
		...trail.slice(0, existingIndex),
		{ ...trail[existingIndex], ...target },
	];
}
