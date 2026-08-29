// Graph Brain / viewer - 知识层：把人工经验作为 Spec 的证据层，而不是孤立便签。
import { useEffect, useMemo, useState, useRef } from "react";
import { apiFetch } from "../../src/apiFetch";
import {
	READING_CONTEXT_ACCEPT_STATUSES,
	READING_CONTEXT_CONFLICT_STATUS,
	readingContextRevisionOf,
} from "../../src/readingContextHttp";
import { LatestRequestGate } from "../../src/latestRequest";
import { registerUnsavedChanges } from "../../src/unsavedChanges";
import { useConfirmDialog } from "../common/ConfirmDialog";
import { knowledgeContext, type KnowledgeTypeId } from "./knowledgeContext";
import { toast } from "../common/Toast";
import { handleRovingTabKeyDown, rovingTabStop } from "../common/rovingTabs";

interface Annotation {
	id: string;
	type: string;
	content: string;
	created_at: string;
	source_hash?: string;
	stale?: boolean;
}

interface Entry {
	node_id: string;
	domain: string;
	annotations: Annotation[];
}

interface Props {
	nodeId: string;
	domain: string;
	subsystem: string;
	onJumpToNode?: (nodeId: string) => void;
	/** 拒绝丢弃草稿时恢复上一选中的回调：宿主必须能真正还原选中（如设置本地
	 *  selectedId）。缺省回退 onJumpToNode——它只在能还原选中的宿主里等效。 */
	onRevertSelection?: (nodeId: string) => void;
}

function useKnowledgeEntries(domain: string, subsystem: string) {
	const [entries, setEntries] = useState<Entry[]>([]);
	const [revision, setRevision] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const loadRequest = useRef(new LatestRequestGate());

	useEffect(() => {
		const controller = loadRequest.current.start();
		setEntries([]);
		setError(null);
		setLoading(true);
		setRevision(0);
		const load = async () => {
			try {
				const response = await apiFetch(`/api/annotations/${domain}/${subsystem}`, { signal: controller.signal }, { notify: false });
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const data = await response.json() as Entry[];
				if (!loadRequest.current.isCurrent(controller)) return;
				if (!Array.isArray(data)) throw new Error("知识层响应格式错误");
				setRevision(readingContextRevisionOf(response));
				setEntries(data);
			} catch (reason) {
				if ((reason as Error).name !== "AbortError" && loadRequest.current.isCurrent(controller)) setError(String(reason));
			} finally {
				if (loadRequest.current.finish(controller)) setLoading(false);
			}
		};
		void load();
		return () => loadRequest.current.cancel();
	}, [domain, subsystem]);

	return { entries, setEntries, revision, setRevision, error, setError, loading };
}

export default function AnnotationPanel({ nodeId, domain, subsystem, onJumpToNode, onRevertSelection }: Props) {
	const { entries, setEntries, revision, setRevision, error, setError, loading } = useKnowledgeEntries(domain, subsystem);
	const context = useMemo(() => knowledgeContext(domain), [domain]);
	const knowledgeTypes = context.types;
	const typeById = useMemo(() => new Map(context.types.map((item) => [item.id, item])), [context]);
	const typeOrder = useMemo(() => new Map(context.types.map((item, index) => [item.id, index])), [context]);
	const [scope, setScope] = useState<"node" | "all">("node");
	const [sort, setSort] = useState<"time" | "type">("time");
	const [newType, setNewType] = useState<KnowledgeTypeId>("gotcha");
	const [newContent, setNewContent] = useState("");
	// C2 行级锚（可选）：用户从 IDE 抄来行号；fingerprint 由服务端按当前源文件计算。
	const [anchorStart, setAnchorStart] = useState("");
	const [anchorEnd, setAnchorEnd] = useState("");
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editContent, setEditContent] = useState("");
	const [editOriginalContent, setEditOriginalContent] = useState("");
	const [composerOpen, setComposerOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const writeSequenceRef = useRef(0);
	const writeScope = `${domain}\u0000${subsystem}\u0000${nodeId}`;
	const writeScopeRef = useRef(writeScope);
	writeScopeRef.current = writeScope;
	const { confirm, confirmDialog } = useConfirmDialog();

	useEffect(() => {
		writeSequenceRef.current += 1;
		setBusy(false);
		return () => {
			writeSequenceRef.current += 1;
		};
	}, [writeScope]);

	const composerDirty = composerOpen && (newContent.trim() !== "" || anchorStart !== "" || anchorEnd !== "");
	const editorDirty = editingId !== null && editContent !== editOriginalContent;
	const dirty = composerDirty || editorDirty;
	const dirtyRef = useRef(dirty);
	const previousNodeRef = useRef(nodeId);

	useEffect(() => {
		dirtyRef.current = dirty;
	}, [dirty]);

	useEffect(() => registerUnsavedChanges(() => dirtyRef.current), []);

	useEffect(() => {
		const handleBeforeUnload = (e: BeforeUnloadEvent) => {
			if (dirty) {
				e.preventDefault();
				e.returnValue = "";
			}
		};
		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => window.removeEventListener("beforeunload", handleBeforeUnload);
	}, [dirty]);

	useEffect(() => {
		const previousNode = previousNodeRef.current;
		if (previousNode === nodeId) return;
		if (dirtyRef.current && !window.confirm("\u{5f53}\u{524d}\u{6279}\u{6ce8}\u{5c1a}\u{672a}\u{4fdd}\u{5b58}\u{3002}\u{8981}\u{653e}\u{5f03}\u{66f4}\u{6539}\u{5e76}\u{5207}\u{6362}\u{5185}\u{5bb9}\u{5417}\u{ff1f}")) {
			// "保留我的修改"必须真正还原选中；只有能还原选中的宿主回调才允许承担还原职责。
			(onRevertSelection ?? onJumpToNode)?.(previousNode);
			return;
		}
		setAnchorStart("");
		setAnchorEnd("");
		previousNodeRef.current = nodeId;
		setEditingId(null);
		setNewContent("");
		setComposerOpen(false);
	}, [nodeId, onJumpToNode, onRevertSelection]);

	const post = async (payload: Record<string, unknown>) => {
		const requestScope = writeScope;
		const requestSequence = ++writeSequenceRef.current;
		const isCurrentWrite = () => writeScopeRef.current === requestScope && writeSequenceRef.current === requestSequence;
		setBusy(true);
		setError(null);
		try {
			const response = await apiFetch(`/api/annotations/${domain}/${subsystem}`, {
				method: "POST",
				headers: { "Content-Type": "application/json", "If-Match": `"${revision}"` },
				body: JSON.stringify({ node_id: nodeId, ...payload }),
			}, { acceptStatuses: READING_CONTEXT_ACCEPT_STATUSES, context: "更新阅读标注" });
			const data = await response.json();
			if (!isCurrentWrite()) return false;
			const nextRevision = readingContextRevisionOf(response, revision);
			if (response.status === READING_CONTEXT_CONFLICT_STATUS) {
				const conflict = data as { entries?: Entry[]; revision?: number };
				// 冲突响应与成功响应同一契约校验：畸形体不得清空当前列表（规则 12）。
				if (!Array.isArray(conflict.entries)) {
					setError("标注冲突响应格式错误；已保留当前列表，请刷新后重试。");
					return false;
				}
				setEntries(conflict.entries);
				setRevision(conflict.revision ?? nextRevision);
				// 孤儿编辑器恢复：并发删除了正在编辑的条目 → 带诊断退出（不留看不见的
				// 脏状态）；条目仍存在但远端内容已变 → 把远端内容载入编辑器供复查，
				// 而不是让用户对着旧基线盲重试覆盖他人修改。
				if (editingId !== null) {
					const survived = conflict.entries
						.find((entry) => entry.node_id === nodeId)
						?.annotations.find((annotation) => annotation.id === editingId);
					if (!survived) {
						setEditingId(null);
						setEditContent("");
						setEditOriginalContent("");
						setError("标注已在其他窗口更新；正在编辑的条目已被删除，编辑已退出。");
						return false;
					}
					if (survived.content !== editOriginalContent) {
						setEditContent(survived.content);
						setEditOriginalContent(survived.content);
						setError("标注已在其他窗口更新；编辑器已载入最新内容，请复查后重新保存。");
						return false;
					}
				}
				setError("标注已在其他窗口更新，已载入最新版本；请检查后重试。");
				return false;
			}
			if (!response.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${response.status}`);
			if (!Array.isArray(data)) throw new Error("知识层响应格式错误");
			setEntries(data as Entry[]);
			setRevision(nextRevision);
			return true;
		} catch (reason) {
			if (isCurrentWrite()) setError(String(reason));
			return false;
		} finally {
			if (isCurrentWrite()) setBusy(false);
		}
	};
	const handleAdd = async () => {
		if (!newContent.trim()) return;
		let anchor: { start_line: number; end_line: number } | undefined;
		if (anchorStart !== "" || anchorEnd !== "") {
			const start = Number(anchorStart);
			const end = Number(anchorEnd);
			if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
				setError("行级锚：起止行必须是 ≥1 的整数，且结束行不小于起始行");
				return;
			}
			anchor = { start_line: start, end_line: end };
		}
		if (await post({ action: "add", annotation: { type: newType, content: newContent.trim(), ...(anchor ? { anchor } : {}) } })) {
			toast("Annotation saved", "success");
			setNewContent("");
			setAnchorStart("");
			setAnchorEnd("");
			setComposerOpen(false);
		}
	};

	const handleSaveEdit = async () => {
		if (!editingId || !editContent.trim()) return;
		if (await post({ action: "update", ann_id: editingId, annotation: { content: editContent.trim() } })) {
			toast("Annotation saved", "success");
			setEditingId(null);
		}
	};

	const cancelComposer = async () => {
		if (composerDirty && !(await confirm("\u{653e}\u{5f03}\u{8fd9}\u{6761}\u{5c1a}\u{672a}\u{4fdd}\u{5b58}\u{7684}\u{6279}\u{6ce8}\u{ff1f}", {
			title: "\u{653e}\u{5f03}\u{672a}\u{4fdd}\u{5b58}\u{66f4}\u{6539}",
			confirmLabel: "\u{653e}\u{5f03}\u{66f4}\u{6539}",
			danger: true,
		}))) return;
		setComposerOpen(false);
		setNewContent("");
	};

	const cancelEditor = async () => {
		if (editorDirty && !(await confirm("\u{653e}\u{5f03}\u{5bf9}\u{8fd9}\u{6761}\u{6279}\u{6ce8}\u{7684}\u{4fee}\u{6539}\u{ff1f}", {
			title: "\u{653e}\u{5f03}\u{672a}\u{4fdd}\u{5b58}\u{66f4}\u{6539}",
			confirmLabel: "\u{653e}\u{5f03}\u{66f4}\u{6539}",
			danger: true,
		}))) return;
		setEditingId(null);
		setEditContent("");
		setEditOriginalContent("");
	};

	const handleDelete = async (annotationId: string) => {
		if (!(await confirm(`删除这条${context.title}？删除后无法恢复。`, {
			title: `删除${context.title}`,
			confirmLabel: "删除",
			danger: true,
		}))) return;
		await post({ action: "delete", ann_id: annotationId });
	};

	const handleReview = async (annotationId: string, ownerId?: string) => {
		await post({ action: "review", ann_id: annotationId, ...(ownerId ? { node_id: ownerId } : {}) });
	};

	const sortAnnotations = <T extends Annotation>(list: T[]): T[] => [...list].sort((a, b) =>
		sort === "time"
			? b.created_at.localeCompare(a.created_at)
			: (typeOrder.get(a.type as KnowledgeTypeId) ?? typeOrder.size)
				- (typeOrder.get(b.type as KnowledgeTypeId) ?? typeOrder.size)
				|| b.created_at.localeCompare(a.created_at),
	);

	const annotations = sortAnnotations(entries.find((entry) => entry.node_id === nodeId)?.annotations ?? []);
	const flat = sortAnnotations(entries.flatMap((entry) => entry.annotations.map((annotation) => ({ ...annotation, node_id: entry.node_id }))));
	const visible = scope === "node" ? annotations : flat;
	const staleCount = visible.filter((annotation) => annotation.stale).length;
	const boundCount = visible.filter((annotation) => annotation.source_hash && !annotation.stale).length;
	const selectedType = typeById.get(newType)!;
	const typeCounts = useMemo(() => new Map(knowledgeTypes.map((type) => [type.id, annotations.filter((annotation) => annotation.type === type.id).length])), [annotations, knowledgeTypes]);

	const renderBadge = (annotation: Annotation) => {
		const type = typeById.get(annotation.type as KnowledgeTypeId);
		return (
			<>
				<span className={`ann-type-mark ann-type-${annotation.type}`}>{type?.mark ?? "·"}</span>
				<span className="ann-type-label">{type?.label ?? annotation.type}</span>
				<span className={`ann-trust${annotation.stale ? " stale" : annotation.source_hash ? " bound" : " unbound"}`}>
					{annotation.stale ? `${context.sourceName}已变化` : annotation.source_hash ? `已绑定${context.sourceName}` : context.manualTrustLabel}
				</span>
				<time className="ann-date" dateTime={annotation.created_at}>{annotation.created_at.slice(0, 10)}</time>
			</>
		);
	};

	return (
		<section className={`ann-panel knowledge-layer knowledge-domain-${domain}`}>
			<header className="knowledge-head">
				<div className="knowledge-orbit" aria-hidden="true"><span /><i /><b /></div>
				<div>
					<small>{context.kicker}</small>
					<h3>{context.title}</h3>
					<p>{context.headerGuide(nodeId)}</p>
				</div>
				<div className="knowledge-health" aria-label="知识层状态">
					<b>{visible.length}<small>条目</small></b>
					<b>{boundCount}<small>{context.sourceName}绑定</small></b>
					<b className={staleCount ? "warn" : ""}>{staleCount}<small>待复核</small></b>
				</div>
			</header>

			<div className="knowledge-scope-shell">
				<div className="knowledge-scope-tabs" role="tablist" aria-label="知识查看范围" onKeyDown={handleRovingTabKeyDown}>
					<button
						type="button"
						className={scope === "node" ? "active" : ""}
						onClick={() => setScope("node")}
						role="tab"
						aria-selected={scope === "node"}
						tabIndex={rovingTabStop(scope === "node")}
					>
						<span><b>当前{context.objectName}</b><small>只查看此对象的{context.title}</small></span>
						<em>{annotations.length}</em>
					</button>
					{onJumpToNode ? (
						<button
							type="button"
							className={scope === "all" ? "active" : ""}
							onClick={() => setScope("all")}
							role="tab"
							aria-selected={scope === "all"}
							tabIndex={rovingTabStop(scope === "all")}
						>
							<span><b>{context.collectionName}</b><small>跨对象审阅与维护</small></span>
							<em>{flat.length}</em>
						</button>
					) : null}
				</div>

				<div className="knowledge-scope-toolbar" data-scope={scope}>
					<div className="knowledge-scope-context">
						<small>{scope === "node" ? "当前对象操作" : "整图维护"}</small>
						<strong>{scope === "node" ? nodeId : `${subsystem} · ${flat.length} 条${context.title}`}</strong>
					</div>
					<div className="knowledge-order-control" role="group" aria-label="知识排列方式">
						<span>排列方式</span>
						<div className="knowledge-order-options">
							<button type="button" className={sort === "time" ? "active" : ""} onClick={() => setSort("time")} aria-pressed={sort === "time"} title="按记录时间从新到旧排列">最新优先</button>
							<button type="button" className={sort === "type" ? "active" : ""} onClick={() => setSort("type")} aria-pressed={sort === "type"} title="按风险、实践、决策、性能和依据分组排列">按类型</button>
						</div>
					</div>
					<div className="knowledge-scope-actions">
						{scope === "node" ? (
							<button className="knowledge-create" onClick={() => composerOpen ? void cancelComposer() : setComposerOpen(true)}>＋ 记录{context.title}</button>
						) : (
							<button className="knowledge-scan" disabled={busy} onClick={() => post({ action: "scan" })}><span />{busy ? "正在检查…" : `检查${context.sourceName}新鲜度`}</button>
						)}
					</div>
				</div>
			</div>

			{error ? <p className="ann-error" role="alert">{error}</p> : null}
			{composerOpen && scope === "node" ? (
				<div className={`knowledge-composer${composerDirty ? " knowledge-dirty" : ""}`}>
					<div className="knowledge-type-grid" role="radiogroup" aria-label={`${context.title}类型`}>
						{knowledgeTypes.map((type) => (
							<button key={type.id} className={`knowledge-type-option ann-type-${type.id}${newType === type.id ? " active" : ""}`} onClick={() => setNewType(type.id)} role="radio" aria-checked={newType === type.id}>
								<span>{type.mark}</span><b>{type.label}</b><small>{type.hint}</small>
							</button>
						))}
					</div>
					<label className="knowledge-compose-field">
						<span><b>{selectedType.label}</b><small>写成未来的你或 Agent 可以直接采取行动的上下文</small></span>
						<textarea autoFocus placeholder={selectedType.prompt} value={newContent} onChange={(event) => setNewContent(event.target.value)} rows={5} />
						<em>{newContent.length} 字</em>
					</label>
					<div className="knowledge-anchor-row" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
						<label style={{ display: "flex", gap: "4px", alignItems: "center" }}>
							<span>锚定起始行</span>
							<input type="number" min={1} step={1} value={anchorStart} onChange={(event) => setAnchorStart(event.target.value)} placeholder="可选" aria-label="行级锚起始行" />
						</label>
						<label style={{ display: "flex", gap: "4px", alignItems: "center" }}>
							<span>结束行</span>
							<input type="number" min={1} step={1} value={anchorEnd} onChange={(event) => setAnchorEnd(event.target.value)} placeholder="可选" aria-label="行级锚结束行" />
						</label>
						<small>从 IDE 抄行号；区间未变则源文件其他改动不会判 stale</small>
					</div>
					<div className="knowledge-compose-actions">
						<button onClick={() => void cancelComposer()}>取消</button>
						<button className="knowledge-create" onClick={handleAdd} disabled={busy || !newContent.trim()}>
							{busy ? "正在写入…" : `附着到当前${context.objectName}`}
							{composerDirty ? <span className="unsaved-badge" style={{ marginLeft: "4px" }}>●</span> : null}
						</button>
					</div>
				</div>
			) : null}

			{scope === "node" && annotations.length > 0 ? (
				<div className="knowledge-spectrum" aria-label={`${context.title}类型分布`}>
					{knowledgeTypes.filter((type) => (typeCounts.get(type.id) ?? 0) > 0).map((type) => (
						<span key={type.id} className={`ann-type-${type.id}`}><i />{type.label}<b>{typeCounts.get(type.id)}</b></span>
					))}
				</div>
			) : null}

			<ul className="ann-list knowledge-list">
				{loading ? <li className="knowledge-empty loading"><span />正在读取{context.title}…</li> : null}
				{!loading && visible.length === 0 ? (
					<li className="knowledge-empty">
						<div className="knowledge-empty-glyph"><i /><i /><i /></div>
						<strong>{scope === "node" ? `让这个${context.objectName}拥有可追溯的${context.title}` : `${context.collectionName}还没有人工评审记录`}</strong>
						<p>{scope === "node" ? context.emptyGuide : `切回当前${context.objectName}开始记录。`}</p>
						{scope === "node" ? <button className="knowledge-create" onClick={() => setComposerOpen(true)}>记录第一条{context.title}</button> : null}
					</li>
				) : null}
				{visible.map((annotation) => {
					const ownerId = "node_id" in annotation ? String(annotation.node_id) : nodeId;
					return (
						<li key={`${ownerId}-${annotation.id}`} className={`ann-item knowledge-card ann-card-${annotation.type}${annotation.stale ? " is-stale" : ""}`}>
							<div className="ann-head">{renderBadge(annotation)}</div>
							{scope === "all" ? <button className="ann-node-link" title={`跳转到该${context.objectName}`} onClick={() => onJumpToNode?.(ownerId)}>⌖ {ownerId}<span>打开{context.objectName} →</span></button> : null}
							{editingId === annotation.id && scope === "node" ? (
								<div className={`knowledge-edit${editorDirty ? " knowledge-dirty" : ""}`}>
									<textarea value={editContent} onChange={(event) => setEditContent(event.target.value)} rows={5} />
									<div className="ann-actions">
										<button onClick={() => void cancelEditor()}>取消</button>
										<button className="knowledge-create" onClick={handleSaveEdit} disabled={busy || !editContent.trim()}>
											保存修订
											{editorDirty ? <span className="unsaved-badge" style={{ marginLeft: "4px" }}>●</span> : null}
										</button>
									</div>
								</div>
							) : (
								<>
									<p className="ann-content">{annotation.content}</p>
									<div className="ann-actions">
										{annotation.stale || (!annotation.source_hash && scope === "node") ? <button className="ann-review" disabled={busy} onClick={() => handleReview(annotation.id, scope === "all" ? ownerId : undefined)}>{annotation.stale ? `复核并重新绑定${context.sourceName}` : `绑定当前${context.sourceName}`}</button> : null}
										{scope === "node" ? <><button onClick={() => { setEditingId(annotation.id); setEditContent(annotation.content); setEditOriginalContent(annotation.content); }}>编辑</button><button className="ann-delete" onClick={() => handleDelete(annotation.id)}>删除</button></> : null}
									</div>
								</>
							)}
						</li>
					);
				})}
			</ul>
			{confirmDialog}
		</section>
	);
}
