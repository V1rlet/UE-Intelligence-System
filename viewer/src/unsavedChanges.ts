type DirtyProbe = () => boolean;

const dirtyProbes = new Map<symbol, DirtyProbe>();

export function registerUnsavedChanges(probe: DirtyProbe): () => void {
	const key = Symbol("unsaved-change");
	dirtyProbes.set(key, probe);
	return () => dirtyProbes.delete(key);
}

export function hasUnsavedChanges(): boolean {
	for (const probe of dirtyProbes.values()) {
		try {
			if (probe()) return true;
		} catch {
			// A stale editor must not break navigation; its cleanup will remove the probe.
		}
	}
	return false;
}

export function confirmDiscardUnsavedChanges(
	confirm: (message: string) => boolean = (message) => window.confirm(message),
): boolean {
	return !hasUnsavedChanges() || confirm("当前有尚未保存的更改。要放弃更改并切换工作区吗？");
}
