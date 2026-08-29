// Graph Brain / tests - smoke 聚合门禁（npm run smoke，check 链末端）
// 默认启动当前 viewer/dist 的隔离生产预览；显式 GB_SMOKE_BASE 保留对已发布服务的验证路径。
// 无浏览器环境的逃生口只有 GB_SMOKE_SKIP=1，跳过绝不静默假绿。

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preview, type PreviewServer } from "vite";
import { resolveSmokeOutputDirectory } from "./smoke-artifacts.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_INDEX = resolve(ROOT, "viewer", "dist", "index.html");
const TSX_CLI = resolve(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const CHILD_TIMEOUT_MS = 10 * 60 * 1000;
const OUTPUT_DIRECTORY = resolveSmokeOutputDirectory("all");

const SMOKES = [
	"tests/visual-smoke.ts",
	"tests/interface-readability-smoke.ts",
	"tests/runtime-health-smoke.ts",
	"tests/change-scale-smoke.ts",
	"tests/interactive-smoke.ts",
	"tests/resource-budget-smoke.ts",
	"tests/production-route-budget-smoke.ts",
	"tests/motion-smoke.ts",
	"tests/bootstrap-recovery-smoke.ts",
];

if (process.env.GB_SMOKE_SKIP === "1") {
	console.log("[smoke] GB_SMOKE_SKIP=1：跳过浏览器冒烟（显式 opt-out）");
	process.exit(0);
}

function newestMtime(target: string): number {
	if (!existsSync(target)) return 0;
	const stat = statSync(target);
	if (!stat.isDirectory()) return stat.mtimeMs;
	let newest = stat.mtimeMs;
	for (const entry of readdirSync(target, { withFileTypes: true })) {
		newest = Math.max(newest, newestMtime(resolve(target, entry.name)));
	}
	return newest;
}

function assertCurrentBuild(): void {
	if (!existsSync(DIST_INDEX)) throw new Error("当前生产构建不存在；请先运行 npm run build");
	const buildInputs = [
		resolve(ROOT, "viewer", "src"),
		resolve(ROOT, "viewer", "components"),
		resolve(ROOT, "viewer", "styles"),
		resolve(ROOT, "viewer", "public"),
		resolve(ROOT, "viewer", "index.html"),
		resolve(ROOT, "core"),
		resolve(ROOT, "vite.config.ts"),
		resolve(ROOT, "package.json"),
		resolve(ROOT, "package-lock.json"),
	];
	const newestInput = Math.max(...buildInputs.map(newestMtime));
	if (statSync(DIST_INDEX).mtimeMs + 1_000 < newestInput) {
		throw new Error("viewer/dist 早于当前前端源码；请先运行 npm run build，避免误测旧构建");
	}
}

async function reservePort(): Promise<number> {
	return await new Promise<number>((resolvePort, rejectPort) => {
		const probe = createServer();
		probe.once("error", rejectPort);
		probe.listen(0, "127.0.0.1", () => {
			const address = probe.address();
			if (!address || typeof address === "string") {
				probe.close();
				rejectPort(new Error("无法分配本地预览端口"));
				return;
			}
			probe.close((error) => error ? rejectPort(error) : resolvePort(address.port));
		});
	});
}

async function waitForApi(base: string): Promise<void> {
	const deadline = Date.now() + 20_000;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${base}/api/graph-catalog`, { signal: AbortSignal.timeout(2_000) });
			if (response.ok) return;
			lastError = new Error(`HTTP ${response.status}`);
		} catch (error) {
			lastError = error;
		}
		await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 100));
	}
	throw new Error(`GraphBrain 冒烟目标不可用：${base}（${String(lastError ?? "超时")}）`);
}

function stopChild(child: ChildProcess): void {
	if (child.exitCode !== null || child.signalCode !== null) return;
	if (process.platform === "win32" && child.pid) {
		spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
	} else child.kill("SIGKILL");
}

async function runSmoke(script: string, base: string): Promise<boolean> {
	return await new Promise<boolean>((resolveRun) => {
		const child = spawn(process.execPath, [TSX_CLI, script], {
			cwd: ROOT,
			stdio: "inherit",
			windowsHide: true,
			env: { ...process.env, GB_SMOKE_BASE: base, GB_SMOKE_OUTPUT_DIR: OUTPUT_DIRECTORY, GRAPH_BRAIN_NO_WATCHER: "1" },
		});
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			stopChild(child);
		}, CHILD_TIMEOUT_MS);
		timer.unref();
		child.once("error", (error) => {
			clearTimeout(timer);
			console.error(`[smoke] ${script} 启动失败：${error.message}`);
			resolveRun(false);
		});
		child.once("exit", (code) => {
			clearTimeout(timer);
			if (timedOut) console.error(`[smoke] ${script} 超过 ${CHILD_TIMEOUT_MS / 60_000} 分钟，已终止`);
			resolveRun(!timedOut && code === 0);
		});
	});
}

let localPreview: PreviewServer | null = null;
try {
	mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
	console.log(`[smoke] 运行产物：${OUTPUT_DIRECTORY}`);
	const configuredBase = process.env.GB_SMOKE_BASE?.trim();
	let base: string;
	if (configuredBase) {
		base = configuredBase.replace(/\/$/, "");
		console.log(`[smoke] 验证显式目标 ${base}`);
	} else {
		assertCurrentBuild();
		const port = await reservePort();
		base = `http://127.0.0.1:${port}`;
		localPreview = await preview({
			configFile: resolve(ROOT, "vite.config.ts"),
			logLevel: "silent",
			preview: { host: "127.0.0.1", port, strictPort: true },
		});
		console.log(`[smoke] 验证当前生产构建 ${base}`);
	}
	await waitForApi(base);

	const failed: string[] = [];
	for (const script of SMOKES) {
		if (!await runSmoke(script, base)) failed.push(script);
	}
	if (failed.length > 0) {
		console.error(`\n[smoke] 失败 ${failed.length}/${SMOKES.length}：${failed.join(", ")}`);
		process.exitCode = 1;
	} else {
		console.log(`[smoke] 全部通过（${SMOKES.length} 项）`);
	}
} finally {
	await localPreview?.close();
}
