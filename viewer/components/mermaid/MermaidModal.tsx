// Graph Brain / viewer - Mermaid 序列图弹层（P3U5）：动态加载 mermaid 渲染 .mmd
// mermaid 体积大（~2MB），用动态 import 挡在首包之外，首次打开时才加载
import { useEffect, useState } from "react";
import { apiFetchText } from "../../src/apiFetch";
import { useDialogFocus } from "../common/useDialogFocus";

export interface MermaidEntry {
	file: string;
	title: string;
	nodes: string[];
}

interface Props {
	file: string;
	title: string;
	onClose: () => void;
}

function formatMermaidError(error: unknown) {
	const detail = error as { message?: string; hash?: { loc?: { first_line?: number; first_column?: number } } };
	const message = (detail.message ?? String(error)).replace(/^Error:\s*/, "");
	const line = detail.hash?.loc?.first_line;
	const column = detail.hash?.loc?.first_column;
	return line ? `第 ${line} 行${typeof column === "number" ? `，第 ${column + 1} 列` : ""}：${message}` : message;
}

export default function MermaidModal({ file, title, onClose }: Props) {
	const dialogRef = useDialogFocus<HTMLDivElement>();
	const [svg, setSvg] = useState<string | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const [retrySeq, setRetrySeq] = useState(0);

	useEffect(() => {
		let alive = true;
		const controller = new AbortController();
		setSvg(null);
		setErr(null);
		apiFetchText(`/data/mermaid/${encodeURIComponent(file)}`, { signal: controller.signal }, { notify: false, context: "Mermaid 图表" })
			.then(async (text) => {
				// 元数据注释（title/nodes）在渲染前剥离，其余 %% 注释 mermaid 自己认识
				const src = text
					.split("\n")
					.filter((l) => !/^\s*%%\s*(title|nodes)\s*:/.test(l))
					.join("\n");
				const mermaid = (await import("mermaid")).default;
				mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
				const { svg: rendered } = await mermaid.render(`mmd-${Math.random().toString(36).slice(2)}`, src);
				if (alive) setSvg(rendered);
			})
			.catch((e) => alive && setErr(formatMermaidError(e)));
		return () => {
			alive = false;
			controller.abort();
		};
	}, [file, retrySeq]);

	// Esc 关闭（捕获阶段优先于主图的 Esc 退出聚焦）
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				onClose();
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [onClose]);

	return (
		<div className="mermaid-mask" onClick={onClose}>
			<div ref={dialogRef} className="mermaid-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
				<div className="mermaid-head">
					<h3>📊 {title}</h3>
					<span className="mermaid-file">{file}</span>
					<button className="mermaid-close" title="关闭（Esc）" aria-label="关闭（Esc）" onClick={onClose}>✕</button>
				</div>
				<div className="mermaid-body">
					{err ? <div className="mermaid-error" role="alert"><p>渲染失败：{err}</p><button type="button" onClick={() => setRetrySeq((value) => value + 1)}>重试</button></div> : null}
					{!err && !svg ? <p className="hint">渲染中…</p> : null}
					{/* mermaid 输出为本地生成的 SVG，无外部输入注入面 */}
					{svg ? <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} /> : null}
				</div>
			</div>
		</div>
	);
}
