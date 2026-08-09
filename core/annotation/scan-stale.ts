// Graph Brain / core/annotation - 标注陈旧扫描 CLI（P4U3）
//
// 用法：
//   npx tsx core/annotation/scan-stale.ts               # 扫描 reading-context 全部 subsystem
//   npx tsx core/annotation/scan-stale.ts <domain> <subsystem>   # 只扫一份
//
// 比对每条标注的 source_hash 与节点当前源文件，不匹配置 stale=true（幂等）。
// P4U4 的 VCS hook 在增量提取后调用本命令。

import { scanAllStale, scanStale, type ScanResult } from "./staleness.js";

const argv = process.argv.slice(2);

let results: ScanResult[];
if (argv.length >= 2) {
	results = [scanStale(argv[0], argv[1])];
} else if (argv.length === 0) {
	results = scanAllStale();
} else {
	console.error("用法: npx tsx core/annotation/scan-stale.ts [<domain> <subsystem>]");
	process.exit(2);
}

let totalStale = 0;
for (const r of results) {
	totalStale += r.stale;
	const flag = r.stale > 0 ? "⚠" : "✓";
	console.log(
		`${flag} ${r.domain}/${r.subsystem}: 比对 ${r.checked} 条，陈旧 ${r.stale}，无 hash 跳过 ${r.skipped}${r.changed ? "（已写回）" : ""}`,
	);
}
if (results.length === 0) console.log("reading-context 中没有标注可扫描");
console.log(`\n共 ${results.length} 个标注子系统，陈旧标注 ${totalStale} 条`);
