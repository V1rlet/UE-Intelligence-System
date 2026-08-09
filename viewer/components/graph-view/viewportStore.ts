// Graph Brain / viewer - 视口记忆仓库（F6 修缮）：按 key 记住每张图/每个 Spec 页的 pan/zoom
//
// DECISION: 模块级 Map（会话内存），不落 localStorage
// REASON: 组件卸载（进出 Spec 页、切视图）会丢掉组件内 ref 的视口，跨挂载记忆必须上提；
//         但跨会话持久化有害——图谱重新提取/布局后旧坐标对不上内容，反而呈现空白区。
//         参照 UE 蓝图编辑器：视口记忆是"本次打开期间的 tab 状态"，重开编辑器回到入口焦点。
// DATE: 2026-07-10

export interface Viewport {
	zoom: number;
	pan: { x: number; y: number };
}

const store = new Map<string, Viewport>();

export function saveViewport(key: string, vp: Viewport): void {
	store.set(key, vp);
}

export function loadViewport(key: string): Viewport | undefined {
	return store.get(key);
}
