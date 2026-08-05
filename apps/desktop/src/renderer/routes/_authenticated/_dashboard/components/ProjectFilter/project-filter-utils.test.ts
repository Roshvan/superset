import { describe, expect, test } from "bun:test";
import {
	normalizeProjectFilters,
	parseProjectFilterParam,
	serializeProjectFilters,
} from "./project-filter-utils";

describe("project filter serialization", () => {
	test("uses an omitted parameter for all repositories", () => {
		expect(parseProjectFilterParam(undefined)).toEqual([]);
		expect(serializeProjectFilters([])).toBeUndefined();
	});

	test("round trips multiple repository ids", () => {
		const projectIds = ["project-1", "project-2"];
		expect(
			parseProjectFilterParam(serializeProjectFilters(projectIds)),
		).toEqual(projectIds);
	});

	test("drops invalid and duplicate persisted values", () => {
		expect(
			normalizeProjectFilters(["project-1", null, "project-1", ""]),
		).toEqual(["project-1"]);
	});
});
