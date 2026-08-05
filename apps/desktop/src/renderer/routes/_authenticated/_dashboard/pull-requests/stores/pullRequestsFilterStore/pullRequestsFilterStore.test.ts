import { describe, expect, test } from "bun:test";
import {
	migratePullRequestsFilterState,
	pullRequestsSearchFromFilters,
} from "./pullRequestsFilterStore";

describe("pullRequestsSearchFromFilters", () => {
	test("omits default filters", () => {
		expect(
			pullRequestsSearchFromFilters({
				search: "",
				projectFilters: [],
				includeClosed: false,
			}),
		).toEqual({});
	});

	test("serializes independent pull request filters", () => {
		expect(
			pullRequestsSearchFromFilters({
				search: "remote host",
				projectFilters: ["project-1", "project-2"],
				includeClosed: true,
			}),
		).toEqual({
			search: "remote host",
			projects: "project-1,project-2",
			state: "all",
		});
	});
});

describe("migratePullRequestsFilterState", () => {
	test("moves the legacy single repository into the multi-select state", () => {
		expect(
			migratePullRequestsFilterState({ projectFilter: "project-1" }),
		).toMatchObject({ projectFilters: ["project-1"] });
	});

	test("defaults corrupt state to all repositories", () => {
		expect(migratePullRequestsFilterState(null)).toMatchObject({
			projectFilters: [],
		});
	});
});
