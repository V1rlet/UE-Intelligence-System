// Thin annotation projection over the canonical versioned reading-context document.
import { randomUUID } from "node:crypto";
import {
	loadReadingContext,
	mutateReadingContext,
	type AnnotationType,
	type ReadingAnnotation as Annotation,
	type ReadingContextDocument,
} from "../reading-context/store.js";

export type { Annotation, AnnotationType };

export interface AnnotationEntry {
	node_id: string;
	domain: string;
	annotations: Annotation[];
}

export interface AnnotationDocument {
	revision: number;
	updated_at: string;
	entries: AnnotationEntry[];
}

export interface AnnotationWriteResult extends AnnotationDocument {
	document: ReadingContextDocument;
}

function assertCodeDomain(domain: string): void {
	if (domain !== "ue5_code") throw new Error(`GraphBrain 标注只接受 ue5_code，实际为 ${domain}`);
}

function project(document: ReadingContextDocument, subsystem: string): AnnotationDocument {
	return {
		revision: document.revision,
		updated_at: document.updated_at,
		entries: document.annotations
			.filter((entry) => entry.subsystem === subsystem)
			.map((entry) => ({ node_id: entry.node_id, domain: document.domain, annotations: structuredClone(entry.annotations) })),
	};
}

function result(document: ReadingContextDocument, subsystem: string): AnnotationWriteResult {
	return { ...project(document, subsystem), document };
}

function newAnnotationId(): string {
	return `ann_${randomUUID().slice(0, 12)}`;
}

export function loadAnnotationDocument(domain: string, subsystem: string): AnnotationDocument {
	assertCodeDomain(domain);
	return project(loadReadingContext(domain), subsystem);
}

export function loadAnnotations(domain: string, subsystem: string): AnnotationEntry[] {
	return loadAnnotationDocument(domain, subsystem).entries;
}

/** Whole-subsystem replacement for staleness scans. A caller must supply the revision it read. */
export function saveAnnotations(
	domain: string,
	subsystem: string,
	entries: AnnotationEntry[],
	expectedRevision: number,
): AnnotationWriteResult {
	const document = mutateReadingContext(domain, expectedRevision, (draft) => {
		draft.annotations = draft.annotations.filter((entry) => entry.subsystem !== subsystem);
		for (const entry of entries) {
			if (entry.annotations.length === 0) continue;
			draft.annotations.push({ subsystem, node_id: entry.node_id, annotations: structuredClone(entry.annotations) });
		}
	});
	return result(document, subsystem);
}

export function addAnnotation(
	domain: string,
	subsystem: string,
	nodeId: string,
	input: { type: AnnotationType; content: string; source_hash?: string },
	expectedRevision: number,
): AnnotationWriteResult {
	if (!input.content?.trim()) throw new Error("标注内容不能为空");
	const document = mutateReadingContext(domain, expectedRevision, (draft) => {
		let entry = draft.annotations.find((item) => item.subsystem === subsystem && item.node_id === nodeId);
		if (!entry) {
			entry = { subsystem, node_id: nodeId, annotations: [] };
			draft.annotations.push(entry);
		}
		entry.annotations.push({
			id: newAnnotationId(),
			type: input.type,
			content: input.content.trim(),
			created_at: new Date().toISOString(),
			...(input.source_hash ? { source_hash: input.source_hash } : {}),
		});
	});
	return result(document, subsystem);
}

export function updateAnnotation(
	domain: string,
	subsystem: string,
	nodeId: string,
	annId: string,
	patch: { type?: AnnotationType; content?: string; source_hash?: string; stale?: boolean },
	expectedRevision: number,
): AnnotationWriteResult {
	const document = mutateReadingContext(domain, expectedRevision, (draft) => {
		const annotation = draft.annotations
			.find((entry) => entry.subsystem === subsystem && entry.node_id === nodeId)
			?.annotations.find((item) => item.id === annId);
		if (!annotation) throw new Error(`标注不存在: ${nodeId} / ${annId}`);
		if (patch.type) annotation.type = patch.type;
		if (patch.content !== undefined) {
			if (!patch.content.trim()) throw new Error("标注内容不能为空");
			annotation.content = patch.content.trim();
		}
		if (patch.source_hash !== undefined) annotation.source_hash = patch.source_hash;
		if (patch.stale !== undefined) {
			if (patch.stale) annotation.stale = true;
			else delete annotation.stale;
		}
		annotation.updated_at = new Date().toISOString();
	});
	return result(document, subsystem);
}

export function deleteAnnotation(
	domain: string,
	subsystem: string,
	nodeId: string,
	annId: string,
	expectedRevision: number,
): AnnotationWriteResult {
	const document = mutateReadingContext(domain, expectedRevision, (draft) => {
		const entry = draft.annotations.find((item) => item.subsystem === subsystem && item.node_id === nodeId);
		if (!entry) throw new Error(`节点无标注: ${nodeId}`);
		const remaining = entry.annotations.filter((annotation) => annotation.id !== annId);
		if (remaining.length === entry.annotations.length) throw new Error(`标注不存在: ${nodeId} / ${annId}`);
		entry.annotations = remaining;
	});
	return result(document, subsystem);
}
