// Graph Brain / viewer - 样式表合成：基底 JSON + Adapter nodeTypes 声明 → Cytoscape 样式表
//
// P4U1：域→样式表映射与节点类型规则不再硬编码在查看器，改为读 adapters/registry 的
// DomainMeta 声明。基底 JSON（*.style-base.json）保留交互态/层配色/边样式等查看器知识，
// 其中 "::node-type::X" 占位符在合成时被替换为 node[type = 'X'] 规则（style 来自
// meta.nodeTypes[].style），占位符原位回填保证与旧样式表逐规则等价（Cytoscape 样式
// 按顺序覆盖，规则顺序就是视觉行为的一部分）。

import type { StylesheetJson } from "cytoscape";
import { DOMAIN_METAS } from "../../adapters/registry";
import { StyleRule, LOD_RULES, READABILITY_RULES, INTERACTION_RULES, MOTION_RULES } from "./styles-extras";
import ue5CodeBase from "./ue5-code.style-base.json";


const NODE_TYPE_PLACEHOLDER = "::node-type::";

// P6U3 耦合热力图：按 data(heatColor) 着色（由 GraphView 动态写入）
const HEATMAP_RULES: StyleRule[] = [
	{
		selector: "node.heatmap-colored",
		style: {
			"background-color": "data(heatColor)",
			"border-color": "data(heatColor)",
			"border-width": 3,
			opacity: 1,
		},
	},
	{
		selector: "node.cycle-member",
		style: {
			"border-color": "#ff4444",
			"border-width": 4,
			"border-style": "dashed",
		},
	},
];

/** 各域的基底样式表（查看器侧知识：交互态/高亮/边样式/层配色） */
const BASE_BY_DOMAIN: Record<string, StyleRule[]> = {
	ue5_code: ue5CodeBase as StyleRule[],
};

function compose(domain: string, motion: boolean): StylesheetJson {
	if (domain !== "ue5_code") throw new Error(`GraphBrain 只提供 ue5_code 样式，收到 ${domain}`);
	const meta = DOMAIN_METAS.ue5_code;

	const base = BASE_BY_DOMAIN.ue5_code as StyleRule[];
	const styleByType = new Map(
		meta.nodeTypes.filter((t) => t.style).map((t) => [t.type, t.style!]),
	);
	const composed = base.map((rule) => {
		if (!rule.selector.startsWith(NODE_TYPE_PLACEHOLDER)) return rule;
		const type = rule.selector.slice(NODE_TYPE_PLACEHOLDER.length);
		const style = styleByType.get(type);
		if (!style) {
			throw new Error(`样式合成失败：域 ${domain} 的 nodeTypes 声明缺少类型 ${type} 的 style`);
		}
		return { selector: `node[type = '${type}']`, style };
	});
	return [
		...composed,
		...LOD_RULES,
		...READABILITY_RULES,
		...INTERACTION_RULES,
		...HEATMAP_RULES,
		...(motion ? MOTION_RULES : []),
	] as StylesheetJson;
}

const cache = new Map<string, StylesheetJson>();

/** 按 domain 取合成后的 Cytoscape 样式表（未登记的域回退 ue5_code 视觉）；
 *  motion=true 附加类切换样式过渡（调用方按元素量/无障碍偏好门控） */
export function stylesheetFor(domain?: string, motion = false): StylesheetJson {
	const key = `${domain ?? "ue5_code"}${motion ? "|motion" : ""}`;
	let sheet = cache.get(key);
	if (!sheet) {
		sheet = compose(domain ?? "ue5_code", motion);
		cache.set(key, sheet);
	}
	return sheet;
}
