import assert from "node:assert/strict";
import test from "node:test";
import { LatestRequestGate } from "../viewer/src/latestRequest.js";

test("latest request gate aborts superseded work and rejects stale completion", () => {
	const gate = new LatestRequestGate();
	const oldRequest = gate.start();
	const currentRequest = gate.start();
	assert.equal(oldRequest.signal.aborted, true);
	assert.equal(gate.isCurrent(oldRequest), false);
	assert.equal(gate.finish(oldRequest), false);
	assert.equal(gate.isCurrent(currentRequest), true);
	assert.equal(gate.finish(currentRequest), true);
	assert.equal(gate.isCurrent(currentRequest), false);
});

test("latest request gate cancels current work during source changes or unmount", () => {
	const gate = new LatestRequestGate();
	const request = gate.start();
	gate.cancel();
	assert.equal(request.signal.aborted, true);
	assert.equal(gate.finish(request), false);
});
