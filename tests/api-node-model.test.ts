import assert from "node:assert/strict";
import test from "node:test";
import { buildApiFunctionNodeModel } from "../viewer/components/api-view/apiNodeModel";

test("API list facts map losslessly into the Spec node summary", () => {
	const model = buildApiFunctionNodeModel({
		label: "CreateSession",
		parent: "UGameInstance",
		module: "OnlineSubsystem",
		layer: "engine",
		source_path: "Engine/Source/Runtime/Engine/Classes/Engine/GameInstance.h",
		api: {
			signature: "bool CreateSession(FName Name, int32 Slots, bool LAN, FString Region, float Timeout)",
			return_type: "bool",
			params: [
				{ name: "Name", type: "FName" },
				{ name: "Slots", type: "int32" },
				{ name: "LAN", type: "bool" },
				{ name: "Region", type: "FString" },
				{ name: "Timeout", type: "float", note: "seconds" },
			],
		},
	});

	assert.equal(model.signature, "bool CreateSession(FName Name, int32 Slots, bool LAN, FString Region, float Timeout)");
	assert.deepEqual(model.visibleParams.map(({ name, type }) => ({ name, type })), [
		{ name: "Name", type: "FName" },
		{ name: "Slots", type: "int32" },
		{ name: "LAN", type: "bool" },
		{ name: "Region", type: "FString" },
	]);
	assert.equal(model.hiddenParamCount, 1);
	assert.equal(model.returnType, "bool");
	assert.equal(model.sourceFile, "GameInstance.h");
	assert.equal(model.sourceLabel, "UE 5.8");
});

test("API Spec nodes synthesize missing legacy row fields without dropping context", () => {
	const model = buildApiFunctionNodeModel({
		label: "TickCombat",
		parent: "UCombatCoordinator",
		module: "Combat",
		api: { params: [{ name: "DeltaSeconds", type: "float" }] },
	});

	assert.equal(model.signature, "void TickCombat(float DeltaSeconds)");
	assert.equal(model.returnType, "void");
	assert.equal(model.sourceFile, "UCombatCoordinator");
	assert.equal(model.sourceLabel, "PROJECT");
});
