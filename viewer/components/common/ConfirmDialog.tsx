// Graph Brain / viewer - 统一确认弹层：异步结果、焦点圈定、Esc/遮罩取消

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "./useDialogFocus";
import { EXIT_MS } from "../../src/motion";

interface ConfirmOptions {
	title?: string;
	confirmLabel?: string;
	danger?: boolean;
}

interface Request extends ConfirmOptions {
	message: string;
}

function ConfirmDialog({
	request,
	onResult,
}: {
	request: Request;
	onResult: (accepted: boolean) => void;
}) {
	const dialogRef = useDialogFocus<HTMLDivElement>();
	// G1：自管退出——所有关闭路径先播退出动画，EXIT_MS 后再真正 resolve 并卸载
	const [exiting, setExiting] = useState(false);
	const close = useCallback(
		(accepted: boolean) => {
			if (exiting) return;
			setExiting(true);
			window.setTimeout(() => onResult(accepted), EXIT_MS);
		},
		[exiting, onResult],
	);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			close(false);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [close]);

	return createPortal(
		<div className={`mermaid-mask confirm-mask${exiting ? " gb-exiting" : ""}`} onClick={() => close(false)} aria-hidden={exiting}>
			<div
				ref={dialogRef}
				className={`confirm-dialog${exiting ? " gb-exiting" : ""}`}
				role="alertdialog"
				aria-modal="true"
				aria-labelledby="confirm-dialog-title"
				aria-describedby="confirm-dialog-message"
				onClick={(event) => event.stopPropagation()}
			>
				<h3 id="confirm-dialog-title">{request.title ?? "确认操作"}</h3>
				<p id="confirm-dialog-message">{request.message}</p>
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
	const resolverRef = useRef<((accepted: boolean) => void) | null>(null);

	const finish = useCallback((accepted: boolean) => {
		const resolve = resolverRef.current;
		resolverRef.current = null;
		setRequest(null);
		resolve?.(accepted);
	}, []);

	useEffect(() => () => resolverRef.current?.(false), []);

	const confirm = useCallback((message: string, options: ConfirmOptions = {}) => {
		resolverRef.current?.(false);
		return new Promise<boolean>((resolve) => {
			resolverRef.current = resolve;
			setRequest({ message, ...options });
		});
	}, []);

	return {
		confirm,
		confirmDialog: request ? <ConfirmDialog request={request} onResult={finish} /> : null,
	};
}
