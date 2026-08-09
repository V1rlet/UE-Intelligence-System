import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDeploymentState, prepareRelease } from "../core/service/deployment-contract.js";
import {
	hashReleaseArtifact,
	publishRelease,
	pruneUnreferencedReleases,
	readDeploymentState,
	resolveDeploymentPaths,
	validatePublishedRelease,
	writeDeploymentState,
} from "../core/service/deployment-store.js";

const NOW = "2026-08-09T12:00:00.000Z";

test("legacy dist is copied into an immutable, content-addressed release", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "graphbrain-deploy-store-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const dist = join(root, "dist");
	const server = join(root, "server.mjs");
	const bootstrap = join(root, "bootstrap.mjs");
	await mkdir(join(dist, "assets"), { recursive: true });
	await writeFile(join(dist, "index.html"), "<main>stable</main>");
	await writeFile(join(dist, "assets", "app.js"), "console.log('stable')");
	await writeFile(server, "console.log('server')");
	await writeFile(bootstrap, "import './server.mjs'");

	const digest = await hashReleaseArtifact(dist);
	const paths = resolveDeploymentPaths(root);
	const manifest = await publishRelease(dist, server, bootstrap, paths.releaseRoot, "legacy-dist", NOW);
	assert.equal(manifest.format_version, 3);
	assert.equal(manifest.runtime_protocol, 1);
	assert.equal(manifest.frontend_sha256, digest);
	assert.match(manifest.release_id, /^legacy-[a-f0-9]{64}$/);
	await writeFile(join(dist, "index.html"), "<main>changed later</main>");
	const published = await validatePublishedRelease(paths.releaseRoot, manifest.release_id, true);
	assert.equal(await readFile(join(published.distDirectory, "index.html"), "utf8"), "<main>stable</main>");
});

test("deployment state writes enforce optimistic revision conflicts", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "graphbrain-deploy-state-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const paths = resolveDeploymentPaths(root);
	const id = `release-${"a".repeat(64)}`;
	const initial = createDeploymentState(null, NOW);
	await writeDeploymentState(paths.stateFile, initial, null);
	const next = prepareRelease(initial, id, NOW);
	await writeDeploymentState(paths.stateFile, next, 0);
	assert.equal((await readDeploymentState(paths.stateFile))?.prepared_release, id);
	await assert.rejects(() => writeDeploymentState(paths.stateFile, { ...next, revision: 2 }, 0), /冲突/);
});

test("published release validation detects artifact mutation", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "graphbrain-deploy-corrupt-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const dist = join(root, "dist");
	const server = join(root, "server.mjs");
	const bootstrap = join(root, "bootstrap.mjs");
	await mkdir(dist);
	await writeFile(join(dist, "index.html"), "ok");
	await writeFile(server, "console.log('server')");
	await writeFile(bootstrap, "console.log('bootstrap')");
	const paths = resolveDeploymentPaths(root);
	const manifest = await publishRelease(dist, server, bootstrap, paths.releaseRoot, "candidate-build", NOW);
	const published = await validatePublishedRelease(paths.releaseRoot, manifest.release_id);
	await writeFile(published.serverFile!, "tampered");
	await assert.rejects(() => validatePublishedRelease(paths.releaseRoot, manifest.release_id), /校验失败/);
});

test("release cleanup removes only validated unreferenced artifacts", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "graphbrain-deploy-prune-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const dist = join(root, "dist");
	const server = join(root, "server.mjs");
	const bootstrap = join(root, "bootstrap.mjs");
	await mkdir(dist);
	await writeFile(join(dist, "index.html"), "ok");
	await writeFile(server, "server");
	await writeFile(bootstrap, "bootstrap");
	const paths = resolveDeploymentPaths(root);
	const manifest = await publishRelease(dist, server, bootstrap, paths.releaseRoot, "candidate-build", NOW);
	await mkdir(join(paths.releaseRoot, "manual-review"));
	const removed = await pruneUnreferencedReleases(paths.releaseRoot, new Set());
	assert.deepEqual(removed, [manifest.release_id]);
	assert.deepEqual(await readdir(paths.releaseRoot), ["manual-review"]);
});
