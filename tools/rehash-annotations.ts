// Graph Brain / tools - 标注 source_hash 强制重算（对齐当前图基线）
// 用途：图定稿更新后，node_snapshot 域的标注 hash 批量对齐新基线并清 stale；
//       真悬垂（节点已删除）的标注一并清理。幂等可反复跑；只处理 node_snapshot 域。
// 用法：npx tsx tools/rehash-annotations.ts <domain> <subsystem>
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAnnotationDocument, loadAnnotations, saveAnnotations, type AnnotationEntry } from "../core/annotation/store";
import { latestGraphFile, resolveNodeSourceHash } from "../core/annotation/staleness";
import { resolveGraphBrainProjectRoot } from "../core/source/project-root";

const ROOT = resolveGraphBrainProjectRoot(import.meta.url, "..");
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
// 图文件必须与 latestGraphFile 同根解析（ROOT 锚定）：按 cwd 解析会在仓库子目录
// 运行时读到别的 data/graphs，把标注 hash 错误地对齐到另一个基线。
const graph = JSON.parse(readFileSync(join(ROOT, "data", "graphs", graphFile), "utf8"));
const document = loadAnnotationDocument(domain, subsystem);
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
saveAnnotations(domain, subsystem, kept, document.revision);
console.log(`✓ ${domain}/${subsystem}: 重算 ${rehashed} 条，移除悬垂 ${removed} 条`);
