import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	access,
	cp,
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { recoverStaleFileLock } from "../store/file-lock.js";
import {
	RELEASE_FORMAT_VERSION,
	RELEASE_RUNTIME_PROTOCOL,
	assertDeploymentRevision,
	assertReleaseId,
	buildReleaseArtifactFingerprintPayload,
	normalizeDeploymentState,
	normalizeReleaseManifest,
	type DeploymentStateV1,
	type ReleaseManifest,
	type ReleaseManifestV3,
	type ReleaseOrigin,
} from "./deployment-contract.js";

export interface DeploymentPaths {
	runtimeRoot: string;
	releaseRoot: string;
	stateFile: string;
	lockFile: string;
}

export function resolveDeploymentPaths(projectRoot: string): DeploymentPaths {
	const runtimeRoot = resolve(projectRoot, "runtime");
	return {
		runtimeRoot,
		releaseRoot: join(runtimeRoot, "releases"),
		stateFile: join(runtimeRoot, "deployment-state.json"),
		lockFile: join(runtimeRoot, "deployment.lock"),
	};
}

export function resolveReleaseDirectory(releaseRoot: string, releaseId: string): string {
	assertReleaseId(releaseId);
	const root = resolve(releaseRoot);
	const target = resolve(root, releaseId);
	if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("release path 越过 release root");
	return target;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function listFiles(directory: string, base = directory): Promise<Array<{ absolute: string; relative: string }>> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files: Array<{ absolute: string; relative: string }> = [];
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
		const absolute = join(directory, entry.name);
		if (entry.isSymbolicLink()) throw new Error(`release artifact 不允许符号链接：${relative(base, absolute)}`);
		if (entry.isDirectory()) files.push(...await listFiles(absolute, base));
		else if (entry.isFile()) files.push({ absolute, relative: relative(base, absolute).replaceAll("\\", "/") });
		else throw new Error(`release artifact 包含不支持的文件类型：${relative(base, absolute)}`);
	}
	return files;
}

export async function hashReleaseArtifact(distDirectory: string): Promise<string> {
	const info = await stat(distDirectory);
	if (!info.isDirectory()) throw new Error(`release dist 不是目录：${distDirectory}`);
	const files = await listFiles(distDirectory);
	if (!files.some((file) => file.relative === "index.html")) throw new Error("release dist 缺少 index.html");
	const hash = createHash("sha256");
	for (const file of files) {
		const contents = await readFile(file.absolute);
		hash.update(`${file.relative.length}:${file.relative}:${contents.byteLength}:`);
		hash.update(contents);
	}
	return hash.digest("hex");
}

export async function hashReleaseFile(file: string): Promise<string> {
	const info = await lstat(file);
	if (!info.isFile() || info.isSymbolicLink()) throw new Error(`release executable 必须是普通文件：${file}`);
	return createHash("sha256").update(await readFile(file)).digest("hex");
}

function releaseArtifactSha256(
	formatVersion: 2 | typeof RELEASE_FORMAT_VERSION,
	frontendSha256: string,
	serverSha256: string,
	bootstrapSha256: string,
): string {
	return createHash("sha256")
		.update(buildReleaseArtifactFingerprintPayload(formatVersion, frontendSha256, serverSha256, bootstrapSha256))
		.digest("hex");
}

export async function readDeploymentState(stateFile: string): Promise<DeploymentStateV1 | null> {
	if (!await pathExists(stateFile)) return null;
	return normalizeDeploymentState(JSON.parse(await readFile(stateFile, "utf8")) as unknown);
}

export async function writeDeploymentState(
	stateFile: string,
	state: DeploymentStateV1,
	expectedRevision: number | null,
): Promise<void> {
	const normalized = normalizeDeploymentState(state);
	const current = await readDeploymentState(stateFile);
	if (expectedRevision === null) {
		if (current !== null) throw new Error("deployment state 已存在，拒绝覆盖初始状态");
	} else {
		if (!current) throw new Error("deployment state 已被删除，拒绝写入");
		assertDeploymentRevision(current, expectedRevision);
	}
	await mkdir(dirname(stateFile), { recursive: true });
	const temporary = `${stateFile}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
		await rename(temporary, stateFile);
	} finally {
		await rm(temporary, { force: true });
	}
}

function parseDeploymentLock(content: string): { pid: number; started_at: string } | null {
	try {
		const value = JSON.parse(content) as { pid: number; started_at: string };
		return Number.isSafeInteger(value.pid) && typeof value.started_at === "string"
			? { pid: Number(value.pid), started_at: value.started_at }
			: null;
	} catch {
		return null;
	}
}

export async function acquireDeploymentLock<T>(lockFile: string, operation: () => Promise<T>): Promise<T> {
	await mkdir(dirname(lockFile), { recursive: true });
	let lock;
	for (let attempt = 0; ; attempt += 1) {
		try {
			lock = await open(lockFile, "wx");
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			// 与共享文件锁一致的陈旧恢复：死进程或超时锁可被接管，崩溃后不再永久残留。
			if (attempt === 0 && recoverStaleFileLock(lockFile, 10 * 60 * 1000, parseDeploymentLock, (reason) => {
				console.warn(`[deployment] recovered stale deployment lock (${reason})`);
			})) continue;
			throw new Error(`已有部署操作进行中：${lockFile}`);
		}
	}
	try {
		await lock.writeFile(`${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`);
	} catch (error) {
		await lock.close();
		await rm(lockFile, { force: true });
		throw error;
	}
	try {
		return await operation();
	} finally {
		await lock.close();
		// 归属校验：仅当锁仍属本进程才删除，避免被接管后误删后继持有者。
		try {
			const record = parseDeploymentLock(await readFile(lockFile, "utf8"));
			if (record && record.pid === process.pid) await rm(lockFile, { force: true });
		} catch {
			/* 锁已被接管/移除：不再干预 */
		}
	}
}

export async function publishRelease(
	sourceDist: string,
	sourceServer: string,
	sourceBootstrap: string,
	releaseRoot: string,
	origin: ReleaseOrigin,
	createdAt: string,
): Promise<ReleaseManifestV3> {
	const frontendSha256 = await hashReleaseArtifact(sourceDist);
	const serverSha256 = await hashReleaseFile(sourceServer);
	const bootstrapSha256 = await hashReleaseFile(sourceBootstrap);
	const artifactSha256 = releaseArtifactSha256(RELEASE_FORMAT_VERSION, frontendSha256, serverSha256, bootstrapSha256);
	const prefix = origin === "legacy-dist" ? "legacy" : "release";
	const releaseId = `${prefix}-${artifactSha256}`;
	const releaseDirectory = resolveReleaseDirectory(releaseRoot, releaseId);
	const manifest: ReleaseManifestV3 = {
		format_version: RELEASE_FORMAT_VERSION,
		runtime_protocol: RELEASE_RUNTIME_PROTOCOL,
		release_id: releaseId,
		artifact_sha256: artifactSha256,
		frontend_sha256: frontendSha256,
		server_sha256: serverSha256,
		bootstrap_sha256: bootstrapSha256,
		origin,
		created_at: createdAt,
	};
	if (await pathExists(releaseDirectory)) {
		const existing = (await validatePublishedRelease(releaseRoot, releaseId, true)).manifest;
		if (existing.format_version !== RELEASE_FORMAT_VERSION) throw new Error(`${releaseId} 与旧 release 格式发生 ID 冲突`);
		return existing;
	}
	await mkdir(releaseRoot, { recursive: true });
	const staging = join(releaseRoot, `.staging-${process.pid}-${randomUUID()}`);
	try {
		await cp(sourceDist, join(staging, "dist"), { recursive: true, errorOnExist: true });
		await cp(sourceServer, join(staging, "server.mjs"), { errorOnExist: true });
		await cp(sourceBootstrap, join(staging, "bootstrap.mjs"), { errorOnExist: true });
		await writeFile(join(staging, "release.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
		await rename(staging, releaseDirectory);
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
	return manifest;
}

export async function validatePublishedRelease(
	releaseRoot: string,
	releaseId: string,
	verifyArtifact = true,
): Promise<{ manifest: ReleaseManifest; distDirectory: string; serverFile: string | null; bootstrapFile: string | null }> {
	const releaseDirectory = resolveReleaseDirectory(releaseRoot, releaseId);
	const manifest = normalizeReleaseManifest(JSON.parse(await readFile(join(releaseDirectory, "release.json"), "utf8")) as unknown);
	if (manifest.release_id !== releaseId) throw new Error("release 目录与 manifest ID 不一致");
	const distDirectory = join(releaseDirectory, "dist");
	const executable = manifest.format_version === 2 || manifest.format_version === RELEASE_FORMAT_VERSION;
	const serverFile = executable ? join(releaseDirectory, "server.mjs") : null;
	const bootstrapFile = executable ? join(releaseDirectory, "bootstrap.mjs") : null;
	if (verifyArtifact && manifest.format_version === 1) {
		const frontendSha256 = await hashReleaseArtifact(distDirectory);
		if (frontendSha256 !== manifest.artifact_sha256) throw new Error(`release artifact 校验失败：${releaseId}`);
	} else if (verifyArtifact && executable && serverFile && bootstrapFile) {
		const frontendSha256 = await hashReleaseArtifact(distDirectory);
		const serverSha256 = await hashReleaseFile(serverFile);
		const bootstrapSha256 = await hashReleaseFile(bootstrapFile);
		const artifactSha256 = releaseArtifactSha256(manifest.format_version as 2 | typeof RELEASE_FORMAT_VERSION, frontendSha256, serverSha256, bootstrapSha256);
		if (frontendSha256 !== manifest.frontend_sha256
			|| serverSha256 !== manifest.server_sha256
			|| bootstrapSha256 !== manifest.bootstrap_sha256
			|| artifactSha256 !== manifest.artifact_sha256) {
			throw new Error(`release artifact 校验失败：${releaseId}`);
		}
	}
	return { manifest, distDirectory, serverFile, bootstrapFile };
}

export function referencedReleaseIds(state: DeploymentStateV1): Set<string> {
	return new Set([state.current_release, state.previous_release, state.prepared_release].filter((id): id is string => id !== null));
}

export async function pruneUnreferencedReleases(releaseRoot: string, retained: ReadonlySet<string>): Promise<string[]> {
	if (!await pathExists(releaseRoot)) return [];
	const removed: string[] = [];
	for (const entry of await readdir(releaseRoot, { withFileTypes: true })) {
		if (!entry.isDirectory() || retained.has(entry.name)) continue;
		try {
			assertReleaseId(entry.name);
			await validatePublishedRelease(releaseRoot, entry.name, false);
		} catch {
			// Unknown/staging/corrupt directories require explicit review; never prune them implicitly.
			continue;
		}
		await rm(resolveReleaseDirectory(releaseRoot, entry.name), { recursive: true, force: true });
		removed.push(entry.name);
	}
	return removed.sort();
}
