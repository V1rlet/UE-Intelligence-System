// Graph Brain / viewer - API Reference View 右侧函数详情列（ApiReferenceView 拆出）。
// 函数头/签名/标签/操作按钮/参数/返回值/描述/UFUNCTION 元数据/Companion/标注/引擎星标类。
// 全部为受控 props；状态与数据派生仍归 ApiReferenceView 本体。
import AnnotationPanel from "../annotation-panel/AnnotationPanel";
import PanelResizer from "./PanelResizer";
import {
	type ApiClassFavorite,
	type EngineCatalogClass,
	type FnEntry,
	type Source,
} from "./apiTypes";
import type { PanelWidthState } from "../../src/usePanelWidth";

interface Props {
	selectedFn: FnEntry;
	detailPanel: PanelWidthState;
	favIds: Set<string>;
	onToggleFav: (fn: FnEntry) => void;
	onLocate?: (fnId: string, parentId: string) => void;
	onCopySignature: (sig: string) => void;
	onSelectFn: (id: string) => void;
	onClose: () => void;
	source: Source;
	isClassFavorite: (favoriteSource: ApiClassFavorite["source"], name: string) => boolean;
	onToggleClassFavorite: (favorite: ApiClassFavorite) => void;
	resolveCompanion: (name: string) => FnEntry | undefined;
	contextCatalogClass: EngineCatalogClass | null | undefined;
	domain: string;
	subsystem: string;
	onJumpToNode?: (nodeId: string) => void;
}

export default function ApiDetailPane({
	selectedFn, detailPanel, favIds, onToggleFav, onLocate, onCopySignature, onSelectFn, onClose,
	source, isClassFavorite, onToggleClassFavorite, resolveCompanion, contextCatalogClass,
	domain, subsystem, onJumpToNode,
}: Props) {
	return (
		<>
			<PanelResizer
				state={detailPanel}
				label="拖动调整详情面板宽度"
				title="拖动或使用方向键调整详情面板宽度"
			/>
			<aside className="api-detail-panel" style={{ width: detailPanel.width }}>
				<div className="api-detail-title">
					<span>API 详情</span>
					<button className="api-detail-close" aria-label="关闭 API 详情" title="关闭详情" onClick={onClose}>×</button>
				</div>
				<div className="api-detail-breadcrumb">{selectedFn.module} / {selectedFn.parent}</div>

				{/* 函数头 */}
				<div className="api-detail-fn-head">
					<span className="api-return-badge lg">{selectedFn.api?.return_type ?? "void"}</span>
					<span className="api-detail-fn-name">{selectedFn.label}</span>
					<button
						className={`api-star${favIds.has(selectedFn.id) ? " faved" : ""}`}
						onClick={() => onToggleFav(selectedFn)}
					>
						{favIds.has(selectedFn.id) ? "★" : "☆"}
					</button>
				</div>

				{/* 签名 */}
				{selectedFn.api?.signature ? (
					<code className="api-detail-sig">{selectedFn.api.signature}</code>
				) : null}

				{/* 标签 */}
				{selectedFn.tags.filter((t) => t.startsWith("#")).length > 0 ? (
					<div className="api-detail-tags">
						{selectedFn.tags.filter((t) => t.startsWith("#")).map((t) => (
							<span key={t} className="api-detail-tag">{t}</span>
						))}
					</div>
				) : null}

				{/* 操作按钮 */}
				<div className="api-detail-actions">
					{onLocate ? (
						<button className="api-detail-btn" onClick={() => onLocate(selectedFn.id, selectedFn.parent)}>
							⌖ 在图谱中定位
						</button>
					) : null}
					{selectedFn.api?.signature ? (
						<button className="api-detail-btn" onClick={() => onCopySignature(selectedFn.api!.signature!)}>
							▣ 复制 C++ 调用
						</button>
					) : null}
					<button className="api-detail-btn" onClick={() => onCopySignature(selectedFn.label)}>
						▱ 复制蓝图节点名
					</button>
					{selectedFn.source_path ? (
						<button className="api-detail-btn" title="复制源码路径" onClick={() => onCopySignature(selectedFn.source_path!)}>
							▤ 查看源码
						</button>
					) : null}
					{contextCatalogClass?.docs_url ? (
						<a className="api-detail-btn" href={contextCatalogClass.docs_url} target="_blank" rel="noreferrer">
							↗ Epic 5.8 文档
						</a>
					) : null}
				</div>

				{/* 参数 */}
				{(selectedFn.api?.params?.length ?? 0) > 0 ? (
					<div className="api-detail-section">
						<div className="api-detail-section-head">参数</div>
						<table className="api-detail-params">
							<thead>
								<tr>
									<th>参数名</th>
									<th>类型</th>
									<th>说明</th>
								</tr>
							</thead>
							<tbody>
								{selectedFn.api!.params!.map((p) => (
									<tr key={p.name}>
										<td className="field-name">{p.name}</td>
										<td><code>{p.type}</code></td>
										<td className="spec-dim">{p.note ?? ""}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : null}

				{/* 返回值 */}
				<div className="api-detail-section">
					<div className="api-detail-section-head">返回值</div>
					<table className="api-detail-params">
						<thead>
							<tr><th>类型</th><th>说明</th></tr>
						</thead>
						<tbody>
							<tr>
								<td><code>{selectedFn.api?.return_type ?? "void"}</code></td>
								<td className="spec-dim">{selectedFn.api?.return_type === "void" || !selectedFn.api?.return_type ? "无返回值。" : ""}</td>
							</tr>
						</tbody>
					</table>
				</div>

				{/* 描述 */}
				{selectedFn.description ? (
					<div className="api-detail-section">
						<div className="api-detail-section-head">描述</div>
						<p className="api-detail-desc">{selectedFn.description}</p>
					</div>
				) : null}

				{/* UFUNCTION 元数据（引擎 API 模式） */}
				{selectedFn.layer === "engine" ? (
					<div className="api-detail-section">
						<div className="api-detail-section-head">UFUNCTION 元数据</div>
						<div className="api-ufunc-meta">
							{selectedFn.api?.blueprint_exposable ? <span className="api-ufunc-badge">BlueprintCallable</span> : null}
							{selectedFn.api?.cpp_only ? <span className="api-ufunc-badge cpp">仅限 C++</span> : null}
							{selectedFn.tags.filter((t) => t.startsWith("#")).map((t) => (
								<span key={t} className="api-ufunc-badge cat">Category {t.replace("#", "")}</span>
							))}
						</div>
					</div>
				) : null}

				{/* Companion */}
				{(selectedFn.api?.companions?.length ?? 0) > 0 ? (
					<div className="api-detail-section">
						<div className="api-detail-section-head">Companion</div>
						<div className="api-detail-companions">
							{selectedFn.api!.companions!.map((c) => {
								const targetFn = resolveCompanion(c);
								return targetFn ? (
									<button type="button" key={c} className="api-companion" onClick={() => onSelectFn(targetFn.id)}>{c}</button>
								) : (
									<span key={c} className="api-companion missing" title="不在当前数据中">{c}</span>
								);
							})}
						</div>
					</div>
				) : null}

				{/* 源文件 / 分类 / 所属类 */}
				<div className="api-detail-section">
					<div className="api-detail-meta-grid">
						{selectedFn.source_path ? (
							<>
								<span className="api-meta-label">头文件</span>
								<span className="api-meta-value">{selectedFn.source_path}</span>
							</>
						) : null}
						<span className="api-meta-label">可见性</span>
						<span className="api-meta-value">{selectedFn.api?.blueprint_exposable ? "公开 (public)" : selectedFn.api?.cpp_only ? "C++ only" : "公开"}</span>
						<span className="api-meta-label">所属类</span>
						<span className="api-meta-value">{selectedFn.parent}{selectedFn.module ? ` (${selectedFn.module})` : ""}</span>
					</div>
				</div>

				{/* 引擎 API 使用提示 */}
				{selectedFn.layer === "engine" && selectedFn.description ? (
					<div className="api-usage-tip">
						<span className="api-usage-icon">⚠</span>
						<div>
							<strong>使用提示</strong>
							<p>{selectedFn.description}</p>
						</div>
					</div>
				) : null}

				{/* 标注 */}
				<div className="api-detail-section">
					<div className="api-detail-section-head">标注</div>
					<AnnotationPanel nodeId={selectedFn.id} domain={domain} subsystem={subsystem} onJumpToNode={onJumpToNode} />
				</div>

				{/* 引擎 API：星标类 */}
				{source === "engine" ? (
					<div className="api-detail-section">
						<button
							className="api-detail-btn engine-star"
							onClick={() => onToggleClassFavorite({ name: selectedFn.parent, source: "engine", module: selectedFn.module, sourcePath: selectedFn.source_path })}
						>
							{isClassFavorite("engine", selectedFn.parent) ? "★ 已加入快速入口" : "☆ 加入快速入口"}
						</button>
					</div>
				) : null}
			</aside>
		</>
	);
}
