import { describe, expect, test } from "bun:test";
import { normalizePullRequestChecks } from "./pull-request-checks";

describe("normalizePullRequestChecks", () => {
	test("normalizes check runs and legacy status contexts", () => {
		const result = normalizePullRequestChecks([
			{
				__typename: "CheckRun",
				name: "Typecheck",
				status: "COMPLETED",
				conclusion: "SUCCESS",
				detailsUrl: "https://github.com/org/repo/actions/runs/1",
			},
			{
				__typename: "StatusContext",
				context: "Deploy preview",
				state: "PENDING",
				targetUrl: "https://example.test/deploy",
			},
		]);

		expect(result.checks).toEqual([
			{
				name: "Typecheck",
				status: "success",
				url: "https://github.com/org/repo/actions/runs/1",
			},
			{
				name: "Deploy preview",
				status: "pending",
				url: "https://example.test/deploy",
			},
		]);
		expect(result.checksStatus).toBe("pending");
	});

	test("treats an absent rollup as no checks", () => {
		expect(normalizePullRequestChecks(undefined)).toEqual({
			checks: [],
			checksStatus: "none",
		});
	});
});
