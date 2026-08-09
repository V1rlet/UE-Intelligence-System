// Thin favorites projection over the canonical versioned reading-context document.
import {
	loadReadingContext,
	mergeReadingFavorites,
	mutateReadingContext,
	type FavoriteKind,
	type FavoriteSource,
	type ReadingFavorite as Favorite,
} from "../reading-context/store.js";

export type { Favorite, FavoriteKind, FavoriteSource };

export interface FavoriteWriteResult {
	revision: number;
	updated_at: string;
	favorites: Favorite[];
}

function result(document: ReturnType<typeof loadReadingContext>): FavoriteWriteResult {
	return { revision: document.revision, updated_at: document.updated_at, favorites: structuredClone(document.favorites) };
}

export function loadFavoriteDocument(domain: string): FavoriteWriteResult {
	return result(loadReadingContext(domain));
}

export function loadFavorites(domain: string): Favorite[] {
	return loadFavoriteDocument(domain).favorites;
}

export function addFavorite(
	domain: string,
	input: Omit<Favorite, "added_at"> & { added_at?: string },
	expectedRevision: number,
): FavoriteWriteResult {
	if (!input.node_id?.trim()) throw new Error("缺少 node_id");
	return result(mergeReadingFavorites(domain, expectedRevision, [input]));
}

export function importFavorites(
	domain: string,
	inputs: Array<Omit<Favorite, "added_at"> & { added_at?: string }>,
	expectedRevision: number,
): FavoriteWriteResult {
	return result(mergeReadingFavorites(domain, expectedRevision, inputs));
}

export function removeFavorite(
	domain: string,
	selector: Pick<Favorite, "kind" | "source" | "node_id">,
	expectedRevision: number,
): FavoriteWriteResult {
	const document = mutateReadingContext(domain, expectedRevision, (draft) => {
		draft.favorites = draft.favorites.filter((favorite) =>
			favorite.kind !== selector.kind || favorite.source !== selector.source || favorite.node_id !== selector.node_id);
	});
	return result(document);
}
