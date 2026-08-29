import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export type RovingTabKey = "ArrowLeft" | "ArrowRight" | "Home" | "End";

/** Pure index resolver shared by every horizontal tablist. */
export function nextRovingTabIndex(current: number, count: number, key: string): number | null {
	if (count <= 0 || current < 0 || current >= count) return null;
	if (key === "Home") return 0;
	if (key === "End") return count - 1;
	if (key === "ArrowRight") return (current + 1) % count;
	if (key === "ArrowLeft") return (current - 1 + count) % count;
	return null;
}

export function rovingTabStop(selected: boolean): 0 | -1 {
	return selected ? 0 : -1;
}

/** Automatic activation keeps focus, aria-selected and visible content in sync. */
export function handleRovingTabKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
	if (!(event.target instanceof Element)) return;
	const current = event.target.closest<HTMLElement>('[role="tab"]');
	if (!current || !event.currentTarget.contains(current)) return;
	const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not([aria-disabled="true"]):not(:disabled)')];
	const nextIndex = nextRovingTabIndex(tabs.indexOf(current), tabs.length, event.key);
	if (nextIndex === null) return;
	event.preventDefault();
	const next = tabs[nextIndex];
	next.focus();
	if (next !== current) next.click();
}
