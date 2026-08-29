// Graph Brain / viewer - 通用右键菜单（F6）：在指定坐标弹出的操作列表
//
// 关闭时机：点击任意处 / Esc / 选中某项。菜单贴近视口边缘时自动翻转方向。

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EXIT_MS } from "../../src/motion";
import { nextMenuItemIndex } from "./menuNavigation";

export interface MenuItem {
	label: string;
	icon?: string;
	/** 右侧灰字提示（如快捷键 / 补充说明） */
	hint?: string;
	disabled?: boolean;
	onClick: () => void;
}

export type MenuEntry = MenuItem | "separator";

interface Props {
	id?: string;
	/** 相对视口的弹出坐标 */
	x: number;
	y: number;
	items: MenuEntry[];
	onClose: () => void;
}

export default function ContextMenu({ id, x, y, items, onClose }: Props) {
	const ref = useRef<HTMLDivElement>(null);
	const previousFocusRef = useRef<HTMLElement | null>(null);
	const focusRestoredRef = useRef(false);
	const [pos, setPos] = useState({ x, y });
	const [activeIndex, setActiveIndex] = useState(0);
	const enabledCount = items.filter((item) => item !== "separator" && !item.disabled).length;
	// G1：自管退出——所有关闭路径先触发退出动画，动画结束（EXIT_MS）后真正 onClose（父级卸载）
	const [exiting, setExiting] = useState(false);
	const exitingRef = useRef(false);
	const closeTimer = useRef<number | null>(null);
	const restoreFocus = useCallback(() => {
		if (focusRestoredRef.current) return;
		focusRestoredRef.current = true;
		if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus({ preventScroll: true });
	}, []);
	const closeSoon = useCallback(() => {
		if (exitingRef.current) return;
		exitingRef.current = true;
		restoreFocus();
		setExiting(true);
		closeTimer.current = window.setTimeout(onClose, EXIT_MS);
	}, [onClose, restoreFocus]);

	useEffect(() => () => {
		if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
		restoreFocus();
	}, [restoreFocus]);

	useLayoutEffect(() => {
		previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const frame = requestAnimationFrame(() => {
			const first = ref.current?.querySelector<HTMLElement>('[data-menu-index="0"]');
			(first ?? ref.current)?.focus({ preventScroll: true });
		});
		return () => cancelAnimationFrame(frame);
	}, []);

	// 贴边翻转：渲染后量实际尺寸，超出视口则往回收
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const r = el.getBoundingClientRect();
		setPos({
			x: x + r.width > window.innerWidth - 8 ? Math.max(x - r.width, 8) : x,
			y: y + r.height > window.innerHeight - 8 ? Math.max(y - r.height, 8) : y,
		});
	}, [x, y]);

	useEffect(() => {
		const onDown = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) closeSoon();
		};
		window.addEventListener("mousedown", onDown);
		return () => {
			window.removeEventListener("mousedown", onDown);
		};
	}, [closeSoon]);

	const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			closeSoon();
			return;
		}
		if (event.key === "Tab") {
			closeSoon();
			return;
		}
		const next = nextMenuItemIndex(activeIndex, enabledCount, event.key);
		if (next === null) return;
		event.preventDefault();
		event.stopPropagation();
		setActiveIndex(next);
		ref.current?.querySelector<HTMLElement>(`[data-menu-index="${next}"]`)?.focus({ preventScroll: true });
	};

	let enabledIndex = -1;

	return (
		<div id={id} className={`ctx-menu${exiting ? " gb-exiting" : ""}`} role="menu" ref={ref} tabIndex={enabledCount ? undefined : -1} data-app-shortcuts="block" style={{ left: pos.x, top: pos.y }} aria-hidden={exiting} onKeyDown={onMenuKeyDown}>
			{items.map((item, i) =>
				item === "separator" ? (
					<div key={`sep-${i}`} className="ctx-sep" role="separator" />
				) : (() => {
					const menuIndex = item.disabled ? -1 : ++enabledIndex;
					return (
					<button
						key={item.label}
						role="menuitem"
						className="ctx-item"
						disabled={item.disabled}
						tabIndex={menuIndex === activeIndex ? 0 : -1}
						data-menu-index={menuIndex >= 0 ? menuIndex : undefined}
						onFocus={() => menuIndex >= 0 && setActiveIndex(menuIndex)}
						onMouseEnter={() => menuIndex >= 0 && setActiveIndex(menuIndex)}
						onClick={() => {
							closeSoon();
							item.onClick();
						}}
					>
						<span className="ctx-icon" aria-hidden="true">{item.icon ?? ""}</span>
						<span className="ctx-label">{item.label}</span>
						{item.hint ? <span className="ctx-hint">{item.hint}</span> : null}
					</button>
					);
				})(),
			)}
		</div>
	);
}
