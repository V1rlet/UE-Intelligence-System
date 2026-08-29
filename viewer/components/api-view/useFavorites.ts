// Unified class/function favorites backed by the versioned reading-context document.
import { useEffect, useRef, useState } from "react";
import type { ReadingFavorite } from "../../../core/reading-context/store";
import { apiFetch } from "../../src/apiFetch";
import {
	READING_CONTEXT_ACCEPT_STATUSES,
	READING_CONTEXT_CONFLICT_STATUS,
	readingContextRevisionOf,
} from "../../src/readingContextHttp";
import { clearLegacyBrowserFavorites, collectLegacyBrowserFavorites } from "../../src/readingContextMigration";

export type Favorite = ReadingFavorite;

/** The node id is the positional identity; callers must provide every semantic discriminator. */
export type FavoriteInput = Omit<Favorite, "added_at" | "node_id">;

export interface FavoritesState {
	favorites: Favorite[];
	favIds: Set<string>;
	favError: string | null;
	toggleFavorite: (id: string, details: FavoriteInput) => Promise<void>;
}

export default function useFavorites(domain: string): FavoritesState {
	const [favorites, setFavorites] = useState<Favorite[]>([]);
	const [favError, setFavError] = useState<string | null>(null);
	const revision = useRef(0);
	const operationSequence = useRef(0);
	const activeDomain = useRef(domain);
	activeDomain.current = domain;

	useEffect(() => {
		const loadSequence = ++operationSequence.current;
		const isCurrentLoad = () => activeDomain.current === domain && operationSequence.current === loadSequence;
		setFavorites([]);
		setFavError(null);
		const controller = new AbortController();
		const load = async () => {
			try {
				const response = await apiFetch(`/api/favorites/${encodeURIComponent(domain)}`, { signal: controller.signal }, { notify: false, context: "阅读收藏" });
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const list = await response.json() as Favorite[];
				if (!isCurrentLoad()) return;
				if (!Array.isArray(list)) throw new Error("收藏响应格式错误");
				revision.current = readingContextRevisionOf(response);
				setFavorites(list);
				const legacy = collectLegacyBrowserFavorites();
				if (legacy.length === 0 || controller.signal.aborted) return;
				const migration = await apiFetch(`/api/favorites/${encodeURIComponent(domain)}`, {
					method: "POST",
					headers: { "Content-Type": "application/json", "If-Match": `"${revision.current}"` },
					body: JSON.stringify({ action: "import_legacy", favorites: legacy }),
					signal: controller.signal,
				}, { notify: false, context: "迁移旧收藏", acceptStatuses: READING_CONTEXT_ACCEPT_STATUSES });
				const migrated = await migration.json() as Favorite[] | { favorites?: Favorite[]; error?: string; revision?: number };
				if (!isCurrentLoad()) return;
				if (migration.status === READING_CONTEXT_CONFLICT_STATUS) {
					revision.current = readingContextRevisionOf(migration) || Number((migrated as { revision?: number }).revision ?? revision.current);
					setFavorites((migrated as { favorites?: Favorite[] }).favorites ?? []);
					setFavError("迁移旧收藏时检测到其他窗口已更新数据；已载入最新版本，旧收藏会保留以便稍后重试。");
					return;
				}
				if (!migration.ok) throw new Error((migrated as { error?: string }).error ?? `HTTP ${migration.status}`);
				revision.current = readingContextRevisionOf(migration);
				setFavorites(migrated as Favorite[]);
				clearLegacyBrowserFavorites();
			} catch (error) {
				if ((error as Error).name !== "AbortError" && isCurrentLoad()) setFavError(`收藏加载失败: ${String(error)}`);
			}
		};
		void load();
		return () => {
			controller.abort();
			operationSequence.current += 1;
		};
	}, [domain]);

	const toggleFavorite = async (id: string, details: FavoriteInput) => {
		const requestDomain = domain;
		const requestSequence = ++operationSequence.current;
		const isCurrentWrite = () => activeDomain.current === requestDomain && operationSequence.current === requestSequence;
		setFavError(null);
		const kind = details.kind;
		const existing = favorites.find((favorite) => favorite.kind === kind && favorite.node_id === id && favorite.source === details.source);
		try {
			const response = await apiFetch(`/api/favorites/${encodeURIComponent(domain)}`, {
				method: "POST",
				headers: { "Content-Type": "application/json", "If-Match": `"${revision.current}"` },
				body: JSON.stringify({ action: existing ? "remove" : "add", node_id: id, ...details }),
			}, { context: "更新阅读收藏", acceptStatuses: READING_CONTEXT_ACCEPT_STATUSES });
			const data = await response.json() as Favorite[] | { favorites?: Favorite[]; error?: string; revision?: number };
			if (!isCurrentWrite()) return;
			if (response.status === READING_CONTEXT_CONFLICT_STATUS) {
				revision.current = readingContextRevisionOf(response) || Number((data as { revision?: number }).revision ?? revision.current);
				setFavorites((data as { favorites?: Favorite[] }).favorites ?? []);
				setFavError("收藏已在其他窗口更新，已载入最新版本；请确认后重试。 ");
				return;
			}
			if (!response.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${response.status}`);
			revision.current = readingContextRevisionOf(response);
			// 与加载路径同一契约校验：畸形 2xx 响应会把非数组塞进 favorites，
			// 下一次渲染的 favorites.find 直接抛错并击穿整个 API 视图。
			if (!Array.isArray(data)) throw new Error("收藏响应格式错误");
			setFavorites(data);
		} catch (error) {
			if (isCurrentWrite()) setFavError(String(error));
		}
	};

	const favIds = new Set(favorites.filter((favorite) => favorite.kind === "function").map((favorite) => favorite.node_id));
	return { favorites, favIds, favError, toggleFavorite };
}
