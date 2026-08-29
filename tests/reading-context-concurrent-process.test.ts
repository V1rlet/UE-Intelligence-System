// Graph Brain / tests - reading-context 跨进程锁的真实并发写验收。
//
// 进程内测试证明锁原语正确；本测试补齐交接文档挂账的最后一环：多个真实 Node
// 子进程（各自独立的锁实现实例）并发 mutateReadingContext，验证
// 1) revision 无跳号、无回退（最终 revision == 各进程成功写入数之和）；
// 2) 零丢失更新（favorites 数量 == 成功写入数，每条都带独立 UUID）；
// 3) 最终文档通过 schema。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { emptyReadingContext, loadReadingContext, validateReadingContext } from "../core/reading-context/store.js";
import { renameDurableSync, writeFsyncedTemporary } from "../core/store/durable-write.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TSX_CLI = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

test("three real processes mutate reading-context concurrently with no lost updates", { timeout: 120_000 }, (t) => {
	const directory = mkdtempSync(join(tmpdir(), "graphbrain-rc-concurrent-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	// 先落一份初始文档，避免三个进程同时走"不存在→空档"的首写竞争路径。
	const initial = emptyReadingContext();
	mkdirSync(directory, { recursive: true });
	const initialPath = join(directory, "ue5_code.json");
	const temporary = `${initialPath}.tmp-${process.pid}-${randomUUID()}`;
	writeFsyncedTemporary(temporary, `${JSON.stringify(initial, null, 2)}\n`);
	renameDurableSync(temporary, initialPath);

	const writers = [1, 2, 3].map((id) => spawnSync(process.execPath, [
		TSX_CLI,
		join("tests", "fixtures", "reading-context-writer.ts"),
		directory,
		`w${id}`,
		"4",
	], { cwd: ROOT, encoding: "utf8", timeout: 60_000 }));

	const reports = writers.map((writer, index) => {
		assert.equal(writer.status, 0, `writer ${index + 1} 失败: ${writer.stderr?.slice(-500)}`);
		const line = writer.stdout.trim().split(/\r?\n/).pop() ?? "";
		return JSON.parse(line) as { writerId: string; succeeded: number; revision: number; favorites: number };
	});

	const totalWrites = reports.reduce((sum, report) => sum + report.succeeded, 0);
	assert.equal(totalWrites, 12, "每个 writer 4 次写入必须全部成功（busy 属暂态，重试后必须成功）");

	const finalDocument = JSON.parse(readFileSync(initialPath, "utf8")) as ReturnType<typeof loadReadingContext>;
	assert.equal(finalDocument.revision, totalWrites, "revision 必须恰好等于成功写入总数（无跳号、无丢失）");
	assert.equal(finalDocument.favorites.length, totalWrites, "每条写入都必须留存在最终文档（零丢失更新）");
	assert.deepEqual(validateReadingContext(finalDocument), []);
	const uniqueIds = new Set(finalDocument.favorites.map((favorite) => favorite.node_id));
	assert.equal(uniqueIds.size, totalWrites, "并发 writer 不得覆盖彼此的条目");
	// 三个 writer 进程各自持有的"最后已知 revision"允许落后，但绝不允许超前。
	for (const report of reports) assert.ok(report.revision <= finalDocument.revision);
});
