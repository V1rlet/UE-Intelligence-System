// Graph Brain / tools - 标注 source_hash 强制重算（对齐当前图基线）
// 用途：图定稿更新后，node_snapshot 域的标注 hash 批量对齐新基线并清 stale；
//       真悬垂（节点已删除）的标注一并清理。幂等可反复跑；只处理 node_snapshot 域。
// 用法：npx tsx tools/rehash-annotations.ts <domain> <subsystem>
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadAnnotations, saveAnnotations, type AnnotationEntry } from "../core/annotation/store";
import { latestGraphFile, resolveNodeSourceHash } from "../core/annotation/staleness";

const [domain, subsystem] = process.argv.slice(2);
if (!domain || !subsystem) {
	console.error("用法: npx tsx tools/rehash-annotations.ts <domain> <subsystem>");
	process.exit(1);
}
const graphFile = latestGraphFile(domain, subsystem);
if (!graphFile) {
	console.error(`✗ ${domain}/${subsystem}: 无图文件`);
	process.exit(1);
}
const graph = JSON.parse(readFileSync(resolve("data/graphs", graphFile), "utf8"));
const entries = loadAnnotations(domain, subsystem);
let rehashed = 0;
let removed = 0;
const kept: AnnotationEntry[] = [];
for (const entry of entries) {
	const hash = resolveNodeSourceHash(domain, subsystem, entry.node_id, graph);
	if (hash === null) {
		// 节点已不存在（或源文件不可达）——真悬垂
		console.log(`  移除悬垂标注 ${entry.node_id}（${entry.annotations.length} 条）`);
		removed += entry.annotations.length;
		continue;
	}
	for (const ann of entry.annotations) {
		if (ann.source_hash !== hash || ann.stale) {
			ann.source_hash = hash;
			delete ann.stale;
			rehashed++;
		}
	}
	kept.push(entry);
}
saveAnnotations(domain, subsystem, kept);
console.log(`✓ ${domain}/${subsystem}: 重算 ${rehashed} 条，移除悬垂 ${removed} 条`);
