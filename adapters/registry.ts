// Active domain registry. GraphBrain deliberately exposes only extracted UE code facts.
import type { DomainMeta } from "./adapter-interface.js";
import { ue5CodeMeta } from "./ue5-code/meta.js";

export const DOMAIN_METAS: Record<string, DomainMeta> = {
	ue5_code: ue5CodeMeta,
};
