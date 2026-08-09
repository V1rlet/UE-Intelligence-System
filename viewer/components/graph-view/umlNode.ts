// Graph Brain / viewer - UML 分栏节点：SVG 背景生成（移植自 Tools/CytoscapeViewer，视觉保持一致）
// 色板已迁入 viewer/src/design-tokens.ts（单一事实源）。

import { UML_KIND_COLORS } from "../../src/design-tokens";

export const KIND_COLORS = UML_KIND_COLORS;

const MONO = "Consolas,Monaco,monospace";
const SANS = "-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif";
const VIS_GLYPH: Record<string, string> = { "+": "+", "#": "#", "-": "−", "~": "~" };

interface UmlMember {
	visibility?: string;
	name?: string;
	type?: string;
	signature?: string;
}

export interface UmlNodeData {
	id: string;
	width: number;
	height: number;
	kind?: string;
	stereotype?: string;
	members?: { fields?: UmlMember[]; methods?: UmlMember[] };
}

function esc(s: unknown): string {
	return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 生成 UML 分栏节点的 SVG data URI（标题/字段/方法三栏） */
export function buildUmlSvg(data: UmlNodeData): string {
	const w = data.width;
	const h = data.height;
	const c = KIND_COLORS[data.kind ?? ""] ?? KIND_COLORS.flow;
	const strokeDash = data.kind === "interface" ? ' stroke-dasharray="6,3"' : "";
	const { fields = [], methods = [] } = data.members ?? {};

	let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
	svg += `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="6" fill="${c.bg}" stroke="${c.border}" stroke-width="2"${strokeDash}/>`;

	let y = 14;
	if (data.stereotype) {
		svg += `<text x="${w / 2}" y="${y + 11}" text-anchor="middle" font-size="11px" font-style="italic" fill="${c.text}" font-family="${SANS}" opacity="0.7">«${esc(data.stereotype)}»</text>`;
		y += 18;
	}
	svg += `<text x="${w / 2}" y="${y + 13}" text-anchor="middle" font-size="13px" font-weight="700" fill="${c.text}" font-family="${SANS}">${esc(data.id)}</text>`;
	y += 20;

	if (fields.length) {
		svg += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${c.border}" stroke-width="1.5" opacity="0.6"/>`;
		y += 8;
		for (const f of fields) {
			svg += `<text x="12" y="${y + 12}" font-size="11px" fill="${c.text}" font-family="${MONO}" opacity="0.9">${esc(VIS_GLYPH[f.visibility ?? "+"] ?? "+")} ${esc(f.name)} : ${esc(f.type)}</text>`;
			y += 22;
		}
		y += 2;
	}

	if (methods.length) {
		svg += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${c.border}" stroke-width="1.5" opacity="0.6"/>`;
		y += 8;
		for (const m of methods) {
			svg += `<text x="12" y="${y + 12}" font-size="11px" fill="${c.text}" font-family="${MONO}" opacity="0.9">${esc(VIS_GLYPH[m.visibility ?? "+"] ?? "+")} ${esc(m.signature)}</text>`;
			y += 22;
		}
	}

	svg += "</svg>";
	return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
