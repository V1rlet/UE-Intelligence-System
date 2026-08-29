export interface VisibleTreeItem {
	id: string;
	parentId?: string;
}

/** Resolve keyboard focus within an already-expanded, flattened tree. */
export function nextTreeItemIndex(items: VisibleTreeItem[], currentIndex: number, key: string): number | null {
	if (!items.length || currentIndex < 0 || currentIndex >= items.length) return null;
	if (key === "ArrowDown") return Math.min(items.length - 1, currentIndex + 1);
	if (key === "ArrowUp") return Math.max(0, currentIndex - 1);
	if (key === "Home") return 0;
	if (key === "End") return items.length - 1;
	if (key === "ArrowRight") {
		const childIndex = items.findIndex((item, index) => index > currentIndex && item.parentId === items[currentIndex].id);
		return childIndex >= 0 ? childIndex : currentIndex;
	}
	if (key === "ArrowLeft") {
		const parentId = items[currentIndex].parentId;
		if (!parentId) return currentIndex;
		const parentIndex = items.findIndex((item) => item.id === parentId);
		return parentIndex >= 0 ? parentIndex : currentIndex;
	}
	return null;
}
