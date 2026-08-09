// Graph Brain / tests - 开发热更新与常驻生产服务的边界契约

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import config from "../vite.config.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("开发查看器使用可提交的稳定依赖缓存，不在每次重启时强制重打", () => {
	const optimizeDeps = config.optimizeDeps;
	assert.ok(optimizeDeps);
	assert.notEqual(optimizeDeps.force, true);
	assert.equal(optimizeDeps.holdUntilCrawlEnd, false);

	const included = new Set(optimizeDeps.include ?? []);
	for (const dependency of [
		"react",
		"react-dom/client",
		"react/jsx-runtime",
		"react/jsx-dev-runtime",
	]) {
		assert.equal(included.has(dependency), true, `首屏依赖必须显式预构建：${dependency}`);
	}
});

test("常驻服务只提供版本化生产 release，并在入口模块失败时保留可恢复界面", () => {
	const packageJson = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
	const installer = readFileSync(resolve(ROOT, "install-service.cmd"), "utf8");
	const launcher = readFileSync(resolve(ROOT, "scripts/service-launcher.ts"), "utf8");
	const releaseServer = readFileSync(resolve(ROOT, "scripts/release-server.ts"), "utf8");
	const deployer = readFileSync(resolve(ROOT, "tools/service-deploy.ts"), "utf8");
	const recovery = readFileSync(resolve(ROOT, "viewer/public/bootstrap-recovery.js"), "utf8");
	const index = readFileSync(resolve(ROOT, "viewer/index.html"), "utf8");
	const embed = readFileSync(resolve(ROOT, "viewer/embed.html"), "utf8");
	assert.equal(packageJson.scripts.serve, "tsx scripts/service-launcher.ts");
	assert.match(installer, /npm run service:prepare/);
	assert.match(installer, /npm run service:activate/);
	assert.doesNotMatch(installer, /AppParameters|vite preview/);
	assert.match(launcher, /readDeploymentState/);
	assert.match(launcher, /validatePublishedRelease/);
	assert.doesNotMatch(launcher, /from "vite"/);
	assert.match(releaseServer, /createApiRouter/);
	assert.match(releaseServer, /GB_PROJECT_ROOT/);
	assert.match(deployer, /legacy-dist/);
	assert.match(deployer, /RELEASE_SERVER/);
	assert.match(deployer, /entryPoints: \[SERVICE_LAUNCHER\]/);
	assert.match(deployer, /runtime-health-smoke\.ts/);
	assert.match(recovery, /vite:preloadError/);
	assert.match(recovery, /GraphBrain 界面资源没有完成加载/);
	assert.match(index, /bootstrap-recovery\.js/);
	assert.match(embed, /bootstrap-recovery\.js/);
});

test("完整检查在生产构建后验证首屏与重型工作区的加载边界", () => {
	const packageJson = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
		scripts: Record<string, string>;
	};
	assert.equal(packageJson.scripts["check:bundle"], "node tools/bundle-boundary-check.mjs");
	// D3（2026-08-07）：smoke 聚合已纳入 check 链末尾——构建产物就绪后再跑浏览器冒烟
	assert.match(packageJson.scripts.check, /npm run build && npm run check:bundle(?: && npm run smoke)?$/);
});

test("文件森林不静态导入只供力导向图使用的 fCoSE", () => {
	const graphView = readFileSync(resolve(ROOT, "viewer/components/graph-view/GraphView.tsx"), "utf8");
	const registration = readFileSync(resolve(ROOT, "viewer/components/graph-view/registerFcose.ts"), "utf8");
	assert.equal(graphView.includes('from "cytoscape-fcose"'), false);
	assert.equal(graphView.includes('import("./registerFcose")'), true);
	assert.equal(registration.includes('from "cytoscape-fcose"'), true);
});

test("浏览器门禁直接调用本地 tsx CLI，不经 shell 拼接参数", () => {
	const runner = readFileSync(resolve(ROOT, "tests/smoke-runner.ts"), "utf8");
	assert.match(runner, /spawnSync\(process\.execPath, \[TSX_CLI, script\]/);
	assert.doesNotMatch(runner, /shell:\s*true|shell:\s*process\.platform/);
});
