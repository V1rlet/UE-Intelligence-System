import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrateLegacyReadingContext } from "../core/reading-context/migrate.js";
import {
	emptyReadingContext,
	loadReadingContext,
	mutateReadingContext,
	ReadingContextConflictError,
	replaceReadingContext,
} from "../core/reading-context/store.js";

test("legacy reading data migrates losslessly without inventing favorite source", () => {
	const annotation = {
		id: "ann_1",
		type: "reference" as const,
		content: "Keep exact text",
		created_at: "2026-01-01T00:00:00.000Z",
		source_hash: "abc",
	};
	const migrated = migrateLegacyReadingContext([
		{subsystem: "project", entries: [{node_id: "AThing", domain: "ue5_code", annotations: [annotation]}]},
	], [{ node_id: "AThing::Run", added_at: "2026-01-02T00:00:00.000Z" }], "2026-01-03T00:00:00.000Z");
	// 旧数据迁移进"当前"格式（D-P3 起 READING_CONTEXT_FORMAT_VERSION = 2）：
	// 迁移产物必须始终是最新版本，而不是停留在旧版本号。
	assert.equal(migrated.format_version, 2);
	assert.equal(migrated.revision, 1);
	assert.deepEqual(migrated.annotations[0], { subsystem: "project", node_id: "AThing", annotations: [annotation] });
	assert.deepEqual(migrated.favorites[0], {
		kind: "function",
		source: "unknown",
		node_id: "AThing::Run",
		added_at: "2026-01-02T00:00:00.000Z",
	});
});

test("reading-context mutations round-trip and reject stale revisions", () => {
	const directory = mkdtempSync(join(tmpdir(), "graphbrain-reading-context-"));
	try {
		replaceReadingContext(emptyReadingContext(), directory);
		const written = mutateReadingContext("ue5_code", 0, (draft) => {
			draft.favorites.push({ kind: "class", source: "engine", node_id: "AActor", added_at: "2026-01-01T00:00:00.000Z" });
		}, directory);
		assert.equal(written.revision, 1);
		assert.deepEqual(loadReadingContext("ue5_code", directory).favorites.map((favorite) => favorite.node_id), ["AActor"]);
		assert.throws(
			() => mutateReadingContext("ue5_code", 0, (draft) => { draft.favorites = []; }, directory),
			(error: unknown) => error instanceof ReadingContextConflictError && error.current.revision === 1,
		);
		assert.deepEqual(loadReadingContext("ue5_code", directory).favorites.map((favorite) => favorite.node_id), ["AActor"]);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("reading-context writes are serialized by the file lock and recover stale locks", () => {
	const directory = mkdtempSync(join(tmpdir(), "graphbrain-reading-lock-"));
	try {
		replaceReadingContext(emptyReadingContext(), directory);
		// 模拟并发写入者持有锁：写入必须拒绝（而非静默覆盖）。
		writeFileSync(join(directory, ".write.lock"), `${process.pid} ${new Date().toISOString()}\n`, "utf8");
		assert.throws(
			() => mutateReadingContext("ue5_code", 0, (draft) => { draft.favorites = []; }, directory),
			/already locked|已被/,
		);
		// 释放锁后写入恢复正常。
		rmSync(join(directory, ".write.lock"), { force: true });
		const written = mutateReadingContext("ue5_code", 0, (draft) => {
			draft.favorites.push({ kind: "class", source: "project", node_id: "AThing", added_at: "2026-01-01T00:00:00.000Z" });
		}, directory);
		assert.equal(written.revision, 1);
		// 死亡进程残留的陈旧锁可被自动恢复。
		writeFileSync(join(directory, ".write.lock"), `999999999 2026-08-09T00:00:00.000Z\n`, "utf8");
		const recovered = mutateReadingContext("ue5_code", 1, (draft) => {
			draft.favorites.push({ kind: "function", source: "engine", node_id: "AFoo::Bar", added_at: "2026-01-02T00:00:00.000Z" });
		}, directory);
		assert.equal(recovered.revision, 2);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});