// Graph Brain / core/annotation - 标注读写模块：与 graph JSON 分离存储于 data/annotations/
//
// DECISION: 标注文件按 {domain}_{subsystem}_annotations.json 分片，与图谱文件同粒度
// REASON: Adapter 重新生成图谱不触碰标注文件（分离存储原则）；同粒度分片让
//         查看器加载某张图时只需读一份标注文件，也便于 P4U3 按文件做陈旧检测。
// DATE: 2026-07-02
//
// 写入前用 core/schema/annotation.schema.json 做结构校验，坏数据直接抛错拒写，
// 保证 data/annotations/ 下的文件永远可通过 validate.ts。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

export type AnnotationType = "gotcha" | "best_practice" | "design_decision" | "performance" | "reference";

export interface Annotation {
	id: string;
	type: AnnotationType;
	content: string;
	created_at: string;
	source_hash?: string;
	stale?: boolean;
}

export interface AnnotationEntry {
	node_id: string;
	domain: string;
	annotations: Annotation[];
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ANNOTATION_DIR = join(ROOT, "data", "annotations");
const SCHEMA_PATH = join(ROOT, "core", "schema", "annotation.schema.json");

// ████████████████████████████████████████████████████████████████████████████
//  内部辅助：schema 校验器（懒加载）、id 生成、读写
// ████████████████████████████████████████████████████████████████████████████

let validator: ValidateFunction | null = null;

function getValidator(): ValidateFunction {
	if (!validator) {
		const ajv = new Ajv({ allErrors: true });
		(addFormats.default ?? (addFormats as unknown as (a: Ajv) => void))(ajv);
		validator = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, "utf-8")));
	}
	return validator;
}

function newAnnotationId(): string {
	return `ann_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function annotationFilePath(domain: string, subsystem: string): string {
	return join(ANNOTATION_DIR, `${domain}_${subsystem}_annotations.json`);
}

function save(domain: string, subsystem: string, entries: AnnotationEntry[]): void {
	const validate = getValidator();
	if (!validate(entries)) {
		const msgs = (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join("; ");
		throw new Error(`标注数据不符合 schema，拒绝写入: ${msgs}`);
	}
	mkdirSync(ANNOTATION_DIR, { recursive: true });
	writeFileSync(annotationFilePath(domain, subsystem), JSON.stringify(entries, null, 2) + "\n", "utf-8");
}

// ████████████████████████████████████████████████████████████████████████████
//  公共接口：加载 / 新增 / 更新 / 删除（均返回该文件的完整条目数组）
// ████████████████████████████████████████████████████████████████████████████

export function loadAnnotations(domain: string, subsystem: string): AnnotationEntry[] {
	const path = annotationFilePath(domain, subsystem);
	if (!existsSync(path)) return [];
	return JSON.parse(readFileSync(path, "utf-8").replace(/^﻿/, "")) as AnnotationEntry[];
}

export function addAnnotation(
	domain: string,
	subsystem: string,
	nodeId: string,
	input: { type: AnnotationType; content: string; source_hash?: string },
): AnnotationEntry[] {
	if (!input.content?.trim()) throw new Error("标注内容不能为空");
	const entries = loadAnnotations(domain, subsystem);
	let entry = entries.find((e) => e.node_id === nodeId);
	if (!entry) {
		entry = { node_id: nodeId, domain, annotations: [] };
		entries.push(entry);
	}
	entry.annotations.push({
		id: newAnnotationId(),
		type: input.type,
		content: input.content.trim(),
		created_at: new Date().toISOString(),
		...(input.source_hash ? { source_hash: input.source_hash } : {}),
	});
	save(domain, subsystem, entries);
	return entries;
}

export function updateAnnotation(
	domain: string,
	subsystem: string,
	nodeId: string,
	annId: string,
	patch: { type?: AnnotationType; content?: string },
): AnnotationEntry[] {
	const entries = loadAnnotations(domain, subsystem);
	const ann = entries.find((e) => e.node_id === nodeId)?.annotations.find((a) => a.id === annId);
	if (!ann) throw new Error(`标注不存在: ${nodeId} / ${annId}`);
	if (patch.type) ann.type = patch.type;
	if (patch.content !== undefined) {
		if (!patch.content.trim()) throw new Error("标注内容不能为空");
		ann.content = patch.content.trim();
	}
	save(domain, subsystem, entries);
	return entries;
}

export function deleteAnnotation(
	domain: string,
	subsystem: string,
	nodeId: string,
	annId: string,
): AnnotationEntry[] {
	const entries = loadAnnotations(domain, subsystem);
	const entry = entries.find((e) => e.node_id === nodeId);
	if (!entry) throw new Error(`节点无标注: ${nodeId}`);
	entry.annotations = entry.annotations.filter((a) => a.id !== annId);
	// 节点最后一条标注删掉后，整个条目一并移除，避免文件里堆空壳
	const remaining = entry.annotations.length > 0 ? entries : entries.filter((e) => e.node_id !== nodeId);
	save(domain, subsystem, remaining);
	return remaining;
}
