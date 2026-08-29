// Graph Brain / tests/fixtures - 跨进程并发写 reading-context 的子进程夹具。
// 用法：tsx tests/fixtures/reading-context-writer.ts <directory> <writerId> <iterations>
// 每个 writer 循环做整档替换式写入（随机收藏），busy（FileLockBusyError）时退避重试，
// 成功次数经 stdout 的 JSON 行回报，供父测试聚合断言"零丢失更新"。
import { randomUUID } from "node:crypto";
import { FileLockBusyError } from "../../core/store/file-lock.js";
import { emptyReadingContext, loadReadingContext, mutateReadingContext, ReadingContextConflictError, validateReadingContext } from "../../core/reading-context/store.js";

const [directory, writerId, iterationsArg] = process.argv.slice(2);
const iterations = Number(iterationsArg ?? "4");
if (!directory || !Number.isSafeInteger(iterations) || iterations < 1) {
	console.error("用法: tsx reading-context-writer.ts <directory> <writerId> <iterations>");
	process.exit(2);
}

let document = emptyReadingContext();
let succeeded = 0;
for (let i = 0; i < iterations; i++) {
	// 与真实调用方一致的重试节奏：锁被并发持有（busy）与 revision 落后（conflict）
	// 都是暂态——前者退避重试，后者重读最新文档后基于新 revision 重放本次意图。
	for (let attempt = 0; ; attempt++) {
		try {
			document = mutateReadingContext("ue5_code", document.revision, (draft) => {
				draft.favorites.push({
					kind: "function",
					source: "project",
					node_id: `${writerId}-${i}-${randomUUID().slice(0, 8)}`,
					added_at: new Date().toISOString(),
				});
			}, directory);
			succeeded++;
			break;
		} catch (error) {
			if (error instanceof ReadingContextConflictError) {
				document = loadReadingContext("ue5_code", directory);
				continue;
			}
			if (!(error instanceof FileLockBusyError) || attempt >= 200) throw error;
			await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 20));
		}
	}
}
const errors = validateReadingContext(document);
if (errors.length > 0) throw new Error(`writer ${writerId} 最终文档不合法: ${errors.join("; ")}`);
console.log(JSON.stringify({ writerId, succeeded, revision: document.revision, favorites: document.favorites.length }));
