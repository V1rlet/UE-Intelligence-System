// Graph Brain / adapters/ue5-code - 领域声明（DomainMeta）：节点/边类型 + 抽象层折叠规则
//
// 浏览器安全：本文件只放纯数据与纯函数（查看器 import 它生成样式表），禁止 node:* import。
//
// DECISION: 类型样式规则（node[type = 'X'] 的 style 对象）从 viewer/styles/
//           ue5-code.cyto-style.json 原样迁入本文件的 nodeTypes[].style，
//           基底样式表（层配色/边样式/交互态）留在 viewer/styles/*.style-base.json
// REASON: P4U1 要求"形状映射读 Adapter 的 nodeTypes 声明"；类型级样式是领域知识
//         （ufunction 长什么样由域定义），交互态/高亮是查看器知识（各域通用），
//         按此边界拆分后样式合成时按占位符原位回填，保证与旧样式表逐字节等价。
// DATE: 2026-07-06

import type { DomainMeta } from "../adapter-interface.js";

// 持久化图格式版本（graph.schema.json meta.format_version）：ue5_code 域当前格式。
// 本域无历史迁移，当前即 1；显式声明使磁盘数据不依赖隐式猜测。
export { UE5_CODE_GRAPH_FORMAT } from "../../core/schema/graph-version.js";

export const ue5CodeMeta: DomainMeta = {
	domain: "ue5_code",
	displayName: "UE5 代码架构",

	nodeTypes: [
		{ type: "module", label: "模块", shape: "ellipse" },
		{ type: "uclass", label: "UClass", shape: "ellipse" },
		{ type: "uactor", label: "Actor", shape: "ellipse" },
		{
			type: "ucomponent",
			label: "组件",
			shape: "round-rectangle",
			style: { shape: "round-rectangle" },
		},
		{
			type: "ustruct",
			label: "结构体",
			shape: "hexagon",
			style: { shape: "hexagon" },
		},
		{
			type: "uenum",
			label: "枚举",
			shape: "hexagon",
			style: { shape: "hexagon" },
		},
		{
			type: "uinterface",
			label: "接口",
			shape: "diamond",
			style: { shape: "diamond" },
		},
		{
			type: "ufunction",
			label: "函数",
			shape: "round-rectangle",
			style: {
				shape: "round-rectangle",
				width: "label",
				height: 20,
				padding: "5px",
				"font-size": 9,
				"text-valign": "center",
				"text-margin-y": 0,
			},
		},
		{ type: "blueprint", label: "蓝图", shape: "ellipse" },
		{
			type: "lifecycle_step",
			label: "生命周期步骤",
			shape: "right-rhomboid",
			style: {
				shape: "right-rhomboid",
				"background-color": "#203b4b",
				"border-color": "#79aeca",
				color: "#d0e3ec",
				"text-valign": "center",
				"text-margin-y": 0,
				"font-size": 10,
			},
		},
		{ type: "meta_group", label: "折叠组", shape: "ellipse" },
		{ type: "execution_lane", label: "执行通道", shape: "round-rectangle" },
		{ type: "scheduler", label: "任务调度器", shape: "hexagon" },
		{
			type: "folder",
			label: "文件夹",
			shape: "round-rectangle",
			style: {
				shape: "round-rectangle",
				width: "label",
				height: 30,
				padding: "8px",
				"background-color": "#233c49",
				"border-color": "#79aeca",
				"text-valign": "center",
				"text-margin-y": 0,
				"font-size": 12,
			},
		},
		{
			type: "file",
			label: "文件",
			shape: "cut-rectangle",
			style: {
				shape: "cut-rectangle",
				width: "label",
				height: 26,
				padding: "7px",
				"background-color": "#1d413f",
				"border-color": "#72c2bd",
				"text-valign": "center",
				"text-margin-y": 0,
				"font-size": 11,
			},
		},
		{
			type: "system",
			label: "系统（架构图）",
			shape: "round-rectangle",
			style: {
				shape: "round-rectangle",
				width: "label",
				height: 44,
				padding: "14px",
				"font-size": 13,
				"font-weight": "bold",
				"text-valign": "center",
				"text-margin-y": 0,
				"background-color": "#3e3b2d",
				"border-color": "#c5b78f",
				"border-width": 2,
				"border-style": "dashed",
				color: "#e7dfc7",
			},
		},
	],

	edgeTypes: [
		{ relation: "inherits", label: "继承", lineStyle: "solid", directed: true },
		{ relation: "implements", label: "实现接口", lineStyle: "solid", directed: true },
		{ relation: "composes", label: "组合", lineStyle: "solid", directed: true },
		{ relation: "aggregates", label: "聚合", lineStyle: "solid", directed: true },
		{ relation: "depends_on", label: "依赖", lineStyle: "solid", directed: true },
		{ relation: "delegates", label: "委托", lineStyle: "dashed", directed: true },
		{ relation: "calls", label: "调用", lineStyle: "solid", directed: true },
		{ relation: "overrides", label: "覆写", lineStyle: "dashed", directed: true },
		{ relation: "binds_event", label: "绑定事件", lineStyle: "dashed", directed: true },
		{ relation: "lifecycle_sequence", label: "生命周期顺序", lineStyle: "solid", directed: true },
		{ relation: "uses_member", label: "使用成员", lineStyle: "dashed", directed: true },
		{ relation: "contains", label: "包含（文件森林）", lineStyle: "solid", directed: true },
		{ relation: "feeds", label: "供给（架构图）", lineStyle: "solid", directed: true },
		{ relation: "owns", label: "拥有", lineStyle: "solid", directed: true },
		{ relation: "creates", label: "创建", lineStyle: "solid", directed: true },
		{ relation: "possesses", label: "占据", lineStyle: "solid", directed: true },
		{ relation: "configures", label: "配置", lineStyle: "dashed", directed: true },
		{ relation: "loads", label: "加载", lineStyle: "dashed", directed: true },
		{ relation: "activates", label: "激活", lineStyle: "solid", directed: true },
		{ relation: "injects", label: "动态注入", lineStyle: "dotted", directed: true },
		{ relation: "grants", label: "授予", lineStyle: "solid", directed: true },
		{ relation: "replicates_to", label: "复制到", lineStyle: "dashed", directed: true },
		{ relation: "binds_as_owner", label: "绑定为 ASC Owner", lineStyle: "solid", directed: true },
		{ relation: "binds_as_avatar", label: "绑定为 ASC Avatar", lineStyle: "solid", directed: true },
		{ relation: "observes", label: "监听", lineStyle: "dashed", directed: true },
		{ relation: "publishes", label: "发布状态", lineStyle: "solid", directed: true },
		{ relation: "dispatches_to", label: "派发到", lineStyle: "solid", directed: true },
		{ relation: "enqueues_to", label: "入队到", lineStyle: "dashed", directed: true },
		{ relation: "submits_to", label: "提交到", lineStyle: "solid", directed: true },
		{ relation: "synchronizes_with", label: "同步边界", lineStyle: "dotted", directed: true },
		{ relation: "completes_on", label: "完成于", lineStyle: "dashed", directed: true },
	],

	abstractionRules: {
		groupBy: "module",
		fogLabel: (group, count) => `${group}（${count} 个类）`,
		silhouetteEntryTypes: ["uactor", "uclass", "ucomponent", "uinterface"],
	},
};
