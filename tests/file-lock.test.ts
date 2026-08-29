// Graph Brain / core/store - 共享文件锁测试：原子互斥、死进程/超时恢复、hook skip 语义。

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileLockBusyError, recoverStaleFileLock, withFileLock, withFileLockAsync } from "../core/store/file-lock.js";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "graphbrain-filelock-"));
	const lockDir = join(root, "locks");
	mkdirSync(lockDir, { recursive: true });
	return { root, lockPath: join(lockDir, "test.lock") };
}

test("withFileLock is mutually exclusive across acquisitions", (t) => {
	const { root, lockPath } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	let inside = 0;
	let maxInside = 0;
	const results: string[] = [];
	// 顺序获取：第一把持锁时第二把必然 busy 拒绝（throw），验证互斥。
	withFileLock(lockPath, () => {
		inside++;
		maxInside = Math.max(maxInside, inside);
		assert.throws(
			() => withFileLock(lockPath, () => { inside++; }, { busyMessage: (p) => `busy(${p})` }),
			(error: unknown) => error instanceof FileLockBusyError && /busy\(/.test(error.message),
		);
		results.push("first");
		inside--;
	});
	withFileLock(lockPath, () => results.push("second"));
	assert.deepEqual(results, ["first", "second"]);
	assert.equal(maxInside, 1);
	assert.equal(existsSync(lockPath), false, "锁必须在 action 结束后释放");
});

test("withFileLock skip mode returns null without executing the action", (t) => {
	const { root, lockPath } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	let executed = 0;
	withFileLock(lockPath, () => {
		const skipped = withFileLock(lockPath, () => { executed++; }, { busy: "skip" });
		assert.equal(skipped, null);
		assert.equal(executed, 0, "skip 模式不得执行 action");
	}, {});
	assert.equal(executed, 0);
});

test("a dead owner lock is recovered and the next acquisition proceeds", (t) => {
	const { root, lockPath } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	// 模拟死亡进程残留的锁：PID 999_999_999 不存在，时间戳是新的。
	writeFileSync(lockPath, "999999999 2026-08-09T00:00:00.000Z\n", "utf8");
	assert.equal(recoverStaleFileLock(lockPath, 10 * 60 * 1000), true);
	assert.equal(existsSync(lockPath), false);
	const value = withFileLock(lockPath, () => "recovered");
	assert.equal(value, "recovered");
});

test("an expired lock is recovered even when the owner pid looks alive", (t) => {
	const { root, lockPath } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeFileSync(lockPath, `${process.pid} 2020-01-01T00:00:00.000Z\n`, "utf8");
	const reasons: string[] = [];
	assert.equal(recoverStaleFileLock(lockPath, 1000, undefined, (reason) => reasons.push(reason)), true);
	assert.deepEqual(reasons, ["older than 1000 ms"]);
	assert.equal(existsSync(lockPath), false);
});

test("a live owner lock within the transaction window is not recoverable", (t) => {
	const { root, lockPath } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeFileSync(lockPath, `${process.pid} ${new Date().toISOString()}\n`, "utf8");
	assert.equal(recoverStaleFileLock(lockPath, 10 * 60 * 1000), false);
	assert.equal(existsSync(lockPath), true);
	assert.throws(() => withFileLock(lockPath, () => "never"), /already locked/);
});

test("dead-pid recovery is reported through onRecover", (t) => {
	const { root, lockPath } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeFileSync(lockPath, "999999999 2026-08-09T00:00:00.000Z\n", "utf8");
	const reasons: string[] = [];
	const value = withFileLock(lockPath, () => "ok", { staleMs: 10 * 60 * 1000, onRecover: (reason) => reasons.push(reason) });
	assert.equal(value, "ok");
	assert.ok(reasons.some((reason) => reason.includes("dead pid")), `expected dead-pid reason, got ${JSON.stringify(reasons)}`);
});

test("custom record formats (JSON) round-trip through the same lock", (t) => {
	const { root, lockPath } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const serialize = (record: { pid: number; started_at: string }) => `${JSON.stringify(record)}\n`;
	const parse = (content: string) => {
		const value = JSON.parse(content) as { pid: number; started_at: string };
		return Number.isSafeInteger(value.pid) ? value : null;
	};
	const value = withFileLock(lockPath, () => {
		const written = JSON.parse(readFileSync(lockPath, "utf8")) as { pid: number; started_at: string };
		assert.equal(written.pid, process.pid);
		return "json-lock";
	}, { serialize, parse });
	assert.equal(value, "json-lock");
	// JSON 格式的陈旧锁同样可恢复。
	writeFileSync(lockPath, JSON.stringify({ pid: 999999999, started_at: "2026-08-09T00:00:00.000Z" }) + "\n", "utf8");
	assert.equal(recoverStaleFileLock(lockPath, 1000, parse), true);
});

test("withFileLockAsync stays mutually exclusive across awaited actions", async (t) => {
	const { root, lockPath } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const order: string[] = [];
	const first = withFileLockAsync(lockPath, async () => {
		// 挂起期间锁必须仍被持有：并发同步获取必然 busy。
		assert.throws(() => withFileLock(lockPath, () => "never"), /already locked/);
		await new Promise((resolve) => setTimeout(resolve, 20));
		order.push("first");
		return 1;
	});
	const second = withFileLockAsync(lockPath, async () => {
		order.push("second");
		return 2;
	}, { busy: "skip" });
	assert.equal(await first, 1);
	assert.equal(await second, null, "skip 模式在异步持锁期间不得执行 action");
	assert.deepEqual(order, ["first"]);
	assert.equal(existsSync(lockPath), false, "异步 action 结束后锁必须释放");
	const third = await withFileLockAsync(lockPath, async () => 3);
	assert.equal(third, 3, "释放后可再次获取");
	assert.equal(existsSync(lockPath), false);
});
