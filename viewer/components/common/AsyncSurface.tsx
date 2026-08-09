import {
	Component,
	Suspense,
	type CSSProperties,
	type ErrorInfo,
	type ReactNode,
} from "react";
import AppIcon, { type AppIconName } from "./AppIcon";

export type AsyncSurfaceVariant = "workspace" | "panel" | "overlay" | "root";

interface LoadingProps {
	label: string;
	detail?: string;
	icon?: AppIconName;
	variant?: AsyncSurfaceVariant;
	style?: CSSProperties;
}

interface RecoveryProps extends LoadingProps {
	onExit?: () => void;
}

interface BoundaryProps extends RecoveryProps {
	children: ReactNode;
	resetKey?: string;
}

interface BoundaryState {
	error: Error | null;
}

export function AsyncLoading({
	label,
	detail,
	icon = "sync",
	variant = "workspace",
	style,
}: LoadingProps) {
	return (
		<div className={`async-state async-state-${variant} async-state-loading`} style={style} role="status" aria-live="polite">
			<i className="async-state-mark"><AppIcon name={icon} size={20} /></i>
			<span>
				<b>{label}</b>
				{detail ? <small>{detail}</small> : null}
			</span>
		</div>
	);
}

function AsyncRecovery({
	label,
	detail,
	icon = "review",
	variant = "workspace",
	style,
	onExit,
}: RecoveryProps) {
	return (
		<div className={`async-state async-state-${variant} async-state-error`} style={style} role="alert">
			<i className="async-state-mark"><AppIcon name={icon} size={22} /></i>
			<span>
				<b>{label}</b>
				<small>{detail ?? "这个界面模块没有成功打开。已保存的数据不受影响。"}</small>
			</span>
			<div className="async-state-actions">
				{onExit ? <button type="button" className="primary" onClick={onExit}>返回上一步</button> : null}
				<button type="button" onClick={() => window.location.reload()}>重新载入界面</button>
			</div>
			<em>重新载入会丢弃当前页面尚未保存的编辑。</em>
		</div>
	);
}

class AsyncErrorBoundary extends Component<BoundaryProps, BoundaryState> {
	state: BoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): BoundaryState {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error("[Graph Brain] 界面模块加载失败", error, info.componentStack);
	}

	componentDidUpdate(previous: BoundaryProps): void {
		if (this.state.error && previous.resetKey !== this.props.resetKey) {
			this.setState({ error: null });
		}
	}

	render() {
		if (this.state.error) {
			const { children: _children, resetKey: _resetKey, ...recovery } = this.props;
			return <AsyncRecovery {...recovery} />;
		}
		return this.props.children;
	}
}

interface AsyncSurfaceProps extends BoundaryProps {
	loadingDetail?: string;
}

export function AsyncSurface({
	children,
	label,
	detail,
	loadingDetail,
	icon,
	variant,
	style,
	onExit,
	resetKey,
}: AsyncSurfaceProps) {
	return (
		<AsyncErrorBoundary
			label={label}
			detail={detail}
			icon={icon}
			variant={variant}
			style={style}
			onExit={onExit}
			resetKey={resetKey}
		>
			<Suspense fallback={<AsyncLoading label={label} detail={loadingDetail} icon={icon} variant={variant} style={style} />}>
				{children}
			</Suspense>
		</AsyncErrorBoundary>
	);
}

export function AppRuntimeBoundary({ children }: { children: ReactNode }) {
	return (
		<AsyncErrorBoundary
			label="Graph Brain 没有正常显示"
			detail="界面运行时遇到了问题。已保存的图谱和项目文件不受影响。"
			icon="graph"
			variant="root"
			resetKey="app-root"
		>
			{children}
		</AsyncErrorBoundary>
	);
}
