// Graph Brain / viewer - UI 偏好持久化（F6）：localStorage 读写的类型安全薄封装
//
// 键统一 "gb." 前缀；读失败（无值/解析失败/隐私模式禁 storage）一律静默回退默认值，
// UI 偏好丢失不应阻断任何功能。

export const UI_PREFS_VERSION = 2;
const LEGACY_PREFIX = "gb.";
const PREFIX = `gb.ui.v${UI_PREFS_VERSION}.`;

function migrateLegacyPref(key: string): string | null {
	const legacyKey = LEGACY_PREFIX + key;
	const raw = localStorage.getItem(legacyKey);
	if (raw === null) return null;
	// Copy first, then remove, so an interrupted migration cannot lose the value.
	localStorage.setItem(PREFIX + key, raw);
	localStorage.removeItem(legacyKey);
	return raw;
}

export function loadPref<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(PREFIX + key) ?? migrateLegacyPref(key);
		if (raw === null) return fallback;
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

export function savePref<T>(key: string, value: T): void {
	try {
		localStorage.setItem(PREFIX + key, JSON.stringify(value));
	} catch {
		// storage 不可用时静默放弃（会话内 state 仍然生效）
	}
}
