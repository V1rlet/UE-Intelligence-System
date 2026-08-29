export const READING_CONTEXT_CONFLICT_STATUS = 409 as const;
export const READING_CONTEXT_ACCEPT_STATUSES = [READING_CONTEXT_CONFLICT_STATUS] as const;

/** One strict client-side owner for the reading-context revision response contract. */
export function readingContextRevisionOf(response: Pick<Response, "headers">, fallback = 0): number {
	const raw = response.headers.get("X-Reading-Context-Revision") ?? response.headers.get("ETag");
	const match = raw?.trim().match(/^(?:"(\d+)"|(\d+))$/);
	if (!match) return fallback;
	const revision = Number(match[1] ?? match[2]);
	return Number.isSafeInteger(revision) ? revision : fallback;
}
