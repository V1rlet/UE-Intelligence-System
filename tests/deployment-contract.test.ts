import assert from "node:assert/strict";
import test from "node:test";
import {
	activatePreparedRelease,
	assertDeploymentRevision,
	createDeploymentState,
	migrateDeploymentReleaseIds,
	normalizeDeploymentState,
	normalizeReleaseManifest,
	prepareRelease,
	recoverDeploymentState,
	rollbackDeployment,
} from "../core/service/deployment-contract.js";

const NOW = "2026-08-09T12:00:00.000Z";
const NEXT = "2026-08-09T12:01:00.000Z";
const A = `legacy-${"a".repeat(64)}`;
const B = `release-${"b".repeat(64)}`;

test("deployment state follows prepare, activate and reversible rollback transitions", () => {
	const initial = createDeploymentState(A, NOW);
	const prepared = prepareRelease(initial, B, NEXT);
	assert.equal(prepared.revision, 1);
	assert.equal(prepared.current_release, A);
	assert.equal(prepared.prepared_release, B);

	const active = activatePreparedRelease(prepared, NEXT);
	assert.equal(active.revision, 2);
	assert.equal(active.current_release, B);
	assert.equal(active.previous_release, A);
	assert.equal(active.prepared_release, null);

	const rolledBack = rollbackDeployment(active, NEXT);
	assert.equal(rolledBack.current_release, A);
	assert.equal(rolledBack.previous_release, B);
	const recovered = recoverDeploymentState(rolledBack, active, NEXT);
	assert.equal(recovered.current_release, B);
	assert.equal(recovered.revision, 4);
});

test("deployment normalization rejects unversioned state and traversal IDs", () => {
	assert.throws(() => normalizeDeploymentState({ revision: 0 }), /format_version/);
	assert.throws(() => normalizeDeploymentState({
		format_version: 1,
		revision: 0,
		current_release: "../viewer/dist",
		previous_release: null,
		prepared_release: null,
		updated_at: NOW,
	}), /release ID/);
});

test("release manifest binds its ID to the artifact digest", () => {
	const manifest = normalizeReleaseManifest({
		format_version: 1,
		release_id: B,
		artifact_sha256: "b".repeat(64),
		origin: "candidate-build",
		created_at: NOW,
	});
	assert.equal(manifest.release_id, B);
	assert.throws(() => normalizeReleaseManifest({ ...manifest, artifact_sha256: "c".repeat(64) }), /不一致/);
	assert.throws(() => normalizeReleaseManifest({ ...manifest, origin: "legacy-dist" }), /前缀不一致/);
});

test("release v2 explicitly binds frontend, server and bootstrap hashes", () => {
	const manifest = normalizeReleaseManifest({
		format_version: 2,
		release_id: B,
		artifact_sha256: "b".repeat(64),
		frontend_sha256: "c".repeat(64),
		server_sha256: "d".repeat(64),
		bootstrap_sha256: "e".repeat(64),
		origin: "candidate-build",
		created_at: NOW,
	});
	assert.equal(manifest.format_version, 2);
	assert.equal(manifest.server_sha256, "d".repeat(64));
	assert.throws(() => normalizeReleaseManifest({ ...manifest, bootstrap_sha256: null }), /bootstrap_sha256/);
});

test("current release v3 requires an explicit runtime protocol", () => {
	const base = {
		format_version: 3,
		runtime_protocol: 1,
		release_id: B,
		artifact_sha256: "b".repeat(64),
		frontend_sha256: "c".repeat(64),
		server_sha256: "d".repeat(64),
		bootstrap_sha256: "e".repeat(64),
		origin: "candidate-build",
		created_at: NOW,
	};
	const manifest = normalizeReleaseManifest(base);
	assert.equal(manifest.format_version, 3);
	assert.throws(() => normalizeReleaseManifest({ ...base, runtime_protocol: 2 }), /runtime_protocol/);
});

test("revision guard rejects stale deployment writers", () => {
	const state = createDeploymentState(A, NOW);
	assert.doesNotThrow(() => assertDeploymentRevision(state, 0));
	assert.throws(() => assertDeploymentRevision(state, 1), /冲突/);
});

test("v1 release ID migration updates every state pointer in one revision", () => {
	const state = { ...createDeploymentState(A, NOW), prepared_release: B };
	const migratedA = `legacy-${"c".repeat(64)}`;
	const migratedB = `release-${"d".repeat(64)}`;
	const migrated = migrateDeploymentReleaseIds(state, new Map([[A, migratedA], [B, migratedB]]), NEXT);
	assert.equal(migrated.current_release, migratedA);
	assert.equal(migrated.prepared_release, migratedB);
	assert.equal(migrated.revision, 1);
});
