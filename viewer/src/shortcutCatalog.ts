// Keyboard operations and help consume this single read-only viewer contract.
export const SHORTCUT_KEYS = {
	global: {
		overview: "0",
		exploreArchitecture: "1",
		exploreRelations: "2",
		changes: "3",
		exploreApi: "4",
		search: "/",
		help: "?",
	},
	graph: {
		open: ["Enter"],
		exit: ["Escape"],
		menu: ["ContextMenu", "Shift+F10"],
		fit: ["f", "F", "Home"],
		zoomIn: ["+", "="],
		zoomOut: ["-", "_"],
	},
} as const;

export interface ShortcutHelpGroup {
	id: string;
	title: string;
	items: { keys: string[]; description: string }[];
}

export function shortcutHelpGroups(view: string): ShortcutHelpGroup[] {
	const groups: ShortcutHelpGroup[] = [{
		id: "global",
		title: "页面导航",
		items: [
			{ keys: ["0"], description: "回到代码事实总览" },
			{ keys: ["1"], description: "在探索中打开代码架构" },
			{ keys: ["2"], description: "在探索中打开项目关系" },
			{ keys: ["3"], description: "打开版本化代码变化" },
			{ keys: ["4"], description: "在探索中打开全部 API" },
			{ keys: ["?"], description: "打开本帮助" },
			{ keys: ["Esc"], description: "关闭当前浮层或退出聚焦" },
		],
	}];
	if (view === "graph" || view === "architecture") groups.push({
		id: "graph",
		title: "代码图阅读",
		items: [
			{ keys: ["单击"], description: "查看代码事实及直接关系" },
			{ keys: ["双击 / Enter"], description: "进入文件、类型或下一层架构" },
			{ keys: ["Shift", "F10"], description: "打开画布操作菜单" },
			{ keys: ["/"], description: "聚焦代码图搜索" },
			{ keys: ["F / Home"], description: "适配当前图" },
			{ keys: ["+ / −"], description: "放大或缩小" },
		],
	});
	return groups;
}
