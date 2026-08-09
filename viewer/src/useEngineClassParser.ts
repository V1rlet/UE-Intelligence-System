/**
 * useEngineClassParser — UE 引擎类按需解析（P3U1）。
 *
 * 解析请求状态、候选判定，以及独立引擎事实集的增量合并。
 * 项目图不会被引擎按需解析结果污染；源码与 API 视图消费同一事实集。
 *
 * engineCandidate 只把项目搜索中的类名候选导向引擎来源，不改变项目森林事实。
 *
 * App 仍是唯一消费者（单组件拥有者）。后续 Context 化时此 hook 可直接提升。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { graphSourceRootQuery } from "../../core/schema/graph-version";
import { apiFetchJson } from "./apiFetch";
import type { GraphElements } from "../components/graph-view/GraphView";
import type { GraphFile } from "./useGraphDocument";

// ── 共享类型（原 App.tsx 内联） ────────────────────────────────
export type EngineFetchState = { state: "idle" | "loading" | "error"; msg?: string };

// ── Hook 参数 ──────────────────────────────────────────────────
export interface UseEngineClassParserOptions {
	/** 当前事实图（解析参数与候选判定都基于它） */
	graph: GraphFile | null;
	/** 项目图判定（引擎解析入口仅对项目森林图开放） */
	isProjectGraph: boolean;
	/** 森林搜索词（形如引擎类标识符时提供「从引擎解析」入口） */
	forestQuery: string;
}

// ── Hook 返回值 ────────────────────────────────────────────────
export interface EngineClassParserState {
	/** 解析请求状态（loading 时搜索框显示进度；error 显示原因） */
	engineFetch: EngineFetchState;
	setEngineFetch: React.Dispatch<React.SetStateAction<EngineFetchState>>;
	/** 当前搜索词是否形如引擎类标识符（图中无真实解析节点时提供解析入口） */
	engineCandidate: string | null;
	/** 解析引擎类：并入图 + 定位文件叶（成功 true；失败 false，调用方决定提示） */
	parseEngineClass: (name: string, sourcePath?: string) => Promise<boolean>;
	/** Parsed engine facts are kept separate from project facts for every lens. */
	engineElements: GraphElements;
	parsedClassNames: Set<string>;
	parsingClassNames: Set<string>;
}

function mergeElements(previous: GraphElements, increment: GraphElements): GraphElements {
	const nodeById = new Map(previous.nodes.map((node) => [String(node.data.id), node]));
	for (const node of increment.nodes ?? []) {
		const id = String(node.data.id);
		const old = nodeById.get(id);
		const oldData = old?.data as { source_path?: string; type?: string; classes?: string[] } | undefined;
		const newData = node.data as { source_path?: string; type?: string; classes?: string[] };
		if (!old || (!oldData?.source_path && newData.source_path)) nodeById.set(id, node);
		else if (oldData?.type === "file" && newData.classes?.length) {
			nodeById.set(id, { ...old, data: { ...old.data, classes: [...new Set([...(oldData?.classes ?? []), ...newData.classes])] } });
		}
	}
	const edgeById = new Map(previous.edges.map((edge) => [String(edge.data.id), edge]));
	for (const edge of increment.edges ?? []) edgeById.set(String(edge.data.id), edge);
	return { nodes: [...nodeById.values()], edges: [...edgeById.values()] };
}

export function useEngineClassParser({
	graph,
	isProjectGraph,
	forestQuery,
}: UseEngineClassParserOptions): EngineClassParserState {
	// 按需引擎类解析（P3U1）状态
	const [engineFetch, setEngineFetch] = useState<EngineFetchState>({ state: "idle" });
	const [engineElements, setEngineElements] = useState<GraphElements>({ nodes: [], edges: [] });
	const [parsingClassNames, setParsingClassNames] = useState<Set<string>>(new Set());
	const parseRequests = useRef(new Map<string, Promise<boolean>>());
	const sourceGeneration = useRef(0);
	const sourceRoot = graphSourceRootQuery(graph?.meta);

	useEffect(() => {
		sourceGeneration.current += 1;
		parseRequests.current.clear();
		setEngineElements({ nodes: [], edges: [] });
		setParsingClassNames(new Set());
		setEngineFetch({ state: "idle" });
	}, [sourceRoot]);

	// 标识符形态即给入口（拼写/是否存在交服务端精确校验，会就地报错）；
	// 图中已有真实解析节点（有 source_path）则不提供；无 source_path 的 stub 允许升级
	const engineCandidate = useMemo(() => {
		const q = forestQuery.trim();
		if (!graph || !isProjectGraph || !/^[A-Za-z]\w{2,}$/.test(q)) return null;
		const existing = graph.elements.nodes.find((n) => String(n.data.id) === q);
		if (existing && (existing.data as { source_path?: string }).source_path) return null;
		return q;
	}, [forestQuery, graph, isProjectGraph]);

	const parsedClassNames = useMemo(() => new Set(engineElements.nodes
		.map((node) => node.data as { id?: unknown; type?: unknown })
		.filter((node) => node.type === "uclass" || node.type === "ustruct" || node.type === "uenum" || node.type === "class" || node.type === "struct" || node.type === "enum")
		.map((node) => String(node.id))), [engineElements]);

	const mergeIncrement = (inc: GraphElements) => {
		setEngineElements((previous) => mergeElements(previous, inc));
	};

	const parseEngineClass = (name: string, sourcePath?: string): Promise<boolean> => {
		const generation = sourceGeneration.current;
		const key = `${sourceRoot}\u0000${name}\u0000${sourcePath ?? ""}`;
		const pending = parseRequests.current.get(key);
		if (pending) return pending;
		const request = (async () => {
			setParsingClassNames((current) => new Set(current).add(name));
			setEngineFetch({ state: "loading" });
			try {
				const params = new URLSearchParams();
				if (sourceRoot) params.set("source_root", sourceRoot);
				if (sourcePath) params.set("source_path", sourcePath);
				const queryString = params.size > 0 ? `?${params}` : "";
				const body = await apiFetchJson<GraphElements & { error?: string }>(`/api/engine-class/${encodeURIComponent(name)}${queryString}`);
				if (generation !== sourceGeneration.current) return false;
				mergeIncrement(body);
				return true;
			} catch (e) {
				if (generation === sourceGeneration.current) setEngineFetch({ state: "error", msg: String(e) });
				return false;
			} finally {
				parseRequests.current.delete(key);
				if (generation === sourceGeneration.current) {
					const sameClassPending = [...parseRequests.current.keys()].some((requestKey) => requestKey.startsWith(`${sourceRoot}\u0000${name}\u0000`));
					if (!sameClassPending) setParsingClassNames((current) => {
						const next = new Set(current);
						next.delete(name);
						return next;
					});
					if (parseRequests.current.size === 0) setEngineFetch((state) => state.state === "error" ? state : { state: "idle" });
				}
			}
		})();
		parseRequests.current.set(key, request);
		return request;
	};

	return { engineFetch, setEngineFetch, engineCandidate, parseEngineClass, engineElements, parsedClassNames, parsingClassNames };
}
