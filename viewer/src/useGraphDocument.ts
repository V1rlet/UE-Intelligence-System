/**
 * useGraphDocument — 图谱文档生命周期管理。
 *
 * 从 App.tsx 拆出的第一块共享数据层：
 * - 图谱目录（catalog）获取与文件列表维护
 * - 当前文件选择与跟踪
 * - Mermaid 序列图索引
 * - 辅助工具函数（latestGraphOf）
 *
 * 注意：图谱文件的 fetch 生命周期仍留在 App，因为它需要协调 UI 状态重置
 * （specStack、selected、collapsed 等）。此 hook 管理的是文档级别数据，
 * 而非单次加载的事务流。
 *
 * App 仍是唯一消费者（单组件拥有者）。后续 Context 化时此 hook 可直接提升。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetchJson } from "./apiFetch";
import { loadPref } from "./uiPrefs";
import { selectExistingSpec } from "./workspaceModel";
import type { GraphCatalogEntry } from "./graphCatalog";
import type { GraphElements } from "../components/graph-view/GraphView";
import type { MermaidEntry } from "../components/mermaid/MermaidModal";
import type { AppDeepLink } from "./appRoute";

// ── 共享类型（原 App.tsx 内联） ────────────────────────────────
export interface GraphFile {
	meta?: Record<string, unknown>;
	elements: GraphElements;
}

// ── Hook 参数 ──────────────────────────────────────────────────
export interface UseGraphDocumentOptions {
	/** 初始解析的深链接（只读一次） */
	deepLink: AppDeepLink;
}

// ── Hook 返回值 ────────────────────────────────────────────────
export interface GraphDocumentState {
	// 目录
	graphList: string[];
	graphCatalog: GraphCatalogEntry[];
	listLoaded: boolean;
	refreshGraphCatalog: () => Promise<void>;
	/** 全局错误（目录级） */
	catalogError: string | null;

	// 当前文件
	currentFile: string | null;
	setCurrentFile: React.Dispatch<React.SetStateAction<string | null>>;

	// Mermaid 索引
	mermaidIndex: MermaidEntry[];
	mermaidFor: (ids: (string | null)[]) => MermaidEntry[];

	// 辅助查找
	latestGraphOf: (prefix: string) => string | null;
}

export function useGraphDocument({ deepLink }: UseGraphDocumentOptions): GraphDocumentState {
	const [graphList, setGraphList] = useState<string[]>([]);
	const [graphCatalog, setGraphCatalog] = useState<GraphCatalogEntry[]>([]);
	const [currentFile, setCurrentFile] = useState<string | null>(null);
	const [catalogError, setCatalogError] = useState<string | null>(null);
	const [listLoaded, setListLoaded] = useState(false);

	// ── 目录加载 ───────────────────────────────────────────────
	const refreshGraphCatalog = useCallback(async () => {
		try {
			const entries = await apiFetchJson<GraphCatalogEntry[]>("/api/graph-catalog");
			if (!Array.isArray(entries)) throw new Error("目录响应格式错误");
			const files = entries.map((entry) => entry.file);
			setGraphCatalog(entries);
			setGraphList(files);
			// F6：优先恢复上次打开的图谱（仍存在时）
			const last = loadPref<string | null>("lastGraph", null);
			// 架构工作页拥有独立视图，但类跳转仍以项目代码图作为事实上下文。
			const fallbackEntry = entries.find((entry) => entry.kind !== "mindmap" && entry.kind !== "reference");
			const fallback = fallbackEntry?.file ?? files[0] ?? null;
			const architectureContext = deepLink.view === "architecture"
				? selectExistingSpec(entries, deepLink.file ?? last)
				: null;
			const requestedFile = architectureContext?.file
				?? (deepLink.file && files.includes(deepLink.file) ? deepLink.file : null)
				?? (last && entries.some((entry) => entry.file === last && entry.kind !== "mindmap" && entry.kind !== "reference") ? last : null)
				?? fallback;
			setCurrentFile((current) => current && files.includes(current)
				? current
				: files.length > 0 ? requestedFile : null);
			setCatalogError(null);
		} catch (e) {
			setCatalogError(`获取文档目录失败: ${e}`);
		} finally {
			setListLoaded(true);
		}
	}, [deepLink.file, deepLink.view]);

	useEffect(() => {
		void refreshGraphCatalog();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// ── Mermaid 序列图索引 ─────────────────────────────────────
	const [mermaidIndex, setMermaidIndex] = useState<MermaidEntry[]>([]);
	useEffect(() => {
		const controller = new AbortController();
		apiFetchJson<MermaidEntry[]>("/api/mermaid", { signal: controller.signal })
			.then((list: MermaidEntry[]) => setMermaidIndex(Array.isArray(list) ? list : []))
			.catch((e) => {
				if ((e as Error).name !== "AbortError") setMermaidIndex([]);
			});
		return () => controller.abort();
	}, []);

	const mermaidFor = useCallback(
		(ids: (string | null)[]) =>
			mermaidIndex.filter((m) => ids.some((id) => id && m.nodes.includes(id))),
		[mermaidIndex],
	);

	// ── 辅助查找 ───────────────────────────────────────────────
	const latestGraphOf = useMemo(
		() => (prefix: string) =>
			graphList.find((f) => f.startsWith(prefix) && f.endsWith(".cyto.json")) ?? null,
		[graphList],
	);

	return {
		graphList,
		graphCatalog,
		listLoaded,
		refreshGraphCatalog,
		catalogError,
		currentFile,
		setCurrentFile,
		mermaidIndex,
		mermaidFor,
		latestGraphOf,
	};
}
