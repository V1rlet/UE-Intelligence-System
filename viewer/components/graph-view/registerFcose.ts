import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";

let registered = false;

/**
 * Registers the force-layout capability only for graphs that actually use it.
 * File forests and hierarchy views stay on Cytoscape's built-in layouts and
 * therefore never download this module or the fCoSE implementation.
 */
export function registerFcose(): void {
	if (registered) return;
	cytoscape.use(fcose);
	registered = true;
}
