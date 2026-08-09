// Graph Brain / viewer - Toast 通知系统（F6）：右下角队列 + 自动消失 + 手动关闭
//
// DECISION: 模块级 toast() 函数 + 订阅式 ToastHost，而非 React Context
// REASON: 通知发起方遍布 App/编辑器 hook/各面板，Context 需要层层穿 Provider；
//         模块级单例订阅在单页单宿主场景更简单，且 ToastHost 卸载时自动退订无泄漏。
// DATE: 2026-07-10
// G2 (2026-08-07): 退出动画（滑出+淡出）+ 生命进度条（悬停暂停）+ 队列上限
//   （超过 MAX_VISIBLE 丢弃最早的一条，防止高频错误刷屏堆叠）。

import { useEffect, useState } from "react";
import { EXIT_MS } from "../../src/motion";

export type ToastKind = "info" | "success" | "error";

export interface ToastItem {
	id: number;
	kind: ToastKind;
	message: string;
	/** 毫秒；error 默认停留更久 */
	duration: number;
}

type Listener = (items: ToastItem[]) => void;

/** 同屏最多可见的通知数；超出后新通知会挤掉最早的（FIFO） */
const MAX_VISIBLE = 5;

let seq = 0;
let items: ToastItem[] = [];
const listeners = new Set<Listener>();

function emit() {
	for (const l of listeners) l(items);
}

/** 弹出一条通知；返回 id（一般无需关心） */
export function toast(message: string, kind: ToastKind = "info", duration?: number): number {
	const id = ++seq;
	// FIFO：超过上限时丢弃最早一条（无退出动画，直接移除——新通知更值得停留）
	if (items.length >= MAX_VISIBLE) items = items.slice(items.length - MAX_VISIBLE + 1);
	items = [...items, { id, kind, message, duration: duration ?? (kind === "error" ? 8000 : 4000) }];
	emit();
	return id;
}

export function dismissToast(id: number): void {
	items = items.filter((t) => t.id !== id);
	emit();
}

const KIND_ICON: Record<ToastKind, string> = { info: "ℹ", success: "✓", error: "✕" };

function ToastCard({ item }: { item: ToastItem }) {
	// 退出周期状态：时间到后先播滑出动画，动画结束再真正移除
	const [leaving, setLeaving] = useState(false);
	const [paused, setPaused] = useState(false);

	useEffect(() => {
		if (leaving) return;
		if (paused) return;
		const t = setTimeout(() => {
			setLeaving(true);
			// 动画结束后移除（与 .toast.gb-exiting 的时长一致）
			setTimeout(() => dismissToast(item.id), EXIT_MS);
		}, item.duration);
		return () => clearTimeout(t);
	}, [item.id, item.duration, paused, leaving]);

	return (
		<div
			className={`toast toast-${item.kind}${leaving ? " gb-exiting" : ""}`}
			role={item.kind === "error" ? "alert" : "status"}
			onMouseEnter={() => setPaused(true)}
			onMouseLeave={() => setPaused(false)}
		>
			<span className="toast-icon" aria-hidden="true">{KIND_ICON[item.kind]}</span>
			<span className="toast-msg">{item.message}</span>
			<button className="toast-close" aria-label="关闭通知" onClick={() => dismissToast(item.id)}>
				✕
			</button>
			{/* G2 生命进度条：宽度 100%→0，与停留时长同步；悬停暂停 */}
			{!leaving ? (
				<span
					className={`toast-progress toast-progress-${item.kind}`}
					style={{ animationDuration: `${item.duration}ms`, animationPlayState: paused ? "paused" : "running" }}
					aria-hidden="true"
				/>
			) : null}
		</div>
	);
}

/** 通知宿主：挂在 App 根部一处即可 */
export default function ToastHost() {
	const [list, setList] = useState<ToastItem[]>(items);
	useEffect(() => {
		const l: Listener = (next) => setList(next);
		listeners.add(l);
		return () => {
			listeners.delete(l);
		};
	}, []);
	if (list.length === 0) return null;
	return (
		<div className="toast-host" aria-live="polite">
			{list.map((t) => (
				<ToastCard key={t.id} item={t} />
			))}
		</div>
	);
}
