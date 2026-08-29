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

/**
 * F3：所有会卸载编辑器（标注面板等）的工作区切换统一入口。
 * App 里凡是不经 navigateView 直改 view/codeWorkspace 的路径都必须包在这里，
 * 避免守卫在多个回调里复制后漂移成第二种口径。
 */
export function guardedWorkspaceSwitch(
	apply: () => void,
	confirm: (message: string) => boolean = (message) => window.confirm(message),
): void {
	if (!confirmDiscardUnsavedChanges(confirm)) return;
	apply();
}
