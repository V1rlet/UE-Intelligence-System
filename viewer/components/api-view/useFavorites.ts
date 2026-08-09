// Unified class/function favorites backed by the versioned reading-context document.
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../src/apiFetch";
import { clearLegacyBrowserFavorites, collectLegacyBrowserFavorites } from "../../src/readingContextMigration";

export interface Favorite {
	kind: "class" | "function";
	source: "project" | "engine" | "unknown";
	node_id: string;
	label?: string;
	parent_id?: string;
	module?: string;
	source_path?: string;
	added_at: string;
}

export type FavoriteInput = Omit<Favorite, "added_at">;

export interface FavoritesState {
	favorites: Favorite[];
	favIds: Set<string>;
	favError: string | null;
	toggleFavorite: (id: string, details?: Partial<FavoriteInput>) => Promise<void>;
}

function revisionOf(response: Response): number {
	const raw = response.headers.get("X-Reading-Context-Revision") ?? response.headers.get("ETag") ?? "0";
	return Number(raw.match(/\d+/)?.[0] ?? 0);
}

export default function useFavorites(domain: string): FavoritesState {
	const [favorites, setFavorites] = useState<Favorite[]>([]);
	const [favError, setFavError] = useState<string | null>(null);
	const revision = useRef(0);

	useEffect(() => {
		setFavorites([]);
		setFavError(null);
		const controller = new AbortController();
		const load = async () => {
			try {
				const response = await apiFetch(`/api/favorites/${encodeURIComponent(domain)}`, { signal: controller.signal }, { notify: false, context: "阅读收藏" });
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const list = await response.json() as Favorite[];
				if (!Array.isArray(list)) throw new Error("收藏响应格式错误");
				revision.current = revisionOf(response);
				setFavorites(list);
				const legacy = collectLegacyBrowserFavorites();
				if (legacy.length === 0 || controller.signal.aborted) return;
				const migration = await apiFetch(`/api/favorites/${encodeURIComponent(domain)}`, {
					method: "POST",
					headers: { "Content-Type": "application/json", "If-Match": `"${revision.current}"` },
					body: JSON.stringify({ action: "import_legacy", favorites: legacy }),
					signal: controller.signal,
				}, { notify: false, context: "迁移旧收藏" });
				const migrated = await migration.json() as Favorite[] | { favorites?: Favorite[]; error?: string };
				if (!migration.ok) throw new Error((migrated as { error?: string }).error ?? `HTTP ${migration.status}`);
				revision.current = revisionOf(migration);
				setFavorites(migrated as Favorite[]);
				clearLegacyBrowserFavorites();
			} catch (error) {
				if ((error as Error).name !== "AbortError") setFavError(`收藏加载失败: ${String(error)}`);
			}
		};
		void load();
		return () => controller.abort();
	}, [domain]);

	const toggleFavorite = async (id: string, details: Partial<FavoriteInput> = {}) => {
		setFavError(null);
		const kind = details.kind ?? "function";
		const existing = favorites.find((favorite) => favorite.kind === kind && favorite.node_id === id && (!details.source || favorite.source === details.source));
		const source = details.source ?? existing?.source ?? "unknown";
		try {
			const response = await apiFetch(`/api/favorites/${encodeURIComponent(domain)}`, {
				method: "POST",
				headers: { "Content-Type": "application/json", "If-Match": `"${revision.current}"` },
				body: JSON.stringify({ action: existing ? "remove" : "add", kind, source, node_id: id, ...details }),
			}, { context: "更新阅读收藏" });
			const data = await response.json() as Favorite[] | { favorites?: Favorite[]; error?: string; revision?: number };
			if (response.status === 409) {
				revision.current = revisionOf(response) || Number((data as { revision?: number }).revision ?? revision.current);
				setFavorites((data as { favorites?: Favorite[] }).favorites ?? []);
				setFavError("收藏已在其他窗口更新，已载入最新版本；请确认后重试。 ");
				return;
			}
			if (!response.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${response.status}`);
			revision.current = revisionOf(response);
			setFavorites(data as Favorite[]);
		} catch (error) {
			setFavError(String(error));
		}
	};

	const favIds = new Set(favorites.filter((favorite) => favorite.kind === "function").map((favorite) => favorite.node_id));
	return { favorites, favIds, favError, toggleFavorite };
}
