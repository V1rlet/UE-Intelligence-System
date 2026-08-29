// Graph Brain / viewer - 统一确认弹层：异步结果、焦点圈定、Esc/遮罩取消

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "./useDialogFocus";
import { EXIT_MS } from "../../src/motion";

interface ConfirmOptions {
	title?: string;
	confirmLabel?: string;
	danger?: boolean;
}

interface Request extends ConfirmOptions {
	id: number;
	message: string;
}

function ConfirmDialog({
	request,
	onResult,
}: {
	request: Request;
	onResult: (accepted: boolean) => void;
}) {
	const titleId = useId();
	const messageId = useId();
	// G1：自管退出——所有关闭路径先播退出动画，EXIT_MS 后再真正 resolve 并卸载
	const [exiting, setExiting] = useState(false);
	const closeStarted = useRef(false);
	const closeTimer = useRef<number | null>(null);
	useEffect(() => () => {
		if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
	}, []);
	const close = useCallback(
		(accepted: boolean) => {
			if (closeStarted.current) return;
			closeStarted.current = true;
			setExiting(true);
			closeTimer.current = window.setTimeout(() => onResult(accepted), EXIT_MS);
		},
		[onResult],
	);
	const dialogRef = useDialogFocus<HTMLDivElement>(true, () => close(false));

	return createPortal(
		<div className={`confirm-mask${exiting ? " gb-exiting" : ""}`} onClick={() => close(false)}>
			<div
				ref={dialogRef}
				className={`confirm-dialog${exiting ? " gb-exiting" : ""}`}
				role="alertdialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={messageId}
				onClick={(event) => event.stopPropagation()}
			>
				<h3 id={titleId}>{request.title ?? "确认操作"}</h3>
				<p id={messageId}>{request.message}</p>
				<div className="confirm-actions">
					<button type="button" className="confirm-secondary" onClick={() => close(false)}>取消</button>
					<button
						type="button"
						className={request.danger ? "confirm-danger" : "confirm-primary"}
						onClick={() => close(true)}
					>
						{request.confirmLabel ?? "确认"}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}

export function useConfirmDialog() {
	const [request, setRequest] = useState<Request | null>(null);
	const sequenceRef = useRef(0);
	const resolverRef = useRef<{ id: number; resolve: (accepted: boolean) => void } | null>(null);

	const finish = useCallback((id: number, accepted: boolean) => {
		const pending = resolverRef.current;
		if (!pending || pending.id !== id) return;
		resolverRef.current = null;
		setRequest(null);
		pending.resolve(accepted);
	}, []);

	useEffect(() => () => {
		const pending = resolverRef.current;
		resolverRef.current = null;
		pending?.resolve(false);
	}, []);

	const confirm = useCallback((message: string, options: ConfirmOptions = {}) => {
		resolverRef.current?.resolve(false);
		const id = ++sequenceRef.current;
		return new Promise<boolean>((resolve) => {
			resolverRef.current = { id, resolve };
			setRequest({ id, message, ...options });
		});
	}, []);

	return {
		confirm,
		confirmDialog: request ? <ConfirmDialog key={request.id} request={request} onResult={(accepted) => finish(request.id, accepted)} /> : null,
	};
}
