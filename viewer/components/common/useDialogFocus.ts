// Graph Brain / viewer - 模态焦点管理：圈定 Tab 导航并在关闭后恢复触发点
import { useEffect, useRef } from "react";

const FOCUSABLE = [
	'button:not([disabled]):not([tabindex="-1"])',
	'input:not([disabled]):not([tabindex="-1"])',
	'select:not([disabled]):not([tabindex="-1"])',
	'textarea:not([disabled]):not([tabindex="-1"])',
	'a[href]:not([tabindex="-1"])',
	'[tabindex]:not([tabindex="-1"])',
].join(",");

const dialogStack: symbol[] = [];

function removeDialog(token: symbol): void {
	const index = dialogStack.lastIndexOf(token);
	if (index >= 0) dialogStack.splice(index, 1);
}

/** 为模态对话框提供初始焦点、顶层 Esc、Tab 焦点圈定和关闭后的焦点恢复。 */
export function useDialogFocus<T extends HTMLElement>(open = true, onEscape?: () => void, initialFocusSelector?: string) {
	const dialogRef = useRef<T>(null);
	const dialogTokenRef = useRef(Symbol("dialog"));
	const onEscapeRef = useRef(onEscape);
	onEscapeRef.current = onEscape;

	useEffect(() => {
		if (!open) return;
		const token = dialogTokenRef.current;
		removeDialog(token);
		dialogStack.push(token);
		const previous = document.activeElement instanceof HTMLElement
			? document.activeElement
			: null;
		const frame = requestAnimationFrame(() => {
			const dialog = dialogRef.current;
			if (!dialog) return;
			const preferred = initialFocusSelector
				? dialog.querySelector<HTMLElement>(initialFocusSelector)
				: null;
			(preferred ?? dialog.querySelector<HTMLElement>(FOCUSABLE) ?? dialog).focus();
		});
		const trapKeyboard = (event: KeyboardEvent) => {
			if (dialogStack[dialogStack.length - 1] !== token) return;
			if (event.key === "Escape" && onEscapeRef.current) {
				event.preventDefault();
				event.stopImmediatePropagation();
				onEscapeRef.current();
				return;
			}
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
		window.addEventListener("keydown", trapKeyboard, true);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("keydown", trapKeyboard, true);
			removeDialog(token);
			if (previous?.isConnected) previous.focus();
		};
	}, [initialFocusSelector, open]);

	return dialogRef;
}
