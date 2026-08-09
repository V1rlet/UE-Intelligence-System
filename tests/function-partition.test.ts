import assert from "node:assert/strict";
import test from "node:test";
import {
	paginateSpecFunctions,
	partitionSpecFunctions,
	specFunctionKind,
	specFunctionPageIndex,
} from "../viewer/components/common/functionPartition";

test("class Spec functions split into accessor/init, static and dispatch zones", () => {
	const functions = [
		{ id: "UCombat::GetState", label: "GetState", api: { signature: "EState GetState() const" } },
		{ id: "UCombat::SetState", label: "SetState", api: { signature: "void SetState(EState State)" } },
		{ id: "UCombat::InitializeCombat", label: "InitializeCombat", api: { signature: "void InitializeCombat()" } },
		{ id: "UCombat::SetupInput", label: "SetupInput", api: { signature: "void SetupInput()" } },
		{ id: "UCombat::CreateDefault", label: "CreateDefault", api: { signature: "static UCombat* CreateDefault()", is_static: true } },
		{ id: "UCombat::ProvideSource", label: "ProvideSource", tags: ["interface:ICombatSource"], api: { signature: "void ProvideSource()" } },
		{ id: "UCombat::HandleDeath", label: "HandleDeath", tags: ["delegate_response"], api: { signature: "void HandleDeath()" } },
		{ id: "UCombat::ResolveHit", label: "ResolveHit", api: { signature: "void ResolveHit()" } },
	];
	const result = partitionSpecFunctions(functions);

	assert.deepEqual(result.accessors.map((fn) => fn.label), ["GetState", "SetState", "InitializeCombat", "SetupInput"]);
	assert.deepEqual(result.statics.map((fn) => fn.label), ["CreateDefault"]);
	assert.deepEqual(result.interfaceFunctions.map((fn) => fn.label), ["ProvideSource"]);
	assert.deepEqual(result.delegateResponses.map((fn) => fn.label), ["HandleDeath"]);
	assert.deepEqual(result.dispatch.map((fn) => fn.label), ["ResolveHit"]);
});

test("explicit static semantics take priority over getter naming", () => {
	assert.equal(specFunctionKind({ id: "UCombat::GetDefault", api: { signature: "static UCombat* GetDefault()" } }), "static");
});

test("all function zones share one ten-item page budget", () => {
	const functions = [
		...Array.from({ length: 4 }, (_, index) => ({ id: `UCombat::Static${index}`, label: `Static${index}`, api: { is_static: true } })),
		...Array.from({ length: 9 }, (_, index) => ({ id: `UCombat::Dispatch${index}`, label: `Dispatch${index}` })),
		...Array.from({ length: 3 }, (_, index) => ({ id: `UCombat::Interface${index}`, label: `Interface${index}`, tags: ["interface:ICombat"] })),
		...Array.from({ length: 5 }, (_, index) => ({ id: `UCombat::GetValue${index}`, label: `GetValue${index}` })),
		...Array.from({ length: 2 }, (_, index) => ({ id: `UCombat::Handle${index}`, label: `Handle${index}`, tags: ["delegate_response"] })),
	];
	const first = paginateSpecFunctions(functions, 0, 10);
	const second = paginateSpecFunctions(functions, 1, 10);
	const last = paginateSpecFunctions(functions, 2, 10);
	const count = (page: typeof first.page) => Object.values(page).reduce((sum, items) => sum + items.length, 0);

	assert.equal(first.total, 23);
	assert.equal(first.pageCount, 3);
	assert.equal(count(first.page), 10);
	assert.equal(count(second.page), 10);
	assert.equal(count(last.page), 3);
	assert.equal(specFunctionPageIndex(functions, "UCombat::GetValue4", 10), 2);
	assert.equal(specFunctionPageIndex(functions, "UCombat::missing", 10), -1);
});
