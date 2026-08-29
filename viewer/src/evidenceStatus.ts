import type { GraphCatalogEntry } from "./graphCatalog";

export type EvidenceTone = "current" | "partial" | "stale" | "unverified";

export interface EvidenceStatusPresentation {
	tone: EvidenceTone;
	label: string;
	compactLabel: string;
	reason: string;
	icon: "warning" | "check" | "review";
}

const countFormatter = new Intl.NumberFormat("zh-CN");

/**
 * One presentation boundary for catalog provenance and freshness.
 *
 * Catalog entries from older servers remain valid: missing verifiable provenance
 * is presented as unverified rather than guessed to be current.
 */
export function resolveEvidenceStatus(entry: GraphCatalogEntry): EvidenceStatusPresentation {
	if (entry.freshness === "stale") {
		return {
			tone: "stale",
			label: "已过期",
			compactLabel: "已过期",
			reason: entry.freshness_reason === "fingerprint-mismatch"
				? "当前源码内容指纹与图谱提取快照不一致"
				: `图谱提取后检测到 ${countFormatter.format(entry.source_files_newer ?? 0)} 个源码文件发生更新`,
			icon: "warning",
		};
	}

	if (entry.freshness === "current" && entry.coverage_status === "partial") {
		return {
			tone: "partial",
			label: "来源已验证 · 覆盖部分",
			compactLabel: "部分覆盖",
			reason: `源码指纹一致，但有 ${countFormatter.format(entry.coverage_skipped_files ?? 0)} 个文件未被类提取器消费`,
			icon: "review",
		};
	}

	if (entry.freshness === "current") {
		return {
			tone: "current",
			label: "来源已验证",
			compactLabel: "已验证",
			reason: "当前源码内容指纹与图谱提取快照一致",
			icon: "check",
		};
	}

	return {
		tone: "unverified",
		label: "来源未验证",
		compactLabel: "未验证",
		reason: `当前 v${entry.format_version ?? 1} 图缺少可验证的源码指纹`,
		icon: "review",
	};
}

export function evidenceExtractionAge(entry: GraphCatalogEntry, now = Date.now()): string {
	if (!entry.generated_at) return "未记录";
	const elapsed = now - Date.parse(entry.generated_at);
	if (!Number.isFinite(elapsed)) return "未知";
	const hours = Math.max(0, Math.floor(elapsed / 3_600_000));
	if (hours < 1) return "刚刚";
	if (hours < 24) return `${hours} 小时前`;
	return `${Math.floor(hours / 24)} 天前`;
}
