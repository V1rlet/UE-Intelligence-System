// Graph Brain / viewer - 模态焦点管理：圈定 Tab 导航并在关闭后恢复触发点
import { useEffect, useRef } from "react";

const FOCUSABLE = [
	"button:not([disabled])",
	"input:not([disabled])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	"a[href]",
	'[tabindex]:not([tabindex="-1"])',
].join(",");

/** 为模态对话框提供初始焦点、Tab 焦点圈定和关闭后的焦点恢复。 */
export function useDialogFocus<T extends HTMLElement>(open = true) {
	const dialogRef = useRef<T>(null);

	useEffect(() => {
		if (!open) return;
		const previous = document.activeElement instanceof HTMLElement
			? document.activeElement
			: null;
		const frame = requestAnimationFrame(() => {
			dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
		});
		const trapTab = (event: KeyboardEvent) => {
			if (event.key !== "Tab" || !dialogRef.current) return;
			const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
				.filter((element) => element.offsetParent !== null);
			if (focusable.length === 0) {
				event.preventDefault();
				return;
			}
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			const active = document.activeElement;
			if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && active === last) {
				event.preventDefault();
				first.focus();
			}
		};
		window.addEventListener("keydown", trapTab, true);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("keydown", trapTab, true);
			if (previous?.isConnected) previous.focus();
		};
	}, [open]);

	return dialogRef;
}

