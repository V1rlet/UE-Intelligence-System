import { useCallback, useEffect, useRef, useState } from "react";
import { LatestRequestGate } from "./latestRequest.js";
import { graphLoadModeSatisfied, loadGraphDocument, type GraphLoadMode } from "./loadGraphProjection.js";
import { savePref } from "./uiPrefs.js";
import type { GraphFile } from "./useGraphDocument.js";

/**
 * 图谱文件加载生命周期（App.tsx Step 7 拆分）。
 *
 * 持有：graph / loadedGraphFile / graphLoading / graphLoadError 与重载序号、
 * fork/finalize 换文件名时的 skip-reload 标记。
 *
 * UI 状态重置（spec 栈、选中、折叠、搜索、时间轴、导出面板）经回调注入，
 * 不在 hook 内持有——这些状态属于 App 会话，hook 只负责「文件 → 图数据」。
 *
 * 回调经 ref 保存以保证 effect 身份稳定（Step 2–3 经验：
 * hook 参数回调引用 App 后声明变量合法，但需 ref 稳定操作身份）。
 */
export interface UseGraphFileOptions {
	currentFile: string | null;
	loadMode?: GraphLoadMode;
	/** 每次真正开始加载前重置的 UI 状态（不跳过 reload 时调用）。 */
	onLoadStart: (context: { file: string; mode: GraphLoadMode; reason: "file" | "upgrade" | "reload" }) => void;
	/** 加载成功并入图后的 UI 副作用（如默认折叠引擎子树）。 */
	onLoaded: (graph: GraphFile) => void;
	/** 加载失败后的业务副作用（如清理挂起导出、toast）。 */
	onLoadError: (message: string, file: string) => void;
}

export interface GraphFileState {
	graph: GraphFile | null;
	loadedGraphFile: string | null;
	loadedGraphMode: GraphLoadMode | null;
	compatibility: "current" | "legacy-full";
	graphLoading: boolean;
	graphLoadError: string | null;
	/** 重试：按当前 currentFile 重新加载。 */
	reloadGraph: () => void;
}

export function useGraphFile({
	currentFile,
	loadMode = "full",
	onLoadStart,
	onLoaded,
	onLoadError,
}: UseGraphFileOptions): GraphFileState {
	const [graph, setGraph] = useState<GraphFile | null>(null);
	const [loadedGraphFile, setLoadedGraphFile] = useState<string | null>(null);
	const [loadedGraphMode, setLoadedGraphMode] = useState<GraphLoadMode | null>(null);
	const [compatibility, setCompatibility] = useState<"current" | "legacy-full">("current");
	const [graphLoading, setGraphLoading] = useState(false);
	const [graphLoadError, setGraphLoadError] = useState<string | null>(null);
	const [graphReloadSeq, setGraphReloadSeq] = useState(0);
	const loadedGraphFileRef = useRef<string | null>(null);
	const loadedGraphModeRef = useRef<GraphLoadMode | null>(null);
	const handledReloadSeqRef = useRef(0);
	const loadRequest = useRef(new LatestRequestGate());

	// 回调经 ref 保存：effect 只依赖 currentFile/graphReloadSeq，不因回调重建而重复加载。
	const onLoadStartRef = useRef(onLoadStart);
	onLoadStartRef.current = onLoadStart;
	const onLoadedRef = useRef(onLoaded);
	onLoadedRef.current = onLoaded;
	const onLoadErrorRef = useRef(onLoadError);
	onLoadErrorRef.current = onLoadError;

	useEffect(() => {
		if (!currentFile) {
			handledReloadSeqRef.current = graphReloadSeq;
			loadedGraphFileRef.current = null;
			loadedGraphModeRef.current = null;
			setGraph(null);
			setLoadedGraphFile(null);
			setLoadedGraphMode(null);
			setCompatibility("current");
			setGraphLoading(false);
			setGraphLoadError(null);
			return;
		}
		const sameFile = loadedGraphFileRef.current === currentFile;
		const reloading = graphReloadSeq !== handledReloadSeqRef.current;
		if (sameFile && graphLoadModeSatisfied(loadedGraphModeRef.current, loadMode) && !reloading) {
			setGraphLoading(false);
			setGraphLoadError(null);
			return;
		}
		handledReloadSeqRef.current = graphReloadSeq;
		const reason = reloading ? "reload" : sameFile ? "upgrade" : "file";
		onLoadStartRef.current({ file: currentFile, mode: loadMode, reason });
		setGraphLoading(true);
		setGraphLoadError(null);
		if (!sameFile) {
			setGraph(null);
			setLoadedGraphFile(null);
			setLoadedGraphMode(null);
			setCompatibility("current");
			loadedGraphFileRef.current = null;
			loadedGraphModeRef.current = null;
		}
		savePref("lastGraph", currentFile);
		const controller = loadRequest.current.start();
		loadGraphDocument(currentFile, loadMode, { signal: controller.signal, context: "加载图谱" })
			.then((loaded) => {
				if (!loadRequest.current.isCurrent(controller)) return;
				const g = loaded.graph;
				if (!g?.elements || !Array.isArray(g.elements.nodes) || !Array.isArray(g.elements.edges)) {
					throw new Error("图谱响应格式错误");
				}
				setGraph(g);
				setLoadedGraphFile(currentFile);
				setLoadedGraphMode(loaded.mode);
				setCompatibility(loaded.compatibility);
				loadedGraphFileRef.current = currentFile;
				loadedGraphModeRef.current = loaded.mode;
				onLoadedRef.current(g);
			})
			.catch((e) => {
				if ((e as Error).name !== "AbortError" && loadRequest.current.isCurrent(controller)) {
					setGraphLoadError((e as Error).message || String(e));
					onLoadErrorRef.current((e as Error).message || String(e), currentFile);
				}
			})
			.finally(() => {
				if (loadRequest.current.finish(controller)) setGraphLoading(false);
			});
		return () => loadRequest.current.cancel();
	}, [currentFile, graphReloadSeq, loadMode]);

	const reloadGraph = useCallback(() => setGraphReloadSeq((seq) => seq + 1), []);
	return {
		graph,
		loadedGraphFile,
		loadedGraphMode,
		compatibility,
		graphLoading,
		graphLoadError,
		reloadGraph,
	};
}
