// Graph Brain / core/hooks - Lore 轮询 watcher（P4U4）：Lore 项目的 "post-commit" 等价物
//
// 用法（CLI，供测试/排障；常驻形态由 vite.config.ts 的 dataApiPlugin 启动）：
//   npx tsx core/hooks/lore-watcher.ts --once [--config <path>] [--state <path>]
//   npx tsx core/hooks/lore-watcher.ts [--interval 30] [--config <path>] [--state <path>]
//
// 机制：轮询各 Lore 项目本地仓库的头签名（lore history 1），与状态文件比对；
// 变化时沿 Parent 链逐修订收集 delta 文件清单（lore revision info <sig> --delta），
// 写临时清单后调 runner（post-commit-update.ts，负责扩展名过滤/锁/增量提取/陈旧扫描）。
// commit 是本地动作，轮询本地头签名即等价 post-commit；push 与否不影响检测。
//
// DECISION: 生产形态由 release-server 内嵌启动（A2，修 F-B：生产提交此前永不自动刷新）；
//         vite dev 形态维持 canonical 端口独占启动。两种形态并存安全由 runner 的
//         hook.lock busy-skip 保证；GRAPH_BRAIN_NO_WATCHER=1 是部署验收/排障的显式逃生阀。
//         打包宿主经 { baseRoot } 把路径锚回项目工作树（esbuild 并入 server.mjs 后
//         import.meta.url 派生路径会漂移到 release 目录）。
// DATE: 2026-07-06（2026-08-23 A2 改写：dev 独占 → dev/生产双形态内嵌）

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HOOKS_ROOT as ROOT, log, runLoreAsync, runTsxAsync, setHooksRootBase } from "./hook-lib.js";
import { renameDurableSync, writeFsyncedTemporary } from "../store/durable-write.js";

const DEFAULT_STATE_PATH = join(ROOT, "logs", "lore-watch-state.json");
const DEFAULT_INTERVAL_S = 30;
/** 单次追赶最多回溯的修订数（防状态文件丢失后无界回溯；超出按"清单未知"全跑） */
const MAX_WALK = 50;

interface HookProject {
	name: string;
	root: string;
	vcs: string;
}

export interface LoreWatcherOptions {
	configPath?: string;
	statePath?: string;
	intervalS?: number;
	/** 打包宿主（release-server）的路径锚点：config/state/logs/runner 全部相对此目录。
	 *  缺省 = 本仓库工作树（dev 与 CLI 形态不变）。 */
	baseRoot?: string;
}

// ████████████████████████████████████████████████████████████████████████████
//  Lore 输出解析
// ████████████████████████████████████████████████████████████████████████████

/** lore_exe（模块级，checkLoreProjectsOnce 每轮从配置刷新） */
let loreExe: string | undefined;

function parseField(text: string, field: string): string | null {
	const m = text.match(new RegExp(`^${field}\\s*:\\s*(\\S+)`, "m"));
	return m ? m[1] : null;
}

/** 头修订签名（本地分支最新）；仓库不可用返回 null */
async function headSignature(repoRoot: string): Promise<{ sig: string; rev: string } | null> {
	const out = await runLoreAsync(repoRoot, ["history", "1"], loreExe);
	if (!out) return null;
	const sig = parseField(out, "Signature");
	const rev = parseField(out, "Revision") ?? "?";
	return sig ? { sig, rev } : null;
}

/** 单修订信息：delta 文件清单 + 父签名（消息行缩进 4 空格，不会撞 ^[AMD] 前缀） */
async function revisionDelta(repoRoot: string, sig: string): Promise<{ files: string[]; parent: string | null } | null> {
	const out = await runLoreAsync(repoRoot, ["revision", "info", sig, "--delta"], loreExe);
	if (!out) return null;
	const files: string[] = [];
	for (const line of out.split(/\r?\n/)) {
		const m = line.match(/^([AMD]) (.+?)\s*$/);
		if (m) files.push(m[2]);
	}
	return { files, parent: parseField(out, "Parent") };
}

// ████████████████████████████████████████████████████████████████████████████
//  状态文件与单轮检查
// ████████████████████████████████████████████████████████████████████████████

function loadState(statePath: string): Record<string, string> {
	if (!existsSync(statePath)) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(statePath, "utf-8").replace(/^﻿/, ""));
	} catch (error) {
		// 损坏的状态文件绝不能静默当作 {}：那会把所有项目重置到当前头（"首轮不触发"），
		// 中间修订被永久跳过。抛错让本轮失败、磁盘现状保留，等待人工处理。
		throw new Error(`lore-watch state is not valid JSON (${statePath}): ${(error as Error).message}`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`lore-watch state has an unexpected shape (${statePath})`);
	}
	const state: Record<string, string> = {};
	for (const [name, signature] of Object.entries(parsed as Record<string, unknown>)) {
		if (typeof signature !== "string") throw new Error(`lore-watch state entry "${name}" is invalid (${statePath})`);
		state[name] = signature;
	}
	return state;
}

function saveState(statePath: string, state: Record<string, string>): void {
	// 常驻 watcher 与 --once CLI 并发时直接覆盖写会产生撕裂读取；temp+rename 保持
	// 状态文件要么是旧内容、要么是完整新内容。
	mkdirSync(dirname(statePath), { recursive: true });
	const temporary = `${statePath}.tmp-${process.pid}-${Date.now()}`;
	try {
		writeFsyncedTemporary(temporary, `${JSON.stringify(state, null, 2)}\n`);
		renameDurableSync(temporary, statePath);
	} finally {
		rmSync(temporary, { force: true });
	}
}

/** 检查一个 Lore 项目；有新修订则收集清单并触发 runner。返回是否触发。 */
async function checkProject(
	project: HookProject,
	state: Record<string, string>,
	configPath: string | undefined,
	baseRoot: string,
): Promise<boolean> {
	const head = await headSignature(project.root);
	if (!head) return false; // runLoreAsync 已记日志

	const last = state[project.name];
	if (!last) {
		state[project.name] = head.sig;
		log(`${project.name}: watcher 基线 = 修订 ${head.rev}（${head.sig.slice(0, 12)}…），首轮不触发`);
		return false;
	}
	if (last === head.sig) return false; // 无新修订：保持安静，不刷日志

	// —— 沿 Parent 链收集 last(不含) → head(含) 的 delta 并集 ——
	const files = new Set<string>();
	let sig: string | null = head.sig;
	let walked = 0;
	let reachedLast = false;
	while (sig && walked < MAX_WALK) {
		if (sig === last) {
			reachedLast = true;
			break;
		}
		const info = await revisionDelta(project.root, sig);
		if (!info) break; // 解析失败：带着已收集的清单继续，宁可多触发
		for (const f of info.files) files.add(f);
		sig = info.parent;
		walked++;
	}

	const fileArgs: string[] = [];
	let tmp: string | null = null;
	if (reachedLast || sig === null) {
		// 清单完整：写临时文件传给 runner（runner 读后即删）
		tmp = join(baseRoot, "logs", `hook-files.watcher-${process.pid}-${Date.now()}.txt`);
		writeFileSync(tmp, [...files].join("\n") + "\n", "utf8");
		fileArgs.push("--files-from", tmp);
	} else {
		// 回溯不完整（超 MAX_WALK / 中途失败）：不传清单 = runner 按"未知"全跑增量
		log(`${project.name}: 回溯 ${walked} 个修订未及基线，按未知清单全跑`);
	}

	log(`${project.name}: 检测到新修订 ${head.rev}（${walked} 个修订，${files.size} 个路径），触发 runner`);
	try {
		// runner 自己写 hook.log，正常路径不回显（失败才整块进日志）；
		// 异步 spawn——watcher 宿主是常驻服务，同步等待会冻结整个事件循环。
		// GRAPH_BRAIN_HOOK_RUNNER 允许部署验收/测试注入替身 runner（默认仍是
		// post-commit-update.ts；生产形态不得设置该变量）。
		const code = await runTsxAsync(
			process.env.GRAPH_BRAIN_HOOK_RUNNER ?? "core/hooks/post-commit-update.ts",
			["--project", project.root, ...fileArgs, ...(configPath ? ["--config", configPath] : [])],
			"on-error",
		);
		if (code !== 0) {
			// 提取/发布失败：不推进基线，下轮轮询重试（与 git post-commit"失败下次提交重试"一致）。
			log(`${project.name}: runner 失败（exit ${code}），基线保留 ${last}，下轮重试`);
			return true;
		}
	} finally {
		if (tmp) rmSync(tmp, { force: true }); // runner 正常会自删，这里兜底
	}
	state[project.name] = head.sig;
	return true;
}

/** 单轮：检查配置里所有 vcs=lore 的项目（供 --once 与定时器共用） */
export async function checkLoreProjectsOnce(options: LoreWatcherOptions = {}): Promise<void> {
	const baseRoot = resolve(options.baseRoot ?? ROOT);
	if (baseRoot !== ROOT) setHooksRootBase(baseRoot); // 打包宿主：日志/runner 锚回项目工作树
	const configPath = resolve(baseRoot, options.configPath ?? "core/hooks/hook-projects.json");
	const statePath = resolve(baseRoot, options.statePath ?? DEFAULT_STATE_PATH);
	const config = JSON.parse(readFileSync(configPath, "utf-8").replace(/^﻿/, "")) as {
		lore_exe?: string;
		projects: HookProject[];
	};
	loreExe = config.lore_exe;
	const loreProjects = config.projects.filter((p) => p.vcs === "lore");
	if (loreProjects.length === 0) return;

	const state = loadState(statePath);
	let dirty = false;
	for (const project of loreProjects) {
		const before = state[project.name];
		try {
			await checkProject(project, state, options.configPath, baseRoot);
		} catch (e) {
			log(`${project.name}: watcher 异常: ${(e as Error).message}`);
		}
		if (state[project.name] !== before) dirty = true;
	}
	if (dirty) saveState(statePath, state);
}

interface LoreWatcherHandles {
	interval: ReturnType<typeof setInterval>;
	initialTick: ReturnType<typeof setTimeout>;
}

/** 拆除本进程的轮询定时器与尚未触发的首跳（vite 配置热重启不换进程：非 canonical
 *  实例重载时必须显式清掉上一次加载遗留的定时器，否则旧 watcher 会一直空转/抢锁；
 *  不取消挂起的首跳会让 stop 后 3 秒仍执行一整轮轮询） */
export function stopLoreWatcher(): void {
	const g = globalThis as { __graphBrainLoreWatcher?: LoreWatcherHandles };
	if (g.__graphBrainLoreWatcher) {
		clearInterval(g.__graphBrainLoreWatcher.interval);
		clearTimeout(g.__graphBrainLoreWatcher.initialTick);
		g.__graphBrainLoreWatcher = undefined;
		log(`lore-watcher 停止（宿主 pid ${process.pid}）`);
	}
}

/** 常驻轮询（vite.config.ts 调用）；重复调用会先撤掉旧定时器（vite 配置热重启场景） */
export function startLoreWatcher(options: LoreWatcherOptions = {}): void {
	const g = globalThis as { __graphBrainLoreWatcher?: LoreWatcherHandles };
	const isHotReload = !!g.__graphBrainLoreWatcher;
	if (g.__graphBrainLoreWatcher) {
		clearInterval(g.__graphBrainLoreWatcher.interval);
		clearTimeout(g.__graphBrainLoreWatcher.initialTick);
	}
	// intervalS 可能来自 CLI Number(...)：NaN/0 会把 setInterval 压成 1ms 轮询风暴。
	const requestedSeconds = options.intervalS ?? DEFAULT_INTERVAL_S;
	const intervalS = Number.isFinite(requestedSeconds) && requestedSeconds >= 1 ? requestedSeconds : DEFAULT_INTERVAL_S;
	const intervalMs = intervalS * 1000;
	let busy = false;
	const tick = async () => {
		if (busy) return; // 上一轮增量提取还没跑完：跳过本轮
		busy = true;
		try {
			await checkLoreProjectsOnce(options);
		} catch (e) {
			log(`lore-watcher 轮询异常: ${(e as Error).message}`);
		} finally {
			busy = false;
		}
	};
	const interval = setInterval(() => { void tick(); }, intervalMs);
	interval.unref?.(); // 不阻止宿主进程退出
	const initialTick = setTimeout(() => { void tick(); }, 3000); // 启动后先跑一轮（延迟避开宿主启动高峰）
	initialTick.unref?.();
	g.__graphBrainLoreWatcher = { interval, initialTick };
	// vite 配置热重启会反复调用本函数（同进程换定时器）：只有全新启动才进 hook.log，
	// 热重载降为 stdout，免得重启刷屏淹没真正的提取记录
	const startMsg = `lore-watcher 启动：每 ${intervalMs / 1000}s 轮询（宿主 pid ${process.pid}）`;
	if (isHotReload) console.log(`[${new Date().toISOString()}] ${startMsg}（配置热重载）`);
	else log(startMsg);
}

// ████████████████████████████████████████████████████████████████████████████
//  CLI 入口（被 import 时不执行）
// ████████████████████████████████████████████████████████████████████████████

const isMain =
	process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
	const argv = process.argv.slice(2);
	const options: LoreWatcherOptions = {};
	let once = false;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--once") once = true;
		else if (argv[i] === "--interval") {
			const value = Number(argv[++i]);
			if (Number.isFinite(value) && value >= 1) options.intervalS = value;
			else log(`--interval 值非法（${argv[i]}），使用默认 ${DEFAULT_INTERVAL_S}s`);
		}
		else if (argv[i] === "--config") options.configPath = argv[++i];
		else if (argv[i] === "--state") options.statePath = argv[++i];
	}
	if (once) {
		try {
			await checkLoreProjectsOnce(options);
		} catch (e) {
			log(`lore-watcher --once 异常: ${(e as Error).message}`);
		}
		process.exitCode = 0;
	} else {
		startLoreWatcher(options);
		// 前台常驻：定时器已 unref，需显式挂住进程
		setInterval(() => {}, 1 << 30);
	}
}
