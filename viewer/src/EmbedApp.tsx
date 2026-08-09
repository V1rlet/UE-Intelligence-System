// Graph Brain / viewer - /embed 只读嵌入视图（P4U5）
//
// URL 形态（vite.config.ts 中间件把 /embed/* 重写到本页）：
//   /embed/<domain>/<subsystem>[?focus=<nodeId>]   —— 解析该域/子系统的最新图（稳定 URL，
//                                                     AFFiNE 等外部文档嵌入用，重发布不换链接）
//   /embed/<完整文件名>.cyto.json[?focus=<nodeId>]  —— 精确锁定某一份图文件
//
// 只读：无标注写入、无规划图编辑、无 Spec 页；保留平移/缩放/点击详情/focus 深链。
// 右上角"在 GraphBrain 打开"跳完整查看器。

import { useEffect, useMemo, useState } from "react";
import GraphView, { type GraphElements } from "../components/graph-view/GraphView";
import { apiFetchJson } from "./apiFetch";
import { loadGraphFile } from "./loadGraphFile";

interface GraphFile {
	meta?: Record<string, unknown>;
	elements: GraphElements;
}

/** 从 location 解析嵌入目标；非法路径返回 null */
function parseTarget(): { file?: string; domain?: string; subsystem?: string; focus?: string } | null {
	const parts = decodeURIComponent(window.location.pathname).split("/").filter(Boolean);
	if (parts[0] !== "embed" || parts.length < 2) return null;
	const focus = new URLSearchParams(window.location.search).get("focus") ?? undefined;
	if (parts.length === 2 && parts[1].endsWith(".cyto.json")) return { file: parts[1], focus };
	if (parts.length === 3) return { domain: parts[1], subsystem: parts[2], focus };
	return null;
}

export default function EmbedApp() {
	const target = useMemo(parseTarget, []);
	const [file, setFile] = useState<string | null>(target?.file ?? null);
	const [graph, setGraph] = useState<GraphFile | null>(null);
	const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
	const [error, setError] = useState<string | null>(
		target ? null : "无效的嵌入地址：应为 /embed/<domain>/<subsystem> 或 /embed/<file>.cyto.json",
	);
	const [focusReq, setFocusReq] = useState<{ id: string; seq: number } | null>(null);

	// —— 目标解析：domain/subsystem 形态先查列表取最新一份 ——
	useEffect(() => {
		if (!target || target.file) return;
		const controller = new AbortController();
		apiFetchJson<Array<{ file: string }>>(
			"/api/graph-catalog",
			{ signal: controller.signal },
			{ notify: false, context: "图谱目录" },
		)
			.then((catalog: Array<{ file: string }>) => {
				if (!Array.isArray(catalog)) throw new Error("图谱目录响应格式错误");
				const prefix = `${target.domain}_${target.subsystem}_`;
				const hit = catalog.find((f) => f.file.startsWith(prefix) && f.file.endsWith(".cyto.json"));
				if (hit) setFile(hit.file);
				else setError(`没有 ${target.domain}/${target.subsystem} 的图谱文件`);
			})
			.catch((e) => {
				if ((e as Error).name !== "AbortError") setError(`获取图谱目录失败: ${e}`);
			});
		return () => controller.abort();
	}, [target]);

	useEffect(() => {
		if (!file) return;
		const controller = new AbortController();
		loadGraphFile<GraphFile>(file, { signal: controller.signal, context: "嵌入图谱" })
			.then((g: GraphFile) => {
				if (!g?.elements || !Array.isArray(g.elements.nodes) || !Array.isArray(g.elements.edges)) {
					throw new Error("图谱响应格式错误");
				}
				setGraph(g);
				if (target?.focus) setFocusReq({ id: target.focus, seq: 1 });
			})
			.catch((e) => {
				if ((e as Error).name !== "AbortError") setError(`加载图谱失败: ${e}`);
			});
		return () => controller.abort();
	}, [file, target]);

	const domain = graph?.meta?.domain ? String(graph.meta.domain) : "ue5_code";
	const title = graph?.meta?.title ? String(graph.meta.title) : file ?? "";

	return (
		<div className="app embed-app">
			<header className="topbar embed-bar">
				<span className="embed-title" title={file ?? ""}>🕸 {title}</span>
				<span className="embed-spacer" />
				<a className="embed-open-full" href="/" target="_blank" rel="noreferrer">
					在 Graph Brain 打开 ↗
				</a>
			</header>
			<main className="workspace embed-main">
				{error ? <div className="error-banner">{error}</div> : null}
				{graph ? (
					<>
						<div className="graph-col">
							<GraphView
								elements={graph.elements}
								domain={domain}
								onSelect={setSelected}
								focusRequest={focusReq}
								viewportKey={file ?? undefined}
							/>
						</div>
						{selected ? (
							<aside className="detail-panel embed-detail">
								<h2>{String(selected.label ?? selected.id)}</h2>
								{selected.description ? <p>{String(selected.description)}</p> : null}
								<table>
									<tbody>
										{["id", "type", "layer", "module", "source_path"]
											.filter((k) => selected[k] !== undefined)
											.map((k) => (
												<tr key={k}>
													<td className="field-name">{k}</td>
													<td>{String(selected[k])}</td>
												</tr>
											))}
									</tbody>
								</table>
								<button className="embed-close" onClick={() => setSelected(null)}>关闭</button>
							</aside>
						) : null}
					</>
				) : !error ? (
					<p className="hint">加载中…</p>
				) : null}
			</main>
		</div>
	);
}
