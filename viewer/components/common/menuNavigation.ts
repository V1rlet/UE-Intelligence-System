export function nextMenuItemIndex(current: number, count: number, key: string): number | null {
	if (count <= 0 || current < 0 || current >= count) return null;
	if (key === "ArrowDown") return (current + 1) % count;
	if (key === "ArrowUp") return (current - 1 + count) % count;
	if (key === "Home") return 0;
	if (key === "End") return count - 1;
	return null;
}
