// Graph Brain / viewer - Graph Explorer View：Cytoscape.js 力导向渲染 + 点击选中
import cytoscape, { type EdgeDefinition, type NodeDefinition, type StylesheetJson } from "cytoscape";
import { useEffect, useRef } from "react";
import cytoStyle from "../../styles/ue5-code.cyto-style.json";

export interface GraphElements {
	nodes: NodeDefinition[];
	edges: EdgeDefinition[];
}

interface Props {
	elements: GraphElements;
	onSelect: (data: Record<string, unknown> | null) => void;
}

export default function GraphView({ elements, onSelect }: Props) {
	const containerRef = useRef<HTMLDivElement>(null);
	const onSelectRef = useRef(onSelect);
	onSelectRef.current = onSelect;

	useEffect(() => {
		if (!containerRef.current) return;

		// JSON stylesheet 只能做 data(...) 映射，无法在样式表里算度数，
		// 因此加载时预计算 degree → data.size，样式表用 data(size) 取值
		const nodes = elements.nodes.map((n) => {
			const metrics = (n.data as { metrics?: { in_degree?: number; out_degree?: number } }).metrics;
			const degree = (metrics?.in_degree ?? 0) + (metrics?.out_degree ?? 0);
			return { ...n, data: { ...n.data, size: 28 + Math.min(degree, 20) * 3 } };
		});

		const cy = cytoscape({
			container: containerRef.current,
			elements: { nodes, edges: elements.edges },
			style: cytoStyle as StylesheetJson,
			layout: { name: "cose", animate: false, padding: 40 },
			wheelSensitivity: 0.2,
		});

		cy.on("tap", "node", (evt) => onSelectRef.current(evt.target.data()));
		cy.on("tap", (evt) => {
			if (evt.target === cy) onSelectRef.current(null);
		});

		return () => cy.destroy();
	}, [elements]);

	return <div className="graph-canvas" ref={containerRef} />;
}
