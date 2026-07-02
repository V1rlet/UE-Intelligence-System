// Graph Brain / viewer - 标注面板：选中节点的标注查看/新增/编辑/删除，经 /api/annotations 持久化
import { useEffect, useState } from "react";

const TYPE_LABELS: Record<string, string> = {
	gotcha: "踩坑",
	best_practice: "最佳实践",
	design_decision: "设计决策",
	performance: "性能",
	reference: "参考",
};

interface Annotation {
	id: string;
	type: string;
	content: string;
	created_at: string;
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
}

export default function AnnotationPanel({ nodeId, domain, subsystem }: Props) {
	const [anns, setAnns] = useState<Annotation[]>([]);
	const [newType, setNewType] = useState("gotcha");
	const [newContent, setNewContent] = useState("");
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editContent, setEditContent] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const applyEntries = (entries: Entry[], forNode: string) =>
		setAnns(entries.find((e) => e.node_id === forNode)?.annotations ?? []);

	useEffect(() => {
		setEditingId(null);
		setNewContent("");
		setError(null);
		fetch(`/api/annotations/${domain}/${subsystem}`)
			.then((r) => r.json())
			.then((entries: Entry[]) => applyEntries(entries, nodeId))
			.catch((e) => setError(String(e)));
	}, [nodeId, domain, subsystem]);

	const post = async (payload: Record<string, unknown>) => {
		setBusy(true);
		setError(null);
		try {
			const r = await fetch(`/api/annotations/${domain}/${subsystem}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ node_id: nodeId, ...payload }),
			});
			const data = await r.json();
			if (!r.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${r.status}`);
			applyEntries(data as Entry[], nodeId);
			return true;
		} catch (e) {
			setError(String(e));
			return false;
		} finally {
			setBusy(false);
		}
	};

	const handleAdd = async () => {
		if (!newContent.trim()) return;
		if (await post({ action: "add", annotation: { type: newType, content: newContent } })) {
			setNewContent("");
		}
	};

	const handleSaveEdit = async () => {
		if (!editingId || !editContent.trim()) return;
		if (await post({ action: "update", ann_id: editingId, annotation: { content: editContent } })) {
			setEditingId(null);
		}
	};

	const handleDelete = async (annId: string) => {
		if (!window.confirm("删除这条标注？")) return;
		await post({ action: "delete", ann_id: annId });
	};

	return (
		<section className="ann-panel">
			<h3>标注（{anns.length}）</h3>
			{error ? <p className="ann-error">{error}</p> : null}

			<ul className="ann-list">
				{anns.map((a) => (
					<li key={a.id} className="ann-item">
						<div className="ann-head">
							<span className={`ann-badge ann-badge-${a.type}`}>{TYPE_LABELS[a.type] ?? a.type}</span>
							{a.stale ? <span className="ann-stale">陈旧</span> : null}
							<span className="ann-date">{a.created_at.slice(0, 10)}</span>
						</div>
						{editingId === a.id ? (
							<>
								<textarea
									value={editContent}
									onChange={(e) => setEditContent(e.target.value)}
									rows={4}
								/>
								<div className="ann-actions">
									<button onClick={handleSaveEdit} disabled={busy || !editContent.trim()}>保存</button>
									<button onClick={() => setEditingId(null)} disabled={busy}>取消</button>
								</div>
							</>
						) : (
							<>
								<p className="ann-content">{a.content}</p>
								<div className="ann-actions">
									<button onClick={() => { setEditingId(a.id); setEditContent(a.content); }} disabled={busy}>编辑</button>
									<button onClick={() => handleDelete(a.id)} disabled={busy}>删除</button>
								</div>
							</>
						)}
					</li>
				))}
			</ul>

			<div className="ann-add">
				<div className="ann-add-row">
					<select value={newType} onChange={(e) => setNewType(e.target.value)}>
						{Object.entries(TYPE_LABELS).map(([v, label]) => (
							<option key={v} value={v}>{label}</option>
						))}
					</select>
				</div>
				<textarea
					placeholder="为该节点添加标注……"
					value={newContent}
					onChange={(e) => setNewContent(e.target.value)}
					rows={3}
				/>
				<button onClick={handleAdd} disabled={busy || !newContent.trim()}>添加标注</button>
			</div>
		</section>
	);
}
