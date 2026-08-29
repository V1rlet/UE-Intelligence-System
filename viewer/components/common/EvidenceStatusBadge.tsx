import type { GraphCatalogEntry } from "../../src/graphCatalog";
import { resolveEvidenceStatus } from "../../src/evidenceStatus";
import AppIcon from "./AppIcon";

interface Props {
	entry: GraphCatalogEntry;
}

export default function EvidenceStatusBadge({ entry }: Props) {
	const status = resolveEvidenceStatus(entry);
	return <span
		className={`evidence-status-badge is-${status.tone}`}
		data-evidence-status={status.tone}
		role="status"
		aria-label={`只读代码事实。项目代码证据：${status.label}。${status.reason}`}
		title={status.reason}
	>
		<AppIcon name={status.icon} size={14} />
		<span className="evidence-status-prefix">只读代码事实</span>
		<span className="evidence-status-separator" aria-hidden="true">·</span>
		<strong>{status.compactLabel}</strong>
	</span>;
}
