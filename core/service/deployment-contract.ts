// Graph Brain / service - versioned resident-service deployment contract.
//
// Ownership boundary:
// - this module owns release/deployment identities and state transitions;
// - filesystem/process/NSSM concerns stay in the operational adapters under tools/;
// - the launcher and deployment CLI both consume this same contract.

export const DEPLOYMENT_FORMAT_VERSION = 1 as const;
export const RELEASE_FORMAT_VERSION = 3 as const;
export const RELEASE_RUNTIME_PROTOCOL = 1 as const;

export type ReleaseOrigin = "candidate-build" | "legacy-dist";

export interface ReleaseManifestV1 {
	format_version: 1;
	release_id: string;
	artifact_sha256: string;
	origin: ReleaseOrigin;
	created_at: string;
}

export interface ReleaseManifestV2 {
	format_version: 2;
	release_id: string;
	artifact_sha256: string;
	frontend_sha256: string;
	server_sha256: string;
	bootstrap_sha256: string;
	origin: ReleaseOrigin;
	created_at: string;
}

export interface ReleaseManifestV3 {
	format_version: typeof RELEASE_FORMAT_VERSION;
	runtime_protocol: typeof RELEASE_RUNTIME_PROTOCOL;
	release_id: string;
	artifact_sha256: string;
	frontend_sha256: string;
	server_sha256: string;
	bootstrap_sha256: string;
	origin: ReleaseOrigin;
	created_at: string;
}

export type ReleaseManifest = ReleaseManifestV1 | ReleaseManifestV2 | ReleaseManifestV3;

export interface DeploymentStateV1 {
	format_version: typeof DEPLOYMENT_FORMAT_VERSION;
	revision: number;
	current_release: string | null;
	previous_release: string | null;
	prepared_release: string | null;
	updated_at: string;
}

const RELEASE_ID_PATTERN = /^(?:release|legacy)-[a-f0-9]{64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertIsoTimestamp(value: unknown, field: string): asserts value is string {
	if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
		throw new Error(`${field} 必须是 ISO 时间字符串`);
	}
}

export function assertReleaseId(value: unknown, field = "release_id"): asserts value is string {
	if (typeof value !== "string" || !RELEASE_ID_PATTERN.test(value)) {
		throw new Error(`${field} 不是合法的 GraphBrain release ID`);
	}
}

function normalizeOptionalReleaseId(value: unknown, field: string): string | null {
	if (value === null) return null;
	assertReleaseId(value, field);
	return value;
}

function normalizeReleaseIdentity(value: Record<string, unknown>): {
	releaseId: string;
	artifactSha256: string;
	origin: ReleaseOrigin;
	createdAt: string;
} {
	assertReleaseId(value.release_id);
	if (typeof value.artifact_sha256 !== "string" || !SHA256_PATTERN.test(value.artifact_sha256)) {
		throw new Error("artifact_sha256 必须是 64 位小写 SHA-256");
	}
	if (value.release_id.split("-")[1] !== value.artifact_sha256) {
		throw new Error("release_id 与 artifact_sha256 不一致");
	}
	if (value.origin !== "candidate-build" && value.origin !== "legacy-dist") {
		throw new Error("release manifest origin 非法");
	}
	const expectedPrefix = value.origin === "legacy-dist" ? "legacy-" : "release-";
	if (!value.release_id.startsWith(expectedPrefix)) throw new Error("release manifest origin 与 release_id 前缀不一致");
	assertIsoTimestamp(value.created_at, "created_at");
	return {
		releaseId: value.release_id,
		artifactSha256: value.artifact_sha256,
		origin: value.origin,
		createdAt: value.created_at,
	};
}

function readSha256(value: unknown, field: string): string {
	if (typeof value !== "string" || !SHA256_PATTERN.test(value)) throw new Error(`${field} 必须是 64 位小写 SHA-256`);
	return value;
}

export function normalizeReleaseManifest(value: unknown): ReleaseManifest {
	if (!isRecord(value)) throw new Error("release manifest 必须是对象");
	if (value.format_version !== 1 && value.format_version !== 2 && value.format_version !== RELEASE_FORMAT_VERSION) {
		throw new Error(`不支持的 release manifest format_version：${String(value.format_version)}`);
	}
	const identity = normalizeReleaseIdentity(value);
	if (value.format_version === 1) return {
		format_version: 1,
		release_id: identity.releaseId,
		artifact_sha256: identity.artifactSha256,
		origin: identity.origin,
		created_at: identity.createdAt,
	};
	const executable = {
		release_id: identity.releaseId,
		artifact_sha256: identity.artifactSha256,
		frontend_sha256: readSha256(value.frontend_sha256, "frontend_sha256"),
		server_sha256: readSha256(value.server_sha256, "server_sha256"),
		bootstrap_sha256: readSha256(value.bootstrap_sha256, "bootstrap_sha256"),
		origin: identity.origin,
		created_at: identity.createdAt,
	};
	if (value.format_version === 2) return { format_version: 2, ...executable };
	if (value.runtime_protocol !== RELEASE_RUNTIME_PROTOCOL) throw new Error(`不支持的 release runtime_protocol：${String(value.runtime_protocol)}`);
	return { format_version: RELEASE_FORMAT_VERSION, runtime_protocol: RELEASE_RUNTIME_PROTOCOL, ...executable };
}

export function buildReleaseArtifactFingerprintPayload(
	formatVersion: 2 | typeof RELEASE_FORMAT_VERSION,
	frontendSha256: string,
	serverSha256: string,
	bootstrapSha256: string,
): string {
	for (const [field, value] of [["frontend", frontendSha256], ["server", serverSha256], ["bootstrap", bootstrapSha256]] as const) {
		readSha256(value, `${field}_sha256`);
	}
	// Imported lazily by the store for the actual SHA-256. This pure payload is
	// the canonical, versioned component ordering.
	const protocol = formatVersion === RELEASE_FORMAT_VERSION ? `v3:runtime-protocol:${RELEASE_RUNTIME_PROTOCOL}` : "v2";
	return `${protocol}:frontend:${frontendSha256}:server:${serverSha256}:bootstrap:${bootstrapSha256}`;
}

export function normalizeDeploymentState(value: unknown): DeploymentStateV1 {
	if (!isRecord(value)) throw new Error("deployment state 必须是对象");
	if (value.format_version !== DEPLOYMENT_FORMAT_VERSION) {
		throw new Error(`不支持的 deployment state format_version：${String(value.format_version)}`);
	}
	if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) {
		throw new Error("deployment state revision 必须是非负安全整数");
	}
	const current = normalizeOptionalReleaseId(value.current_release, "current_release");
	const previous = normalizeOptionalReleaseId(value.previous_release, "previous_release");
	const prepared = normalizeOptionalReleaseId(value.prepared_release, "prepared_release");
	if (current !== null && current === previous) throw new Error("current_release 与 previous_release 不得相同");
	assertIsoTimestamp(value.updated_at, "updated_at");
	return {
		format_version: DEPLOYMENT_FORMAT_VERSION,
		revision: Number(value.revision),
		current_release: current,
		previous_release: previous,
		prepared_release: prepared,
		updated_at: value.updated_at,
	};
}

export function createDeploymentState(currentRelease: string | null, updatedAt: string): DeploymentStateV1 {
	if (currentRelease !== null) assertReleaseId(currentRelease, "current_release");
	assertIsoTimestamp(updatedAt, "updated_at");
	return {
		format_version: DEPLOYMENT_FORMAT_VERSION,
		revision: 0,
		current_release: currentRelease,
		previous_release: null,
		prepared_release: null,
		updated_at: updatedAt,
	};
}

export function prepareRelease(state: DeploymentStateV1, releaseId: string, updatedAt: string): DeploymentStateV1 {
	assertReleaseId(releaseId);
	assertIsoTimestamp(updatedAt, "updated_at");
	return {
		...state,
		revision: state.revision + 1,
		prepared_release: releaseId === state.current_release ? null : releaseId,
		updated_at: updatedAt,
	};
}

export function activatePreparedRelease(state: DeploymentStateV1, updatedAt: string): DeploymentStateV1 {
	if (!state.prepared_release) throw new Error("没有已验收的 prepared release");
	assertIsoTimestamp(updatedAt, "updated_at");
	return {
		...state,
		revision: state.revision + 1,
		current_release: state.prepared_release,
		previous_release: state.current_release,
		prepared_release: null,
		updated_at: updatedAt,
	};
}

export function rollbackDeployment(state: DeploymentStateV1, updatedAt: string): DeploymentStateV1 {
	if (!state.previous_release) throw new Error("没有可回滚的 previous release");
	assertIsoTimestamp(updatedAt, "updated_at");
	return {
		...state,
		revision: state.revision + 1,
		current_release: state.previous_release,
		previous_release: state.current_release,
		updated_at: updatedAt,
	};
}

export function recoverDeploymentState(
	failedState: DeploymentStateV1,
	lastKnownGood: DeploymentStateV1,
	updatedAt: string,
): DeploymentStateV1 {
	assertIsoTimestamp(updatedAt, "updated_at");
	return {
		...lastKnownGood,
		revision: failedState.revision + 1,
		updated_at: updatedAt,
	};
}

export function migrateDeploymentReleaseIds(
	state: DeploymentStateV1,
	replacements: ReadonlyMap<string, string>,
	updatedAt: string,
): DeploymentStateV1 {
	if (replacements.size === 0) return state;
	assertIsoTimestamp(updatedAt, "updated_at");
	for (const [from, to] of replacements) {
		assertReleaseId(from, "legacy release ID");
		assertReleaseId(to, "migrated release ID");
	}
	const replace = (releaseId: string | null) => releaseId ? replacements.get(releaseId) ?? releaseId : null;
	return {
		...state,
		revision: state.revision + 1,
		current_release: replace(state.current_release),
		previous_release: replace(state.previous_release),
		prepared_release: replace(state.prepared_release),
		updated_at: updatedAt,
	};
}

export function assertDeploymentRevision(actual: DeploymentStateV1, expectedRevision: number): void {
	if (actual.revision !== expectedRevision) {
		throw new Error(`deployment state 冲突：期望 revision ${expectedRevision}，实际 ${actual.revision}`);
	}
}
