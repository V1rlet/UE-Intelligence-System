import assert from "node:assert/strict";
import test from "node:test";
import { groupApiSearchResults, rankApiEntries } from "../viewer/components/api-view/apiSearch";

const entries = [
	{ name: "URuntimeOnly", scope: "Runtime", module: "Engine", popularity: 90 },
	{ name: "UFunctionLibrary", scope: "Developer", module: "BlueprintGraph", popularity: 8 },
	{ name: "UFunction", scope: "Runtime", module: "CoreUObject", popularity: 20 },
	{ name: "FUnrelated", scope: "Editor", module: "EditorFramework", popularity: 100 },
];

test("API search is global and exact matches outrank popularity", () => {
	const results = rankApiEntries(entries, "UFunction");
	assert.deepEqual(results.map((result) => result.entry.name), ["UFunction", "UFunctionLibrary"]);
});

test("API search groups matching scopes by their best result", () => {
	const groups = groupApiSearchResults(entries, "U");
	assert.equal(groups[0].scope, "Runtime");
	assert.deepEqual(groups.flatMap((group) => group.matches.map((match) => match.entry.name)).sort(), [
		"UFunction",
		"UFunctionLibrary",
		"URuntimeOnly",
	].sort());
});
