// Graph Brain / service - safe release preparation, NSSM activation and rollback.
//
// Old-content plan:
// - the first prepare copies the existing viewer/dist into a content-addressed
//   legacy release before any candidate is built;
// - the installed service is only switched after the candidate passes an
//   isolated-port HTTP + browser runtime gate;
// - activation failures restore both the versioned state and the previous NSSM
//   launcher configuration.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as bundle } from "esbuild";
import {
	activatePreparedRelease,
	createDeploymentState,
	migrateDeploymentReleaseIds,
	RELEASE_FORMAT_VERSION,
	prepareRelease,
	recoverDeploymentState,
	rollbackDeployment,
	type DeploymentStateV1,
} from "../core/service/deployment-contract.js";
import {
	acquireDeploymentLock,
	publishRelease,
	pruneUnreferencedReleases,
	readDeploymentState,
	referencedReleaseIds,
	resolveDeploymentPaths,
	resolveReleaseDirectory,
	validatePublishedRelease,
	writeDeploymentState,
} from "../core/service/deployment-store.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const paths = resolveDeploymentPaths(ROOT);
const VIEWER_DIST = resolve(ROOT, "viewer", "dist");
const VITE_CLI = resolve(ROOT, "node_modules", "vite", "bin", "vite.js");
const TSX_CLI = resolve(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const SERVICE_LAUNCHER = resolve(ROOT, "scripts", "service-launcher.ts");
const RELEASE_SERVER = resolve(ROOT, "scripts", "release-server.ts");
const SERVICE_NAME = "graph-brain-viewer";

type Command = "prepare" | "activate" | "rollback" | "status";

function now(): string {
	return new Date().toISOString();
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

function run(command: string, args: string[], options: { env?: NodeJS.ProcessEnv; allowFailure?: boolean } = {}): string {
	const result = spawnSync(command, args, {
		cwd: ROOT,
		env: options.env ?? process.env,
		encoding: "utf8",
		windowsHide: true,
	});
	if (result.error) {
		if (options.allowFailure) return "";
		throw result.error;
	}
	if (result.status !== 0 && !options.allowFailure) {
		throw new Error(`${command} ${args.join(" ")} 失败（${result.status}）：${result.stderr || result.stdout}`);
	}
	return String(result.stdout ?? "").trim();
}

function runVisible(command: string, args: string[], env = process.env): void {
	const result = spawnSync(command, args, { cwd: ROOT, env, stdio: "inherit", windowsHide: true });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} 失败（${result.status}）`);
}

async function buildOperationalArtifacts(stagingRoot: string): Promise<{ serverFile: string; bootstrapFile: string }> {
	const serverFile = join(stagingRoot, "server.mjs");
	const bootstrapFile = join(stagingRoot, "bootstrap.mjs");
	const common = {
		bundle: true,
		platform: "node" as const,
		format: "esm" as const,
		target: "node22",
		legalComments: "none" as const,
		logLevel: "warning" as const,
	};
	await bundle({ ...common, entryPoints: [RELEASE_SERVER], outfile: serverFile });
	await bundle({ ...common, entryPoints: [SERVICE_LAUNCHER], outfile: bootstrapFile });
	return { serverFile, bootstrapFile };
}

async function createInitialState(serverFile: string, bootstrapFile: string): Promise<DeploymentStateV1> {
	const existing = await readDeploymentState(paths.stateFile);
	if (existing) return existing;
	let legacyRelease: string | null = null;
	if (await exists(join(VIEWER_DIST, "index.html"))) {
		const legacy = await publishRelease(VIEWER_DIST, serverFile, bootstrapFile, paths.releaseRoot, "legacy-dist", now());
		legacyRelease = legacy.release_id;
		console.log(`[service-deploy] 已封存当前 viewer/dist：${legacyRelease}`);
	}
	const initial = createDeploymentState(legacyRelease, now());
	await writeDeploymentState(paths.stateFile, initial, null);
	return initial;
}

async function migrateIncompleteReleases(
	state: DeploymentStateV1,
	serverFile: string,
	bootstrapFile: string,
): Promise<DeploymentStateV1> {
	const migrated = new Map<string, string>();
	for (const releaseId of referencedReleaseIds(state)) {
		const published = await validatePublishedRelease(paths.releaseRoot, releaseId, true);
		if (published.manifest.format_version === RELEASE_FORMAT_VERSION) continue;
		const replacement = await publishRelease(
			published.distDirectory,
			serverFile,
			bootstrapFile,
			paths.releaseRoot,
			published.manifest.origin,
			published.manifest.created_at,
		);
		migrated.set(releaseId, replacement.release_id);
	}
	if (migrated.size === 0) return state;
	const next = migrateDeploymentReleaseIds(state, migrated, now());
	await writeDeploymentState(paths.stateFile, next, state.revision);
	console.log(`[service-deploy] 已将 ${migrated.size} 个旧 release 确定性迁移为完整 v${RELEASE_FORMAT_VERSION} runtime release`);
	return next;
}

async function findCandidatePort(): Promise<number> {
	for (let port = 31_30; port <= 31_99; port += 1) {
		const available = await new Promise<boolean>((resolveAvailability) => {
			const socket = createServer();
			socket.once("error", () => resolveAvailability(false));
			socket.listen(port, "127.0.0.1", () => socket.close(() => resolveAvailability(true)));
		});
		if (available) return port;
	}
	throw new Error("3130–3199 没有可用的候选验收端口");
}

async function waitForReady(base: string, child: ChildProcess, timeoutMs = 30_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error(`候选服务提前退出：${child.exitCode}`);
		try {
			const response = await fetch(base, { signal: AbortSignal.timeout(1_000) });
			if (response.ok) return;
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
	}
	throw new Error(`候选服务启动超时：${String(lastError ?? "unknown")}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	child.kill("SIGTERM");
	await Promise.race([
		new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
		new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 3_000)),
	]);
	if (child.exitCode === null && child.signalCode === null) child.kill();
}

async function validateCandidate(releaseId: string): Promise<void> {
	const published = await validatePublishedRelease(paths.releaseRoot, releaseId, true);
	if (!published.bootstrapFile) throw new Error(`${releaseId} 缺少 v2 bootstrap`);
	const port = await findCandidatePort();
	const base = `http://127.0.0.1:${port}`;
	const output: string[] = [];
	const child = spawn(process.execPath, [published.bootstrapFile], {
		cwd: ROOT,
		env: {
			...process.env,
			GB_SERVICE_PORT: String(port),
			GB_SERVICE_RELEASE_OVERRIDE: releaseId,
			GB_SERVICE_LOG_LEVEL: "silent",
			GRAPH_BRAIN_NO_WATCHER: "1",
			GB_PROJECT_ROOT: ROOT,
		},
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
	child.stdout?.on("data", (chunk) => output.push(String(chunk)));
	child.stderr?.on("data", (chunk) => output.push(String(chunk)));
	try {
		await waitForReady(base, child);
		const env = { ...process.env, GB_SMOKE_BASE: base };
		runVisible(process.execPath, [TSX_CLI, "tools/service-health-check.ts", `--base=${base}`], env);
		runVisible(process.execPath, [TSX_CLI, "tests/runtime-health-smoke.ts"], env);
		console.log(`[service-deploy] 候选验收通过：${releaseId} @ ${base}`);
	} catch (error) {
		throw new Error(`${String(error)}\n${output.join("").slice(-4_000)}`);
	} finally {
		await stopChild(child);
	}
}

async function prepareCandidate(): Promise<void> {
	await acquireDeploymentLock(paths.lockFile, async () => {
		await mkdir(paths.runtimeRoot, { recursive: true });
		const stagingRoot = await mkdtemp(join(paths.runtimeRoot, "candidate-"));
		const stagingDist = join(stagingRoot, "dist");
		try {
			const operational = await buildOperationalArtifacts(stagingRoot);
			let state = await createInitialState(operational.serverFile, operational.bootstrapFile);
			state = await migrateIncompleteReleases(state, operational.serverFile, operational.bootstrapFile);
			console.log("[service-deploy] 构建隔离候选包…");
			runVisible(process.execPath, [VITE_CLI, "build", "--outDir", stagingDist, "--emptyOutDir"]);
			const manifest = await publishRelease(
				stagingDist,
				operational.serverFile,
				operational.bootstrapFile,
				paths.releaseRoot,
				"candidate-build",
				now(),
			);
			await validatePublishedRelease(paths.releaseRoot, manifest.release_id, true);
			await validateCandidate(manifest.release_id);
			const latest = await readDeploymentState(paths.stateFile);
			if (!latest) throw new Error("deployment state 在候选验收期间消失");
			state = prepareRelease(latest, manifest.release_id, now());
			await writeDeploymentState(paths.stateFile, state, latest.revision);
			const removed = await pruneUnreferencedReleases(paths.releaseRoot, referencedReleaseIds(state));
			if (removed.length > 0) console.log(`[service-deploy] 已清理 ${removed.length} 个无引用旧 release：${removed.join("、")}`);
			console.log(state.prepared_release
				? `[service-deploy] 已准备 ${state.prepared_release}；使用管理员终端运行 npm run service:activate`
				: `[service-deploy] 候选内容与当前 release 相同，无需切换`);
		} finally {
			await rm(stagingRoot, { recursive: true, force: true });
		}
	});
}

interface NssmSnapshot {
	exists: boolean;
	application?: string;
	parameters?: string;
	directory?: string;
	environment?: string;
}

function nssm(args: string[], allowFailure = false): string {
	return run("nssm", args, { allowFailure });
}

function snapshotNssm(): NssmSnapshot {
	const application = nssm(["get", SERVICE_NAME, "Application"], true);
	if (!application) return { exists: false };
	return {
		exists: true,
		application,
		parameters: nssm(["get", SERVICE_NAME, "AppParameters"], true),
		directory: nssm(["get", SERVICE_NAME, "AppDirectory"], true),
		environment: nssm(["get", SERVICE_NAME, "AppEnvironmentExtra"], true),
	};
}

function assertAdministrator(): void {
	if (process.platform !== "win32") throw new Error("GraphBrain NSSM 服务部署只支持 Windows");
	const check = spawnSync("net", ["session"], { stdio: "ignore", windowsHide: true });
	if (check.status !== 0) throw new Error("服务切换需要管理员终端；候选包仍安全保留在 prepared_release");
}

function stopService(): void {
	nssm(["stop", SERVICE_NAME], true);
}

function startService(): void {
	nssm(["start", SERVICE_NAME]);
}

function configureNssm(snapshot: NssmSnapshot, releaseId: string): void {
	const logs = join(ROOT, "logs");
	const bootstrapFile = join(resolveReleaseDirectory(paths.releaseRoot, releaseId), "bootstrap.mjs");
	if (!snapshot.exists) nssm(["install", SERVICE_NAME, process.execPath]);
	nssm(["set", SERVICE_NAME, "Application", process.execPath]);
	nssm(["set", SERVICE_NAME, "AppParameters", `"${bootstrapFile}"`]);
	nssm(["set", SERVICE_NAME, "AppDirectory", ROOT]);
	nssm(["set", SERVICE_NAME, "DisplayName", "Graph Brain Viewer (localhost:3030)"]);
	nssm(["set", SERVICE_NAME, "Description", "GraphBrain manifest-selected production viewer + data API"]);
	nssm(["set", SERVICE_NAME, "Start", "SERVICE_AUTO_START"]);
	nssm(["set", SERVICE_NAME, "AppEnvironmentExtra", "GRAPH_BRAIN_NO_WATCHER=1", `GB_PROJECT_ROOT=${ROOT}`]);
	nssm(["set", SERVICE_NAME, "AppStdout", join(logs, "stdout.log")]);
	nssm(["set", SERVICE_NAME, "AppStderr", join(logs, "stderr.log")]);
	nssm(["set", SERVICE_NAME, "AppStdoutCreationDisposition", "2"]);
	nssm(["set", SERVICE_NAME, "AppStderrCreationDisposition", "2"]);
	nssm(["set", SERVICE_NAME, "AppRotateFiles", "1"]);
	nssm(["set", SERVICE_NAME, "AppRotateBytes", "1048576"]);
}

function restoreNssm(snapshot: NssmSnapshot): void {
	stopService();
	if (!snapshot.exists) {
		nssm(["remove", SERVICE_NAME, "confirm"], true);
		return;
	}
	if (snapshot.application) nssm(["set", SERVICE_NAME, "Application", snapshot.application]);
	if (snapshot.parameters !== undefined) nssm(["set", SERVICE_NAME, "AppParameters", snapshot.parameters]);
	if (snapshot.directory !== undefined) nssm(["set", SERVICE_NAME, "AppDirectory", snapshot.directory]);
	if (snapshot.environment) nssm(["set", SERVICE_NAME, "AppEnvironmentExtra", ...snapshot.environment.split(/\r?\n/).filter(Boolean)]);
	else nssm(["reset", SERVICE_NAME, "AppEnvironmentExtra"], true);
	startService();
}

async function validateActiveService(): Promise<void> {
	const base = "http://127.0.0.1:3030";
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(base, { signal: AbortSignal.timeout(1_000) });
			if (response.ok) break;
		} catch {
			// The service can take a moment to transition from SERVICE_START_PENDING.
		}
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
	}
	runVisible(process.execPath, [TSX_CLI, "tools/service-health-check.ts", `--base=${base}`], { ...process.env, GB_SMOKE_BASE: base });
}

async function activate(): Promise<void> {
	assertAdministrator();
	await acquireDeploymentLock(paths.lockFile, async () => {
		const before = await readDeploymentState(paths.stateFile);
		if (!before?.prepared_release) throw new Error("没有 prepared_release；先运行 npm run service:prepare");
		const prepared = await validatePublishedRelease(paths.releaseRoot, before.prepared_release, true);
		if (prepared.manifest.format_version !== RELEASE_FORMAT_VERSION || !prepared.bootstrapFile || !prepared.serverFile) {
			throw new Error(`prepared_release 不是完整 v${RELEASE_FORMAT_VERSION} runtime release；请重新运行 service:prepare`);
		}
		const snapshot = snapshotNssm();
		const active = activatePreparedRelease(before, now());
		await mkdir(join(ROOT, "logs"), { recursive: true });
		try {
			stopService();
			configureNssm(snapshot, active.current_release!);
			await writeDeploymentState(paths.stateFile, active, before.revision);
			startService();
			await validateActiveService();
			console.log(`[service-deploy] 已激活 ${active.current_release}；回滚目标 ${active.previous_release ?? "无"}`);
		} catch (error) {
			const current = await readDeploymentState(paths.stateFile);
			if (current?.revision === active.revision) {
				const recovered = recoverDeploymentState(current, before, now());
				await writeDeploymentState(paths.stateFile, recovered, current.revision);
			}
			restoreNssm(snapshot);
			throw new Error(`激活失败，已恢复上一个服务配置：${String(error)}`);
		}
	});
}

async function rollback(): Promise<void> {
	assertAdministrator();
	await acquireDeploymentLock(paths.lockFile, async () => {
		const before = await readDeploymentState(paths.stateFile);
		if (!before) throw new Error("deployment state 不存在");
		const rolledBack = rollbackDeployment(before, now());
		const target = await validatePublishedRelease(paths.releaseRoot, rolledBack.current_release!, true);
		if (target.manifest.format_version !== RELEASE_FORMAT_VERSION || !target.bootstrapFile || !target.serverFile) {
			throw new Error(`previous_release 不是完整 v${RELEASE_FORMAT_VERSION} runtime release，拒绝不完整回滚`);
		}
		const snapshot = snapshotNssm();
		try {
			stopService();
			configureNssm(snapshot, rolledBack.current_release!);
			await writeDeploymentState(paths.stateFile, rolledBack, before.revision);
			startService();
			await validateActiveService();
			console.log(`[service-deploy] 已回滚到 ${rolledBack.current_release}`);
		} catch (error) {
			const current = await readDeploymentState(paths.stateFile);
			if (current?.revision === rolledBack.revision) {
				const recovered = recoverDeploymentState(current, before, now());
				await writeDeploymentState(paths.stateFile, recovered, current.revision);
			}
			restoreNssm(snapshot);
			throw new Error(`回滚切换失败，已恢复原 release：${String(error)}`);
		}
	});
}

async function printStatus(): Promise<void> {
	const state = await readDeploymentState(paths.stateFile);
	if (!state) {
		console.log("[service-deploy] 尚未初始化版本化部署状态");
		return;
	}
	for (const releaseId of referencedReleaseIds(state)) await validatePublishedRelease(paths.releaseRoot, releaseId, false);
	console.log(JSON.stringify(state, null, 2));
	console.log(`[service-deploy] NSSM: ${nssm(["status", SERVICE_NAME], true) || "未安装/不可访问"}`);
}

const command = (process.argv[2] ?? "status") as Command;
if (!["prepare", "activate", "rollback", "status"].includes(command)) {
	throw new Error(`未知命令：${command}；可用 prepare | activate | rollback | status`);
}

if (command === "prepare") await prepareCandidate();
else if (command === "activate") await activate();
else if (command === "rollback") await rollback();
else await printStatus();
