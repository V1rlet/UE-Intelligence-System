// Graph Brain / core/store - 共享文件锁：原子获取（open wx）+ 死进程/超时陈旧恢复 + 确定性释放。
//
// publication 锁（core/store/data-publication.ts 的 .write.lock）与 post-commit hook 锁
// （logs/hook.lock）共用同一能力，避免两份含义重叠的锁实现漂移。锁文件记录 owner pid 与
// 开始时间；占用者死亡或超过最大事务时长时允许恢复，其余情况拒绝并发持有。

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface FileLockRecord {
	pid: number;
	started_at: string;
}

export interface FileLockOptions {
	/** 锁超过该时长（默认 10 分钟）视为陈旧，可被下一个持有者接管 */
	staleMs?: number;
	/** 锁文件内容序列化；默认 `pid ISO` 明文 */
	serialize?: (record: FileLockRecord) => string;
	/** 锁文件内容反序列化；解析失败回退文件 mtime */
	parse?: (content: string) => FileLockRecord | null;
	/** 获取不到锁时的行为：throw（默认，写入路径使用）或 skip（hook 等不阻塞用户提交的路径） */
	busy?: "throw" | "skip";
	/** busy=throw 时的错误消息；默认 `already locked (<path>)` */
	busyMessage?: (lockPath: string) => string;
	/** 恢复陈旧锁时回调，记录恢复原因（死 pid / 超时） */
	onRecover?: (reason: string) => void;
}

function defaultSerialize(record: FileLockRecord): string {
	return `${record.pid} ${record.started_at}\n`;
}

function defaultParse(content: string): FileLockRecord | null {
	const match = content.trim().match(/^(\d+)\s+(\S.*)$/);
	if (!match) return null;
	const pid = Number(match[1]);
	if (!Number.isSafeInteger(pid) || !Number.isFinite(Date.parse(match[2]))) return null;
	return { pid, started_at: match[2] };
}

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}

function readLock(lockPath: string, parse: NonNullable<FileLockOptions["parse"]>): FileLockRecord | null {
	try {
		return parse(readFileSync(lockPath, "utf8"));
	} catch {
		return null;
	}
}

/**
 * 恢复死进程或超过最大事务时长的陈旧锁；返回锁是否已可重新获取。
 * 记录解析失败时按文件 mtime 判定过期；并发恢复下文件已被移除时返回 true
 * （锁已失效，调用方应重试原子获取），绝不抛 ENOENT。
 */
export function recoverStaleFileLock(
	lockPath: string,
	staleMs: number,
	parse?: FileLockOptions["parse"],
	onRecover?: FileLockOptions["onRecover"],
): boolean {
	if (!existsSync(lockPath)) return false;
	const record = readLock(lockPath, parse ?? defaultParse);
	let startedMs: number;
	try {
		startedMs = record ? Date.parse(record.started_at) : statSync(lockPath).mtimeMs;
	} catch {
		// 并发恢复竞态：锁刚被其他进程移除，视为已可重新获取。
		return true;
	}
	const expired = !Number.isFinite(startedMs) || Date.now() - startedMs >= staleMs;
	const ownerDead = Boolean(record && !processExists(record.pid));
	if (!expired && !ownerDead) return false;
	rmSync(lockPath, { force: true });
	onRecover?.(ownerDead ? `dead pid ${record!.pid}` : `older than ${staleMs} ms`);
	return true;
}

/**
 * 原子文件锁：成功持有并执行 action 返回其结果；busy=throw 时锁被占用即抛错，
 * busy=skip 时返回 null（调用方自行决定是否跳过）。锁在 action 结束后确定性释放。
 */
export function withFileLock<T>(lockPath: string, action: () => T, options: FileLockOptions = {}): T | null {
	const staleMs = options.staleMs ?? 10 * 60 * 1000;
	const busy = options.busy ?? "throw";
	const parse = options.parse ?? defaultParse;
	const serialize = options.serialize ?? defaultSerialize;
	mkdirSync(dirname(lockPath), { recursive: true });
	let descriptor: number | null = null;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			descriptor = openSync(lockPath, "wx");
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			if (attempt === 0 && recoverStaleFileLock(lockPath, staleMs, parse, options.onRecover)) continue;
			if (busy === "skip") return null;
			throw new Error(options.busyMessage?.(lockPath) ?? `already locked (${lockPath})`);
		}
	}
	if (descriptor === null) {
		if (busy === "skip") return null;
		throw new Error(options.busyMessage?.(lockPath) ?? `already locked (${lockPath})`);
	}
	try {
		try {
			writeFileSync(descriptor, serialize({ pid: process.pid, started_at: new Date().toISOString() }), "utf8");
		} catch (error) {
			closeSync(descriptor);
			descriptor = null;
			rmSync(lockPath, { force: true });
			throw error;
		}
		return action();
	} finally {
		if (descriptor !== null) closeSync(descriptor);
		// 归属校验：仅当锁文件仍属于本进程时才删除。若 action 超过 staleMs 且被
		// 后继进程接管（恢复竞态），此处不得删除后继持有者的锁——否则跨进程互斥失效。
		try {
			const owner = readLock(lockPath, parse);
			if (owner && owner.pid === process.pid) rmSync(lockPath, { force: true });
		} catch {
			/* 锁已被恢复/移除：不再干预 */
		}
	}
}
