// Graph Brain / viewer - 三列布局可拖拽分隔条（API View 左/右面板共用）。
// 从 ApiReferenceView 的重复 JSX 提取；行为与原实现一致（mousedown 起拖、方向键微调）。
import type { PanelWidthState } from "../../src/usePanelWidth";

interface Props {
	state: PanelWidthState;
	label: string;
	title: string;
}

export default function PanelResizer({ state, label, title }: Props) {
	return (
		<div
			className="panel-resizer"
			role="separator"
			tabIndex={0}
			aria-orientation="vertical"
			aria-label={label}
			aria-valuemin={state.min}
			aria-valuemax={state.max}
			aria-valuenow={state.width}
			title={title}
			onMouseDown={state.onResizeStart}
			onKeyDown={state.onResizeKeyDown}
		/>
	);
}
