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
	const byIdentity = new Map<string, { file: string; mtimeMs: number }[]>();
	for (const file of dated) {
		const path = join(graphsDir, file);
		let identity = file.replace(/_\d{4}-\d{2}-\d{2}\.cyto\.json$/, "");
		try {
			const meta = (JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) as { meta?: { domain?: string; subsystem?: string } }).meta;
			if (meta?.domain && meta?.subsystem) identity = `${meta.domain}/${meta.subsystem}`;
		} catch { /* meta 不可读时退回文件名身份 */ }
		const list = byIdentity.get(identity) ?? [];
		list.push({ file, mtimeMs: statSync(path).mtimeMs });
		byIdentity.set(identity, list);
	}
	const candidates: TidyCandidate[] = [];
	for (const [identity, files] of byIdentity) {
		if (files.length < 2) continue;
		files.sort((a, b) => b.mtimeMs - a.mtimeMs);
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
	for (const candidate of candidates) {
		console.log(`${apply ? "删除" : "[dry-run] 将删除"} ${candidate.file}`
			+ `（${candidate.identity} 已由 ${candidate.supersededBy} 取代）`);
		if (apply) unlinkSync(join(GRAPHS_DIR, candidate.file));
	}
	if (!apply) console.log(`\n共 ${candidates.length} 个候选。确认后运行 npm run data:tidy -- --apply 执行删除（lore 历史可回溯）。`);
	else console.log(`\n已删除 ${candidates.length} 个被取代旧版；建议随后运行 npm run validate 与 lore 提交。`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main();
}
