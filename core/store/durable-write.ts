// Graph Brain / core/store - 原子写入的持久化与 Windows 韧性原语。
//
// temp+rename 只保证目录项切换的原子性，不保证掉电后的内容完整：临时文件必须先
// fsync 再切换。Windows 上杀毒/索引/搜索进程会短暂占用目标文件，rename 以
// EPERM/EACCES/EBUSY 瞬时失败——不重试会把一次完全正常的发布变成裸异常。

import { closeSync, fsyncSync, openSync, renameSync, writeFileSync } from "node:fs";

const TRANSIENT_RENAME_ERRORS = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_ATTEMPTS = 3;

/** 以 wx 独占创建临时文件并 fsync，确保 rename 之后内容已经落盘。 */
export function writeFsyncedTemporary(temporary: string, content: string): void {
	const descriptor = openSync(temporary, "wx");
	try {
		writeFileSync(descriptor, content, "utf8");
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
}

/** 同步上下文中的有界睡眠：Atomics.wait 是 Node 主线程唯一不占 CPU 的同步等待。 */
export function sleepSync(milliseconds: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/** rename 并对 Windows 瞬时占用错误做有界重试；非瞬时错误立即抛出。 */
export function renameDurableSync(temporary: string, destination: string): void {
	let lastError: unknown;
	for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt += 1) {
		try {
			renameSync(temporary, destination);
			return;
		} catch (error) {
			lastError = error;
			if (!TRANSIENT_RENAME_ERRORS.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
			if (attempt + 1 < RENAME_ATTEMPTS) sleepSync(50 * (attempt + 1));
		}
	}
	throw lastError;
}
