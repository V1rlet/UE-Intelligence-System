// Graph Brain / core/store - ue5_code 图谱版本保留策略
// 同一 subsystem 的日期版文件只保留最新一份；默认仅列出，`--apply` 才删除。

import { readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const GRAPHS_DIR = join(ROOT, "data", "graphs");

export interface TidyCandidate {
	file: string;
	identity: string;
	supersededBy: string;
	updatedAt: string;
}

export function findSupersededGraphs(graphsDir = GRAPHS_DIR): TidyCandidate[] {
	const dated = readdirSync(graphsDir)
		.filter((file) => /_\d{4}-\d{2}-\d{2}\.cyto\.json$/.test(file));
	const byIdentity = new Map<string, { file: string; rank: string; mtimeMs: number }[]>();
	for (const file of dated) {
		const path = join(graphsDir, file);
		let mtimeMs: number;
		try {
			mtimeMs = statSync(path).mtimeMs;
		} catch {
			// readdir 与 stat 之间存在删除窗口；文件已消失则不再是被取代候选。
			continue;
		}
		let identity = file.replace(/_\d{4}-\d{2}-\d{2}\.cyto\.json$/, "");
		let generatedAt = "";
		try {
			const meta = (JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) as { meta?: { domain?: string; subsystem?: string; generated_at?: unknown } }).meta;
			if (meta?.domain && meta?.subsystem) identity = `${meta.domain}/${meta.subsystem}`;
			if (typeof meta?.generated_at === "string") generatedAt = meta.generated_at;
		} catch { /* meta 不可读时退回文件名身份 */ }
		const list = byIdentity.get(identity) ?? [];
		list.push({ file, rank: generatedAt || new Date(mtimeMs).toISOString(), mtimeMs });
		byIdentity.set(identity, list);
	}
	const candidates: TidyCandidate[] = [];
	for (const [identity, files] of byIdentity) {
		if (files.length < 2) continue;
		// 与 resolveCurrentGraphArtifact 的 legacy 选取键一致（generated_at 降序、文件名
		// 降序）：按 mtime 保留会在 git checkout/复制/备份恢复后删掉真正的当前图。
		files.sort((a, b) => b.rank.localeCompare(a.rank) || b.file.localeCompare(a.file));
		const latest = files[0];
		for (const superseded of files.slice(1)) {
			candidates.push({
				file: superseded.file,
				identity,
				supersededBy: latest.file,
				updatedAt: new Date(superseded.mtimeMs).toISOString(),
			});
		}
	}
	return candidates.sort((a, b) => a.identity.localeCompare(b.identity));
}

function main(): void {
	const apply = process.argv.includes("--apply");
	const candidates = findSupersededGraphs();
	if (candidates.length === 0) {
		console.log("无被取代的旧版图谱文件——数据目录已整洁。");
		return;
	}
	const failures: string[] = [];
	for (const candidate of candidates) {
		console.log(`${apply ? "删除" : "[dry-run] 将删除"} ${candidate.file}`
			+ `（${candidate.identity} 已由 ${candidate.supersededBy} 取代）`);
		if (apply) {
			try {
				unlinkSync(join(GRAPHS_DIR, candidate.file));
			} catch (error) {
				// Windows 上文件被占用（EBUSY/EPERM）时收集失败继续处理其余候选。
				failures.push(`${candidate.file}: ${(error as Error).message}`);
			}
		}
	}
	if (failures.length > 0) {
		console.error(`\n${failures.length} 个文件删除失败，需处理后重跑：`);
		for (const failure of failures) console.error(`  - ${failure}`);
		process.exitCode = 1;
		return;
	}
	if (!apply) console.log(`\n共 ${candidates.length} 个候选。确认后运行 npm run data:tidy -- --apply 执行删除（lore 历史可回溯）。`);
	else console.log(`\n已删除 ${candidates.length} 个被取代旧版；建议随后运行 npm run validate 与 lore 提交。`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main();
}
