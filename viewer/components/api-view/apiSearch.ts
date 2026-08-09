export interface ApiSearchEntry {
	name: string;
	scope: string;
	module: string;
	description?: string;
	signature?: string;
	tags?: readonly string[];
	popularity?: number;
}

export interface ApiSearchMatch<T extends ApiSearchEntry> {
	entry: T;
	score: number;
	tier: 0 | 1 | 2 | 3;
}

export interface ApiSearchGroup<T extends ApiSearchEntry> {
	scope: string;
	matches: ApiSearchMatch<T>[];
	score: number;
}

const normalize = (value: string) => value.trim().toLocaleLowerCase();

function fieldScore(value: string, token: string, weights: readonly [number, number, number, number]): number {
	const normalized = normalize(value);
	if (!normalized) return 0;
	if (normalized === token) return weights[0];
	if (normalized.startsWith(token)) return weights[1];
	if (normalized.split(/[^a-z0-9_]+/i).some((part) => part.startsWith(token))) return weights[2];
	if (token.length >= 2 && normalized.includes(token)) return weights[3];
	return 0;
}

export function rankApiEntry<T extends ApiSearchEntry>(entry: T, query: string): ApiSearchMatch<T> | null {
	const tokens = normalize(query).split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return { entry, score: entry.popularity ?? 0, tier: 3 };
	let score = 0;
	let tier: ApiSearchMatch<T>["tier"] = 3;
	for (const token of tokens) {
		const nameScore = fieldScore(entry.name, token, [1200, 960, 820, 700]);
		const moduleScore = fieldScore(entry.module, token, [560, 500, 440, 380]);
		const scopeScore = fieldScore(entry.scope, token, [480, 430, 380, 320]);
		const metadataScore = Math.max(
			fieldScore(entry.signature ?? "", token, [420, 380, 330, 280]),
			fieldScore(entry.description ?? "", token, [300, 270, 240, 200]),
			...(entry.tags ?? []).map((tag) => fieldScore(tag, token, [360, 320, 280, 240])),
		);
		const tokenScore = Math.max(nameScore, moduleScore, scopeScore, metadataScore);
		if (tokenScore === 0) return null;
		score += tokenScore;
		if (nameScore >= 1200) tier = Math.min(tier, 0) as ApiSearchMatch<T>["tier"];
		else if (nameScore >= 820) tier = Math.min(tier, 1) as ApiSearchMatch<T>["tier"];
		else if (nameScore > 0) tier = Math.min(tier, 2) as ApiSearchMatch<T>["tier"];
	}
	// Popularity is a tie-breaker, not permission to bury a better textual match.
	score += Math.min(100, Math.max(0, entry.popularity ?? 0)) * 2;
	return { entry, score, tier };
}

export function rankApiEntries<T extends ApiSearchEntry>(entries: readonly T[], query: string): ApiSearchMatch<T>[] {
	return entries
		.map((entry) => rankApiEntry(entry, query))
		.filter((match): match is ApiSearchMatch<T> => match !== null)
		.sort((a, b) =>
			a.tier - b.tier
			|| b.score - a.score
			|| (b.entry.popularity ?? 0) - (a.entry.popularity ?? 0)
			|| a.entry.module.localeCompare(b.entry.module)
			|| a.entry.name.localeCompare(b.entry.name),
		);
}

export function groupApiSearchResults<T extends ApiSearchEntry>(
	entries: readonly T[],
	query: string,
): ApiSearchGroup<T>[] {
	const groups = new Map<string, ApiSearchMatch<T>[]>();
	for (const match of rankApiEntries(entries, query)) {
		const list = groups.get(match.entry.scope) ?? [];
		list.push(match);
		groups.set(match.entry.scope, list);
	}
	return [...groups.entries()]
		.map(([scope, matches]) => ({ scope, matches, score: Math.max(...matches.map((match) => match.score)) }))
		.sort((a, b) => b.score - a.score || a.scope.localeCompare(b.scope));
}
