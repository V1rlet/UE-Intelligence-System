/**
 * useSpecNavigation — Spec 页导航状态与操作。
 *
 * 从 App.tsx 拆出的第三块（Step 3）：Spec 追溯历史栈、选中/悬停/分页/分区翻页
 * 状态，以及 openSpec / backSpec / closeSpec / requestFocus 操作。纯状态管理，无 JSX。
 *
 * openSpec 的「引擎类按需解析」业务副作用经 onOpenSpec 注入（依赖 App 侧的
 * domain / graph / parseEngineClass，属 Step 4 useEngineClassParser 范畴）——
 * hook 内部以 ref 保存最新回调，openSpec 身份保持稳定，不随回调重建。
 *
 * App 仍是唯一消费者（单组件拥有者）。后续 Context 化时此 hook 可直接提升。
 */
import { useCallback, useRef, useState } from "react";
import { advanceSpecTrail } from "../components/graph-view/specNavigation";
import type { FocusRequest, SpecTarget, SpecZonePages } from "../components/graph-view/specModel";

// ── Hook 参数 ──────────────────────────────────────────────────
export interface UseSpecNavigationOptions {
	/** openSpec 打开新目标后的业务副作用（如引擎类按需解析）；回调内可引用 App 侧后声明的变量 */
	onOpenSpec?: (t: SpecTarget) => void;
}

// ── Hook 返回值 ────────────────────────────────────────────────
export interface SpecNavigationState {
	// 追溯历史栈（栈顶为当前页，可逐级返回）
	specStack: SpecTarget[];
	setSpecStack: React.Dispatch<React.SetStateAction<SpecTarget[]>>;
	specTarget: SpecTarget | null;

	// 选中 / 悬停 / 分页
	hoverId: string | null;
	setHoverId: React.Dispatch<React.SetStateAction<string | null>>;
	specSelectedId: string | null;
	setSpecSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
	fnPage: number;
	setFnPage: React.Dispatch<React.SetStateAction<number>>;
	specZonePages: SpecZonePages;
	setSpecZonePages: React.Dispatch<React.SetStateAction<SpecZonePages>>;

	// 聚焦
	focusRequest: FocusRequest | null;
	setFocusRequest: React.Dispatch<React.SetStateAction<FocusRequest | null>>;
	/** 聚焦请求（seq 递增保证重复点击同一节点也触发） */
	requestFocus: (id: string) => void;

	// 操作
	/** 打开 Spec 页：入栈 + 重置选中/悬停/分页/焦点，随后触发 onOpenSpec 副作用 */
	openSpec: (t: SpecTarget) => void;
	/** 返回上一页（弹栈 + 全重置） */
	backSpec: () => void;
	/** 关闭 Spec 页回主图（清除全部只属于详情页的临时状态） */
	closeSpec: () => void;
}

export function useSpecNavigation({ onOpenSpec }: UseSpecNavigationOptions): SpecNavigationState {
	// Spec 页状态：追溯历史栈（栈顶为当前页，可逐级返回）
	const [specStack, setSpecStack] = useState<SpecTarget[]>([]);
	const specTarget = specStack.length > 0 ? specStack[specStack.length - 1] : null;
	const [hoverId, setHoverId] = useState<string | null>(null);
	const [specSelectedId, setSpecSelectedId] = useState<string | null>(null);
	const [fnPage, setFnPage] = useState(0);
	const [specZonePages, setSpecZonePages] = useState<SpecZonePages>({});
	const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

	// openSpec 的业务副作用（引擎解析等）——存 ref，回调身份稳定
	const onOpenSpecRef = useRef(onOpenSpec);
	onOpenSpecRef.current = onOpenSpec;

	const requestFocus = useCallback((id: string) => {
		setFocusRequest((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }));
	}, []);

	const openSpec = useCallback((t: SpecTarget) => {
		setSpecStack((stack) => advanceSpecTrail(stack, t));
		setSpecSelectedId(t.id);
		setHoverId(null);
		setFnPage(0);
		setSpecZonePages({});
		setFocusRequest(null);
		onOpenSpecRef.current?.(t);
	}, []);

	const backSpec = useCallback(() => {
		setSpecStack((stack) => stack.slice(0, -1));
		setHoverId(null);
		setSpecSelectedId(null);
		setFnPage(0);
		setSpecZonePages({});
		setFocusRequest(null);
	}, []);

	const closeSpec = useCallback(() => {
		setSpecStack([]);
		setHoverId(null);
		setSpecSelectedId(null);
		setFnPage(0);
		setSpecZonePages({});
		setFocusRequest(null);
	}, []);

	return {
		specStack,
		setSpecStack,
		specTarget,
		hoverId,
		setHoverId,
		specSelectedId,
		setSpecSelectedId,
		fnPage,
		setFnPage,
		specZonePages,
		setSpecZonePages,
		focusRequest,
		setFocusRequest,
		requestFocus,
		openSpec,
		backSpec,
		closeSpec,
	};
}
