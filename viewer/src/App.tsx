// Graph Brain / viewer - 应用骨架：图谱文件选择 + Graph Explorer View + 节点详情侧边栏
import { useEffect, useState } from "react";
import AnnotationPanel from "../components/annotation-panel/AnnotationPanel";
import GraphView, { type GraphElements } from "../components/graph-view/GraphView";

interface GraphFile {
	meta?: Record<string, unknown>;
	elements: GraphElements;
}

export default function App() {
	const [graphList, setGraphList] = useState<string[]>([]);
	const [currentFile, setCurrentFile] = useState<string | null>(null);
	const [graph, setGraph] = useState<GraphFile | null>(null);
	const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		fetch("/api/graphs")
			.then((r) => r.json())
			.then((files: string[]) => {
				setGraphList(files);
				if (files.length > 0) setCurrentFile(files[0]);
				else setError("data/graphs/ 下没有 .cyto.json，请先运行 npm run extract:ue5-modules");
			})
			.catch((e) => setError(`获取图谱列表失败: ${e}`));
	}, []);

	useEffect(() => {
		if (!currentFile) return;
		setSelected(null);
		fetch(`/data/graphs/${currentFile}`)
			.then((r) => r.json())
			.then(setGraph)
			.catch((e) => setError(`加载图谱失败: ${e}`));
	}, [currentFile]);

	return (
		<div className="app">
			<header className="topbar">
				<h1>Graph Brain</h1>
				<select
					value={currentFile ?? ""}
					onChange={(e) => setCurrentFile(e.target.value)}
					disabled={graphList.length === 0}
				>
					{graphList.map((f) => (
						<option key={f} value={f}>{f}</option>
					))}
				</select>
				{graph?.meta ? (
					<span className="meta-hint">
						{String(graph.meta.domain ?? "")} · 生成于 {String(graph.meta.generated_at ?? "?")}
					</span>
				) : null}
			</header>

			<main className="workspace">
				{error ? <div className="error-banner">{error}</div> : null}
				{graph ? <GraphView elements={graph.elements} onSelect={setSelected} /> : null}

				<aside className="detail-panel">
					{selected ? (
						<>
							<h2>{String(selected.label ?? selected.id)}</h2>
							<table>
								<tbody>
									{Object.entries(selected)
										.filter(([k]) => k !== "size")
										.map(([k, v]) => (
											<tr key={k}>
												<td className="field-name">{k}</td>
												<td>{typeof v === "object" ? JSON.stringify(v) : String(v)}</td>
											</tr>
										))}
								</tbody>
							</table>
							<AnnotationPanel
								nodeId={String(selected.id)}
								domain={String(graph?.meta?.domain ?? "ue5_code")}
								subsystem={String(graph?.meta?.subsystem ?? "modules")}
							/>
						</>
					) : (
						<p className="hint">点击节点查看详情；拖拽平移，滚轮缩放。</p>
					)}
				</aside>
			</main>
		</div>
	);
}
