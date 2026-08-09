import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { graphCatalogEntries } from "../server/catalog.js";
import { graphProjectionForFile } from "../server/graph-projection.js";
import {
	DataPublicationConflictError,
	loadDataPublicationState,
	managedArtifactName,
	planDataPublicationPrune,
	pruneDataPublication,
	publicationDirectories,
	publishDataGeneration,
	resolveCurrentGraphArtifact,
	rollbackDataPublication,
	sha256,
	validatePublishedArtifacts,
	visiblePublishedFiles,
} from "../core/store/data-publication.js";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "graphbrain-publication-"));
	const directories = publicationDirectories(join(root, "data"));
	mkdirSync(directories.graphs, { recursive: true });
	mkdirSync(directories.changes, { recursive: true });
	return { root, directories };
}

function graphContent(generatedAt: string, marker: string): string {
	return `${JSON.stringify({
		meta: { domain: "ue5_code", subsystem: "project", format_version: 2, generated_at: generatedAt, marker },
		elements: { nodes: [], edges: [] },
	}, null, 2)}\n`;
}

function reportContent(currentFile: string, generatedAt: string): string {
	return `${JSON.stringify({ current: { file: currentFile }, generated_at: generatedAt })}\n`;
}

test("legacy artifacts stay visible while uncommitted managed artifacts stay hidden", (t) => {
	const { root, directories } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const legacyFile = "ue5_code_project_2026-08-08.cyto.json";
	const legacyContent = graphContent("2026-08-08T00:00:00.000Z", "legacy");
	writeFileSync(join(directories.graphs, legacyFile), legacyContent);
	const orphanContent = graphContent("2026-08-09T00:00:00.000Z", "orphan");
	const orphanFile = managedArtifactName("project", sha256(orphanContent), "graph");
	writeFileSync(join(directories.graphs, orphanFile), orphanContent);

	assert.deepEqual(visiblePublishedFiles(directories.graphs, directories.publications, "graph"), [legacyFile]);
	assert.deepEqual(resolveCurrentGraphArtifact(directories, "project"), {
		file: legacyFile,
		path: join(directories.graphs, legacyFile),
		sha256: sha256(legacyContent),
		source: "legacy-catalog",
	});
});

test("one state revision atomically publishes a matching graph and change report", (t) => {
	const { root, directories } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const graph = graphContent("2026-08-09T01:00:00.000Z", "first");
	const graphFile = managedArtifactName("project", sha256(graph), "graph");
	const result = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: 0,
		graphContent: graph,
		changeReportContent: reportContent(graphFile, "2026-08-09T01:00:01.000Z"),
		publishedAt: "2026-08-09T01:00:02.000Z",
	});

	assert.equal(result.state.revision, 1);
	assert.equal(loadDataPublicationState(directories.publications).revision, 1);
	assert.deepEqual(visiblePublishedFiles(directories.graphs, directories.publications, "graph"), [result.generation.graph.file]);
	assert.deepEqual(visiblePublishedFiles(directories.changes, directories.publications, "change_report"), [result.generation.change_report!.file]);
	assert.equal(resolveCurrentGraphArtifact(directories, "project")?.source, "publication-v1");
	assert.deepEqual(validatePublishedArtifacts(directories), []);
	assert.equal(JSON.parse(readFileSync(join(directories.changes, result.generation.change_report!.file), "utf8")).current.file, result.generation.graph.file);
});

test("publication rejects stale writers before creating their artifacts", (t) => {
	const { root, directories } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const first = graphContent("2026-08-09T02:00:00.000Z", "first");
	publishDataGeneration({ directories, subsystem: "project", expectedRevision: 0, graphContent: first });
	const stale = graphContent("2026-08-09T03:00:00.000Z", "stale-writer");
	const staleFile = managedArtifactName("project", sha256(stale), "graph");
	assert.throws(
		() => publishDataGeneration({ directories, subsystem: "project", expectedRevision: 0, graphContent: stale }),
		(error: unknown) => error instanceof DataPublicationConflictError && error.current.revision === 1,
	);
	assert.equal(visiblePublishedFiles(directories.graphs, directories.publications, "graph").includes(staleFile), false);
	assert.equal(readFileSync(join(directories.graphs, managedArtifactName("project", sha256(first), "graph")), "utf8"), first);
});

test("rollback changes only the publication pointer and preserves immutable generations", (t) => {
	const { root, directories } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const first = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: 0,
		graphContent: graphContent("2026-08-09T04:00:00.000Z", "first"),
	});
	const second = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: first.state.revision,
		graphContent: graphContent("2026-08-09T05:00:00.000Z", "second"),
	});
	assert.equal(resolveCurrentGraphArtifact(directories, "project")?.file, second.generation.graph.file);
	const rolledBack = rollbackDataPublication(directories.publications, "project", second.state.revision);
	assert.equal(rolledBack.revision, 3);
	assert.equal(resolveCurrentGraphArtifact(directories, "project")?.file, first.generation.graph.file);
	assert.deepEqual(validatePublishedArtifacts(directories), []);
	assert.equal(visiblePublishedFiles(directories.graphs, directories.publications, "graph").length, 2);
});

test("a staging failure removes newly created graph data and leaves the pointer unchanged", (t) => {
	const { root, directories } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const graph = graphContent("2026-08-09T06:00:00.000Z", "staged");
	const graphFile = managedArtifactName("project", sha256(graph), "graph");
	const report = reportContent(graphFile, "2026-08-09T06:00:01.000Z");
	const reportFile = managedArtifactName("project", sha256(report), "change_report");
	writeFileSync(join(directories.changes, reportFile), "collision");

	assert.throws(() => publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: 0,
		graphContent: graph,
		changeReportContent: report,
	}), /collision/);
	assert.equal(loadDataPublicationState(directories.publications).revision, 0);
	assert.equal(visiblePublishedFiles(directories.graphs, directories.publications, "graph").includes(graphFile), false);
});

test("published artifact tampering is diagnosed instead of silently falling back", (t) => {
	const { root, directories } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const published = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: 0,
		graphContent: graphContent("2026-08-09T07:00:00.000Z", "stable"),
	});
	writeFileSync(join(directories.graphs, published.generation.graph.file), "tampered");
	assert.match(validatePublishedArtifacts(directories).join("\n"), /hash mismatch/);
	assert.throws(() => resolveCurrentGraphArtifact(directories, "project"), /hash mismatch/);
});

test("catalog exposes one active graph per publication-owned subsystem", (t) => {
	const { root, directories } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeFileSync(join(directories.graphs, "ue5_code_project_2026-08-08.cyto.json"), graphContent("2026-08-08T00:00:00.000Z", "legacy"));
	const first = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: 0,
		graphContent: graphContent("2026-08-09T08:00:00.000Z", "first"),
	});
	const second = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: first.state.revision,
		graphContent: graphContent("2026-08-09T09:00:00.000Z", "second"),
	});
	const projectEntries = graphCatalogEntries(directories.graphs).filter((entry) => entry.subsystem === "project");
	assert.deepEqual(projectEntries.map((entry) => entry.file), [second.generation.graph.file]);
});

test("a dead publication lock is recoverable but a live writer is protected", (t) => {
	const { root, directories } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(directories.publications, { recursive: true });
	const lock = join(directories.publications, ".write.lock");
	writeFileSync(lock, JSON.stringify({ pid: 999_999_999, started_at: new Date().toISOString() }));
	const recovered = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: 0,
		graphContent: graphContent("2026-08-09T10:00:00.000Z", "recovered"),
	});
	assert.equal(recovered.state.revision, 1);

	writeFileSync(lock, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
	assert.throws(() => publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: 1,
		graphContent: graphContent("2026-08-09T11:00:00.000Z", "blocked"),
	}), /publication is locked/);
	rmSync(lock, { force: true });
});

test("prune keeps current, rollback and report-referenced generations; deletes only unretained managed files", (t) => {
	const { root, directories } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const firstGraph = graphContent("2026-08-09T12:00:00.000Z", "g1-no-report");
	const first = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: 0,
		graphContent: firstGraph,
	});
	const secondGraph = graphContent("2026-08-09T13:00:00.000Z", "g2-with-report");
	const secondGraphFile = managedArtifactName("project", sha256(secondGraph), "graph");
	const second = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: first.state.revision,
		graphContent: secondGraph,
		changeReportContent: reportContent(secondGraphFile, "2026-08-09T13:00:01.000Z"),
	});
	const thirdGraph = graphContent("2026-08-09T14:00:00.000Z", "g3-with-report");
	const thirdGraphFile = managedArtifactName("project", sha256(thirdGraph), "graph");
	const third = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: second.state.revision,
		graphContent: thirdGraph,
		changeReportContent: reportContent(thirdGraphFile, "2026-08-09T14:00:01.000Z"),
	});
	const plan = planDataPublicationPrune(directories, "project");
	// g3 = current、g2 = rollback target；两者连同报告全部保留。
	for (const file of [third.generation.graph.file, third.generation.change_report!.file, second.generation.graph.file, second.generation.change_report!.file]) {
		assert.ok(plan.retained.includes(file), `${file} should be retained`);
	}
	// g1 无报告且不在 current/rollback 位置 → 其 graph 是唯一可删项。
	assert.deepEqual(plan.deletable, [{
		kind: "graph",
		file: first.generation.graph.file,
		sha256: first.generation.graph.sha256,
		recoverable: false,
	}]);
	assert.equal(plan.revision, third.state.revision);
	// dry-run 不删除任何文件。
	assert.ok(existsSync(join(directories.graphs, first.generation.graph.file)), "dry-run must not remove files");
	const result = pruneDataPublication(directories, "project", plan.revision);
	assert.deepEqual(result.removed, [first.generation.graph.file]);
	assert.equal(existsSync(join(directories.graphs, first.generation.graph.file)), false);
	assert.equal(existsSync(join(directories.graphs, second.generation.graph.file)), true);
	assert.deepEqual(validatePublishedArtifacts(directories), []);
});

test("prune reports legacy, unrecorded and tampered files as manual review without touching them", (t) => {
	const { root, directories } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const legacy = "ue5_code_project_2026-07-02.cyto.json";
	writeFileSync(join(directories.graphs, legacy), graphContent("2026-07-02T00:00:00.000Z", "legacy"));
	const unrecorded = "ue5_code_project__gbtx-deadbeefdeadbeef.cyto.json";
	writeFileSync(join(directories.graphs, unrecorded), graphContent("2026-08-09T15:00:00.000Z", "unrecorded"));
	const firstGraph = graphContent("2026-08-09T16:00:00.000Z", "g1-no-report");
	const first = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: 0,
		graphContent: firstGraph,
	});
	const secondGraph = graphContent("2026-08-09T17:00:00.000Z", "g2-with-report");
	const secondGraphFile = managedArtifactName("project", sha256(secondGraph), "graph");
	const second = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: first.state.revision,
		graphContent: secondGraph,
		changeReportContent: reportContent(secondGraphFile, "2026-08-09T17:00:01.000Z"),
	});
	const thirdGraph = graphContent("2026-08-09T18:00:00.000Z", "g3-with-report");
	const thirdGraphFile = managedArtifactName("project", sha256(thirdGraph), "graph");
	publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: second.state.revision,
		graphContent: thirdGraph,
		changeReportContent: reportContent(thirdGraphFile, "2026-08-09T18:00:01.000Z"),
	});
	// 篡改 g1 的 graph：它已不在保留集，但 SHA 与 state 记录不一致 → 只能人工审查。
	writeFileSync(join(directories.graphs, first.generation.graph.file), graphContent("2026-08-09T19:00:00.000Z", "tampered"));
	const plan = planDataPublicationPrune(directories, "project");
	assert.deepEqual(plan.deletable, []);
	for (const marker of [legacy, unrecorded, first.generation.graph.file]) {
		assert.ok(plan.manualReview.some((note) => note.startsWith(marker)), `${marker} should be flagged for manual review`);
	}
	const result = pruneDataPublication(directories, "project", plan.revision);
	assert.deepEqual(result.removed, []);
	for (const file of [legacy, unrecorded, first.generation.graph.file]) {
		assert.ok(existsSync(join(directories.graphs, file)), `${file} must survive prune`);
	}
});

test("prune rejects a stale revision under concurrent publication", (t) => {
	const { root, directories } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const first = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: 0,
		graphContent: graphContent("2026-08-09T20:00:00.000Z", "first"),
	});
	const plan = planDataPublicationPrune(directories, "project");
	publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: first.state.revision,
		graphContent: graphContent("2026-08-09T21:00:00.000Z", "concurrent-writer"),
	});
	assert.throws(
		() => pruneDataPublication(directories, "project", plan.revision),
		(error: unknown) => error instanceof DataPublicationConflictError && error.current.revision === first.state.revision + 1,
	);
});

test("catalog with 20+ historical generations parses only the active file", (t) => {
	const { root, directories } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	let state = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: 0,
		graphContent: graphContent("2026-08-09T22:00:00.000Z", "gen-00"),
	});
	const historical: string[] = [state.generation.graph.file];
	for (let index = 1; index < 25; index += 1) {
		state = publishDataGeneration({
			directories,
			subsystem: "project",
			expectedRevision: state.state.revision,
			graphContent: graphContent(`2026-08-09T22:${String(index).padStart(2, "0")}:00.000Z`, `gen-${String(index).padStart(2, "0")}`),
		});
		historical.push(state.generation.graph.file);
	}
	assert.equal(historical.length, 25);
	// 历史 generation 文件全部替换为非法 JSON：catalog 若读取/解析它们必然失败。
	for (const file of historical.slice(0, -1)) {
		writeFileSync(join(directories.graphs, file), "{\"broken\":");
	}
	const entries = graphCatalogEntries(directories.graphs);
	assert.equal(entries.length, 1);
	assert.equal(entries[0].file, historical[historical.length - 1]);
	assert.equal(entries[0].subsystem, "project");
});

test("catalog hides an untrusted current artifact instead of silently falling back", (t) => {
	const { root, directories } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const first = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: 0,
		graphContent: graphContent("2026-08-09T23:00:00.000Z", "first"),
	});
	const second = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: first.state.revision,
		graphContent: graphContent("2026-08-09T23:01:00.000Z", "second"),
	});
	writeFileSync(join(directories.graphs, second.generation.graph.file), "tampered");
	const entries = graphCatalogEntries(directories.graphs);
	// current 被篡改 → 隐藏该 subsystem 当前条目；历史 first 不得冒充当前事实。
	assert.deepEqual(entries.filter((entry) => entry.subsystem === "project"), []);
});

test("corrupt publication state fails the catalog explicitly", (t) => {
	const { root, directories } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: 0,
		graphContent: graphContent("2026-08-09T23:02:00.000Z", "published"),
	});
	writeFileSync(join(directories.publications, "ue5_code.json"), "{\"broken\":");
	assert.throws(() => graphCatalogEntries(directories.graphs));
});

test("prune retains generations carrying zero-diff change reports as audit history", (t) => {
	const { root, directories } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const firstGraph = graphContent("2026-08-09T23:05:00.000Z", "g1-no-report");
	const first = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: 0,
		graphContent: firstGraph,
	});
	// 零差异报告：summary 全 0，仍作为审计历史随 generation 保留。
	const zeroDiffReport = (currentFile: string) => `${JSON.stringify({
		format_version: 1,
		domain: "ue5_code",
		subsystem: "project",
		generated_at: "2026-08-09T23:05:01.000Z",
		baseline: { file: currentFile, generated_at: null, fingerprint: null },
		current: { file: currentFile, generated_at: null, fingerprint: null },
		summary: { nodes: { added: 0, removed: 0, changed: 0 }, edges: { added: 0, removed: 0, changed: 0 }, direct_nodes: 0, affected_nodes: 0, affected_modules: 0 },
		impact: { direct_node_ids: [], affected_node_ids: [], changed_fields: {} },
	})}\n`;
	const secondGraph = graphContent("2026-08-09T23:06:00.000Z", "g2-zerodiff");
	const secondGraphFile = managedArtifactName("project", sha256(secondGraph), "graph");
	const second = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: first.state.revision,
		graphContent: secondGraph,
		changeReportContent: zeroDiffReport(secondGraphFile),
	});
	const thirdGraph = graphContent("2026-08-09T23:07:00.000Z", "g3-zerodiff");
	const thirdGraphFile = managedArtifactName("project", sha256(thirdGraph), "graph");
	const third = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: second.state.revision,
		graphContent: thirdGraph,
		changeReportContent: zeroDiffReport(thirdGraphFile),
	});
	const plan = planDataPublicationPrune(directories, "project");
	// 零差异报告所在 generation（g2/g3）不得被清理——审计历史保留策略。
	assert.deepEqual(plan.deletable.map((item) => item.file), [first.generation.graph.file]);
	const result = pruneDataPublication(directories, "project", plan.revision);
	assert.deepEqual(result.removed, [first.generation.graph.file]);
	for (const file of [second.generation.graph.file, second.generation.change_report!.file, third.generation.graph.file, third.generation.change_report!.file]) {
		assert.ok(existsSync(join(directories.graphs, file)) || existsSync(join(directories.changes, file)), `${file} must remain as audit history`);
	}
	assert.deepEqual(validatePublishedArtifacts(directories), []);
});

test("prune never touches managed files of another subsystem", (t) => {
	const { root, directories } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	// project：三个 generation，最旧的（g1）无 report 且不在 current/rollback 位（本应可删）。
	const projectFirst = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: 0,
		graphContent: graphContent("2026-08-09T23:08:00.000Z", "project-old"),
	});
	let state = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: projectFirst.state.revision,
		graphContent: graphContent("2026-08-09T23:09:00.000Z", "project-mid"),
	});
	state = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: state.state.revision,
		graphContent: graphContent("2026-08-09T23:09:30.000Z", "project-current"),
	});
	// reference：另一个 subsystem 的当前 generation（活动产物）。
	const reference = publishDataGeneration({
		directories,
		subsystem: "reference",
		expectedRevision: state.state.revision,
		graphContent: graphContent("2026-08-09T23:10:00.000Z", "reference-current"),
	});
	// 对 project 做 prune：只允许删 project 的旧 generation，reference 的活动文件必须保留。
	const plan = planDataPublicationPrune(directories, "project");
	assert.deepEqual(plan.deletable.map((item) => item.file), [projectFirst.generation.graph.file]);
	assert.equal(plan.deletable.some((item) => item.file.startsWith("ue5_code_reference__gbtx-")), false);
	const result = pruneDataPublication(directories, "project", plan.revision);
	assert.deepEqual(result.removed, [projectFirst.generation.graph.file]);
	// reference 的当前 generation 及其 state 引用完好。
	assert.equal(existsSync(join(directories.graphs, reference.generation.graph.file)), true);
	assert.deepEqual(validatePublishedArtifacts(directories), []);
	// 未删除 reference 文件时其可见性不受影响。
	assert.ok(visiblePublishedFiles(directories.graphs, directories.publications, "graph").includes(reference.generation.graph.file));
});

test("legacy deep links stay compatible with publication filtering", (t) => {	const { root, directories } = fixture();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const legacy = "ue5_code_project_2026-07-02.cyto.json";
	writeFileSync(join(directories.graphs, legacy), graphContent("2026-07-02T00:00:00.000Z", "legacy"));
	const first = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: 0,
		graphContent: graphContent("2026-08-09T23:03:00.000Z", "first"),
	});
	const second = publishDataGeneration({
		directories,
		subsystem: "project",
		expectedRevision: first.state.revision,
		graphContent: graphContent("2026-08-09T23:04:00.000Z", "second"),
	});
	// catalog 只暴露 current：project 已被 publication 接管，legacy 旧图不并列显示。
	const files = graphCatalogEntries(directories.graphs).map((entry) => entry.file).sort();
	assert.deepEqual(files, [second.generation.graph.file]);
	// 旧深链：state 引用内的历史管理文件仍可投影读取，未被 catalog 过滤破坏。
	const historicalProjection = graphProjectionForFile(directories.graphs, first.generation.graph.file);
	assert.equal(historicalProjection?.source.file, first.generation.graph.file);
	// legacy 深链同样可用。
	assert.equal(graphProjectionForFile(directories.graphs, legacy)?.source.file, legacy);
	// 未记录的管理文件深链 → null（不可见），与 publication 边界一致。
	assert.equal(graphProjectionForFile(directories.graphs, "ue5_code_project__gbtx-deadbeefdeadbeef.cyto.json"), null);
});
