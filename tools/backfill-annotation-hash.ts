// Graph Brain / tools - 一次性数据治理：为存量标注回填 source_hash
//
// R1（2026-08-04）：data/annotations 5 份标注 0/5 有 source_hash，scan-stale 对现有数据空转
// （无 hash 的标注被跳过）。本脚本为每条标注补 source_hash，使陈旧检测首次生效。
// hash 语义与 core/annotation/staleness.ts 的 resolveNodeSourceHash 一致：
//   - node_snapshot 域（工作流域）：sha1(节点数据)——节点方案事实变了就标陈旧
//   - 源文件域（ue5_code 等）：sha1(节点 source_path 对应文件)
// 回填不置 stale 标记（stale 由下一次 npm run annotations:scan 判定）。幂等：已有 hash 跳过。

import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadAnnotations, saveAnnotations, type AnnotationEntry } from "../core/annotation/store.js";
import { resolveNodeSourceHash } from "../core/annotation/staleness.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ANNOTATIONS_DIR = join(ROOT, "data", "annotations");

interface BackfillResult {
	domain: string;
	subsystem: string;
	backfilled: number;
	skippedMissingNode: number;
}

export function backfillAnnotationHashes(annotationsDir = ANNOTATIONS_DIR): BackfillResult[] {
	const results: BackfillResult[] = [];
	for (const file of readdirSync(annotationsDir).filter((f) => f.endsWith("_annotations.json")).sort()) {
		const entries = JSON.parse(
			readFileSync(join(annotationsDir, file), "utf-8").replace(/^\uFEFF/, ""),
		) as AnnotationEntry[];
		const domain = entries[0]?.domain;
		if (!domain) continue;
		const stem = file.slice(0, -"_annotations.json".length);
		if (!stem.startsWith(`${domain}_`)) continue;
		const subsystem = stem.slice(domain.length + 1);

		const loaded = loadAnnotations(domain, subsystem);
		let backfilled = 0;
		let skippedMissingNode = 0;
		const hashByNode = new Map<string, string | null>();
		for (const entry of loaded) {
			let hash = hashByNode.get(entry.node_id);
			if (hash === undefined) {
				hash = resolveNodeSourceHash(domain, subsystem, entry.node_id);
				hashByNode.set(entry.node_id, hash);
			}
			for (const ann of entry.annotations) {
				if (ann.source_hash) continue; // 已有 hash，幂等跳过
				if (hash === null) {
					skippedMissingNode++;
					continue;
				}
				ann.source_hash = hash;
				backfilled++;
			}
		}
		if (backfilled > 0) saveAnnotations(domain, subsystem, loaded);
		results.push({ domain, subsystem, backfilled, skippedMissingNode });
	}
	return results;
}

const results = backfillAnnotationHashes();
for (const r of results) {
	console.log(`  ${r.domain}/${r.subsystem}: 回填 ${r.backfilled} 条（${r.skippedMissingNode} 条无法定位源文件跳过）`);
}
const total = results.reduce((sum, r) => sum + r.backfilled, 0);
console.log(`\n共回填 ${total} 条标注的 source_hash。运行 npm run annotations:scan 验证陈旧检测生效。`);
