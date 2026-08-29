// Graph Brain / tools - E2 引擎 API 缓存老化报告（只读，报告级）
//
// 扫描 data/api-catalog/modules/*.json 的 synced_at：按年龄排序输出，并给出
// 建议增量补同步清单（--stale-days 阈值，默认 30 天）。不修改任何缓存文件；
// 实际补同步仍由 npm run sync:ue-api 执行。
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODULES_DIR = join(ROOT, "data", "api-catalog", "modules");

function optionValue(name: string): string | null {
	const index = process.argv.indexOf(name);
	return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const staleDays = (() => {
	const raw = optionValue("--stale-days");
	const value = raw === null ? 30 : Number(raw);
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--stale-days 必须是 >= 1 的整数，收到 ${raw}`);
	return value;
})();
const limit = (() => {
	const raw = optionValue("--limit");
	const value = raw === null ? 20 : Number(raw);
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--limit 必须是 >= 1 的整数`);
	return value;
})();

if (!existsSync(MODULES_DIR)) {
	console.error(`[cache:aging] 缓存目录不存在：${MODULES_DIR}（先运行 npm run sync:ue-api）`);
	process.exit(2);
}

interface Entry { scope: string; module: string; ageDays: number }

const entries: Entry[] = [];
for (const name of readdirSync(MODULES_DIR).filter((file) => file.endsWith(".json"))) {
	const path = join(MODULES_DIR, name);
	try {
		const cache = JSON.parse(readFileSync(path, "utf8")) as { scope?: unknown; module?: unknown; synced_at?: unknown };
		if (typeof cache.synced_at !== "string") continue;
		const ageMs = Date.now() - Date.parse(cache.synced_at);
		if (!Number.isFinite(ageMs)) continue;
		entries.push({
			scope: String(cache.scope ?? "?"),
			module: String(cache.module ?? name),
			ageDays: Math.max(0, Math.floor(ageMs / 86_400_000)),
		});
	} catch {
		continue;
	}
}

if (entries.length === 0) {
	console.log("[cache:aging] 没有可报告的模块缓存。");
	process.exit(0);
}

entries.sort((left, right) => right.ageDays - left.ageDays || left.module.localeCompare(right.module));
const buckets = { stale: 0, aging: 0, fresh: 0 };
for (const entry of entries) {
	if (entry.ageDays > staleDays) buckets.stale++;
	else if (entry.ageDays >= Math.ceil(staleDays / 2)) buckets.aging++;
	else buckets.fresh++;
}

console.log(`[cache:aging] ${entries.length} 个模块缓存 · stale(>${staleDays}d)=${buckets.stale} · aging=${buckets.aging} · fresh=${buckets.fresh}`);
console.log(`[cache:aging] 最旧的 ${Math.min(limit, entries.length)} 个（建议优先补同步）：`);
for (const entry of entries.slice(0, limit)) {
	console.log(`  ${String(entry.ageDays).padStart(4)}d  ${entry.scope}/${entry.module}`);
}
console.log(`[cache:aging] 补同步命令示例：npm run sync:ue-api -- <模块名>（或全量重跑）`);
void statSync;
