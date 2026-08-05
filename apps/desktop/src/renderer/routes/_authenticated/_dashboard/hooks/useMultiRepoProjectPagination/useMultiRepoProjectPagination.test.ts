import { describe, expect, test } from "bun:test";
import type { ProjectQueryTarget } from "../useProjectQueryTargets";
import { buildPaginatedProjectQueryTargets } from "./useMultiRepoProjectPagination";

const projects: ProjectQueryTarget[] = [
	{
		projectId: "web",
		projectName: "Web",
		hostId: "host-1",
		hostUrl: "http://localhost:3201",
	},
	{
		projectId: "api",
		projectName: "API",
		hostId: "host-1",
		hostUrl: "http://localhost:3201",
	},
];

describe("buildPaginatedProjectQueryTargets", () => {
	test("starts every repository on its first page", () => {
		expect(buildPaginatedProjectQueryTargets(projects, {})).toEqual([
			{ target: projects[0], page: 1 },
			{ target: projects[1], page: 1 },
		]);
	});

	test("expands only repositories with additional requested pages", () => {
		expect(buildPaginatedProjectQueryTargets(projects, { web: 3 })).toEqual([
			{ target: projects[0], page: 1 },
			{ target: projects[0], page: 2 },
			{ target: projects[0], page: 3 },
			{ target: projects[1], page: 1 },
		]);
	});
});
