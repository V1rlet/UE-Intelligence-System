// Graph Brain / core/hooks - git post-commit hook 安装器（P4U4）
//
// 用法：
//   npx tsx core/hooks/install-git-hook.ts <项目名或仓库根路径> [--config <path>] [--uninstall]
//
// 向目标 git 仓库写入 .git/hooks/post-commit（sh 脚本，LF）：提交后若触及
// trigger_extensions 之一，就把 VCS diff 的文件清单写入临时文件，后台调
// post-commit-update.ts（输出进 GraphBrain 的 logs/hook.log），提交本身零等待。
// 已存在非本工具生成的 post-commit 时拒绝覆盖（不吞用户既有 hook）。

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MARKER = "# graphbrain-hook v1";

interface HookProject {
	name: string;
	root: string;
	vcs: string;
	trigger_extensions: string[];
}

function normPath(p: string): string {
	return resolve(p).replaceAll("\\", "/").toLowerCase();
}

function fail(msg: string): never {
	console.error(msg);
	process.exit(1);
}

// —— 参数 ——
const argv = process.argv.slice(2);
let target: string | null = null;
let configArg: string | null = null;
let uninstall = false;
for (let i = 0; i < argv.length; i++) {
	if (argv[i] === "--config") configArg = argv[++i];
	else if (argv[i] === "--uninstall") uninstall = true;
	else target = argv[i];
}
if (!target) fail("用法: npx tsx core/hooks/install-git-hook.ts <项目名或仓库根路径> [--config <path>] [--uninstall]");

// —— 定位项目条目 ——
const configPath = resolve(ROOT, configArg ?? "core/hooks/hook-projects.json");
const config = JSON.parse(readFileSync(configPath, "utf-8").replace(/^﻿/, "")) as {
	projects: HookProject[];
};
const project =
	config.projects.find((p) => p.name === target) ??
	config.projects.find((p) => normPath(p.root) === normPath(target));
if (!project) fail(`${target} 不在 ${configPath} 注册表中（先添加条目再安装）`);
if (project.vcs !== "git") fail(`${project.name} 的 vcs 是 "${project.vcs}"，本安装器只处理 git`);

// —— 定位 hooks 目录（rev-parse 兼容 worktree / 自定义 hooksPath） ——
const rp = spawnSync("git", ["-C", project.root, "rev-parse", "--git-path", "hooks"], {
	encoding: "utf-8",
});
if (rp.status !== 0) fail(`${project.root} 不是 git 仓库：${(rp.stderr ?? "").trim()}`);
const hooksRel = rp.stdout.trim();
const hooksDir = isAbsolute(hooksRel) ? hooksRel : join(project.root, hooksRel);
const hookPath = join(hooksDir, "post-commit");

// —— 卸载 ——
if (uninstall) {
	if (!existsSync(hookPath)) fail(`${hookPath} 不存在，无需卸载`);
	if (!readFileSync(hookPath, "utf-8").includes(MARKER)) fail(`${hookPath} 非本工具生成，拒绝删除`);
	rmSync(hookPath);
	console.log(`已卸载 ${hookPath}`);
	process.exit(0);
}

// —— 生成脚本（sh + LF；grep 快筛后写临时清单、后台调 runner，提交零等待） ——
if (existsSync(hookPath) && !readFileSync(hookPath, "utf-8").includes(MARKER)) {
	fail(`${hookPath} 已存在且非本工具生成，拒绝覆盖（请手工合并或先移走既有 hook）`);
}
const gbRoot = ROOT.replaceAll("\\", "/");
const extPattern = project.trigger_extensions
	.map((e) => e.replace(/^\./, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
	.join("|");
const configLine = configArg ? ` --config "${resolve(ROOT, configArg).replaceAll("\\", "/")}"` : "";
const script = `#!/bin/sh
${MARKER} — 由 GraphBrain core/hooks/install-git-hook.ts 生成，勿手改（重装即覆盖）
# 提交触及 ${project.trigger_extensions.join("/")} 时后台触发图谱增量更新 + 标注陈旧扫描。
# 失败静默（后台执行、退出码被忽略，日志见 ${gbRoot}/logs/hook.log），绝不阻塞提交。
GB_ROOT="${gbRoot}"
# -m --first-parent：merge 提交默认 diff-tree 无输出，会漏掉合入分支触及的文件。
FILES="$(git diff-tree --no-commit-id --name-only -r -m --first-parent HEAD 2>/dev/null)"
printf '%s\\n' "$FILES" | grep -qiE '\\.(${extPattern})$' || exit 0
TMP="$GB_ROOT/logs/hook-files.$$.txt"
printf '%s\\n' "$FILES" > "$TMP" 2>/dev/null || exit 0
( cd "$GB_ROOT" && node node_modules/tsx/dist/cli.mjs core/hooks/post-commit-update.ts --project "${project.root}" --files-from "$TMP"${configLine} > /dev/null 2>> logs/hook.log & )
exit 0
`;
writeFileSync(hookPath, script, "utf-8");
try {
	chmodSync(hookPath, 0o755);
} catch {
	/* Windows 无 exec 位，git-bash 不依赖它 */
}
console.log(`已安装 ${hookPath}`);
console.log(`  触发扩展名: ${project.trigger_extensions.join(", ")}`);
console.log(`  runner: ${gbRoot}/core/hooks/post-commit-update.ts（日志 ${gbRoot}/logs/hook.log）`);
