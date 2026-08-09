import {
	READING_CONTEXT_FORMAT_VERSION,
	type ReadingAnnotation,
	type ReadingContextDocument,
} from "./store.js";

export interface LegacyAnnotationEntry {
	node_id: string;
	domain: string;
	annotations: ReadingAnnotation[];
}

export interface LegacyAnnotationDocument {
	subsystem: string;
	entries: LegacyAnnotationEntry[];
}

export interface LegacyFavorite {
	node_id: string;
	added_at: string;
}

/** Lossless structural migration. Missing favorite source/kind semantics stay explicit as unknown/function. */
export function migrateLegacyReadingContext(
	annotationDocuments: LegacyAnnotationDocument[],
	legacyFavorites: LegacyFavorite[],
	now: string,
): ReadingContextDocument {
	return {
		format_version: READING_CONTEXT_FORMAT_VERSION,
		domain: "ue5_code",
		revision: 1,
		updated_at: now,
		annotations: annotationDocuments.flatMap((document) => document.entries.map((entry) => {
			if (entry.domain !== "ue5_code") throw new Error(`${document.subsystem} contains unsupported domain ${entry.domain}`);
			return { subsystem: document.subsystem, node_id: entry.node_id, annotations: structuredClone(entry.annotations) };
		})).filter((entry) => entry.annotations.length > 0),
		favorites: legacyFavorites.map((favorite) => ({
			kind: "function",
			source: "unknown",
			node_id: favorite.node_id,
			added_at: favorite.added_at,
		})),
	};
}
