import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	loadDataPublicationState,
	planDataPublicationPrune,
	pruneDataPublication,
	publicationDirectories,
	rollbackDataPublication,
	validatePublishedArtifacts,
} from "../core/store/data-publication.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directories = publicationDirectories(resolve(ROOT, "data"));

function option(name: string): string | null {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function status(): void {
	const state = loadDataPublicationState(directories.publications);
	const errors = validatePublishedArtifacts(directories);
	console.log(JSON.stringify({ ...state, validation_errors: errors }, null, 2));
	if (errors.length > 0) process.exitCode = 1;
}

function rollback(): void {
	const subsystem = option("--subsystem") ?? "project";
	const current = loadDataPublicationState(directories.publications);
	const next = rollbackDataPublication(directories.publications, subsystem, current.revision);
	const errors = validatePublishedArtifacts(directories);
	if (errors.length > 0) throw new Error(`rollback produced an invalid publication: ${errors.join("; ")}`);
	console.log(`rolled back ue5_code/${subsystem} to ${next.publications.find((item) => item.subsystem === subsystem)?.generations[0]?.id} (revision ${next.revision})`);
}

function prune(): void {
	const subsystem = option("--subsystem") ?? "project";
	const apply = process.argv.includes("--apply");
	const plan = planDataPublicationPrune(directories, subsystem);
	console.log(`[data:prune] ue5_code/${subsystem} revision ${plan.revision}`);
	if (plan.deletable.length === 0) {
		console.log("无可删除的管理格式文件（当前/回滚/报告引用的 generation 已全部保留）。");
	} else {
		for (const item of plan.deletable) {
			console.log(`${apply ? "删除" : "[dry-run] 将删除"} ${item.file}`
				+ `（${item.kind}${item.recoverable ? "，可从保留内容恢复" : "，内容寻址产物不可恢复"}）`);
		}
	}
	for (const note of plan.manualReview) console.log(`[需人工审查] ${note}`);
	console.log(`保留 ${plan.retained.length} 个管理格式文件。`);
	if (apply && plan.deletable.length > 0) {
		const result = pruneDataPublication(directories, subsystem, plan.revision);
		const errors = validatePublishedArtifacts(directories);
		if (errors.length > 0) throw new Error(`prune 后 publication 校验失败：${errors.join("; ")}`);
		console.log(`已删除 ${result.removed.length} 个文件，删除后 validate 通过。`);
	} else if (apply) {
		console.log("未删除任何文件。");
	} else {
		console.log(`dry-run 未删除任何文件；确认后运行 npm run data:prune -- --apply。`);
	}
}

const command = process.argv[2] ?? "status";
if (command === "status") status();
else if (command === "rollback") rollback();
else if (command === "prune") prune();
else {
	console.error("usage: tsx tools/data-publication.ts <status|rollback|prune> [--subsystem project] [--apply]");
	process.exit(2);
}
