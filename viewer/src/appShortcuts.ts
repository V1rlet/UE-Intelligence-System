import { SHORTCUT_KEYS } from "./shortcutCatalog";

export type AppShortcutAction = keyof typeof SHORTCUT_KEYS.global;
export type GraphShortcutAction = keyof typeof SHORTCUT_KEYS.graph;

export interface AppShortcutInput {
	key: string;
	altKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
	shiftKey?: boolean;
	defaultPrevented?: boolean;
	typing?: boolean;
	blocked?: boolean;
}

export const APP_SHORTCUT_BLOCKER_SELECTOR = '[aria-modal="true"],[data-app-shortcuts="block"]';

export function hasAppShortcutBlocker(root: Pick<ParentNode, "querySelector">): boolean {
	return Boolean(root.querySelector(APP_SHORTCUT_BLOCKER_SELECTOR));
}

const ACTION_BY_KEY = new Map<string, AppShortcutAction>(
	Object.entries(SHORTCUT_KEYS.global).map(([action, key]) => [key, action as AppShortcutAction]),
);
const GRAPH_ACTION_BY_KEY = new Map<string, GraphShortcutAction>(
	Object.entries(SHORTCUT_KEYS.graph).flatMap(([action, keys]) =>
		keys.map((key) => [key, action as GraphShortcutAction] as const),
	),
);

/**
 * Resolves only unmodified, app-owned shortcuts. The visible shortcut catalog is
 * the single owner of key bindings; modal and text-entry surfaces keep ownership
 * of their own keyboard input.
 */
export function resolveAppShortcut(input: AppShortcutInput): AppShortcutAction | null {
	if (
		input.defaultPrevented
		|| input.typing
		|| input.blocked
		|| input.altKey
		|| input.ctrlKey
		|| input.metaKey
	) return null;
	return ACTION_BY_KEY.get(input.key) ?? null;
}

/** Resolves canvas-owned shortcuts only after its keyboard surface has focus. */
export function resolveGraphShortcut(input: AppShortcutInput): GraphShortcutAction | null {
	if (
		input.defaultPrevented
		|| input.typing
		|| input.blocked
		|| input.altKey
		|| input.ctrlKey
		|| input.metaKey
	) return null;
	const key = input.key === "F10" && input.shiftKey ? "Shift+F10" : input.key;
	return GRAPH_ACTION_BY_KEY.get(key) ?? null;
}
