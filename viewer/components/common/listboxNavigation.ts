export function nextListboxOptionIndex(current: number, count: number, key: string): number | null {
	if (count <= 0 || current < 0 || current >= count) return null;
	if (key === "ArrowDown") return Math.min(count - 1, current + 1);
	if (key === "ArrowUp") return Math.max(0, current - 1);
	if (key === "Home") return 0;
	if (key === "End") return count - 1;
	return null;
}
