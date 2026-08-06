import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { projects } from "../../src/db/schema";
import { createTestHost, type TestHost } from "../helpers/createTestHost";

/**
 * Real temp git working tree with a remote, plus a `projects` row pointing
 * at it. Procedures resolve owner/name from the live remote, so tests need
 * a real `.git` — no fake substitutes for `git remote get-url`.
 */
async function seedRepoFixture(
	host: TestHost,
	projectId: string,
	remoteUrl: string,
): Promise<string> {
	const dir = mkdtempSync(join(tmpdir(), "ws-creation-github-test-"));
	const git = simpleGit(dir);
	await git.init(["--initial-branch=main"]);
	await git.addRemote("origin", remoteUrl);
	host.db
		.insert(projects)
		.values({
			id: projectId,
			repoPath: dir,
			repoProvider: "github",
			repoOwner: null,
			repoName: null,
			repoUrl: null,
			remoteName: "origin",
		})
		.run();
	return dir;
}

describe("workspaceCreation github procedures with mocked Octokit", () => {
	let host: TestHost;
	let repoDir: string;
	const calls: Array<{ method: string; args: unknown }> = [];

	const fakeOctokit = {
		issues: {
			get: async (args: unknown) => {
				calls.push({ method: "issues.get", args });
				const a = args as { issue_number: number };
				return {
					data: {
						number: a.issue_number,
						title: `Issue #${a.issue_number}`,
						html_url: `https://github.com/octocat/hello/issues/${a.issue_number}`,
						state: "open",
						user: { login: "alice" },
						pull_request: undefined,
					},
				};
			},
		},
		pulls: {
			get: async (args: unknown) => {
				calls.push({ method: "pulls.get", args });
				const a = args as { pull_number: number };
				return {
					data: {
						number: a.pull_number,
						title: `PR #${a.pull_number}`,
						html_url: `https://github.com/octocat/hello/pull/${a.pull_number}`,
						state: "open",
						user: { login: "bob" },
						head: { ref: "feature/x" },
						base: { ref: "main" },
						draft: false,
					},
				};
			},
		},
		search: {
			issuesAndPullRequests: async (args: unknown) => {
				calls.push({ method: "search.issuesAndPullRequests", args });
				const searchArgs = args as { page?: number; q: string };
				if (
					searchArgs.q.includes("review:required") ||
					searchArgs.q.includes("review:none")
				) {
					const isSecondPage = searchArgs.page === 2;
					const isMatch =
						searchArgs.q.includes("review:required") && isSecondPage;
					return {
						data: {
							total_count: 101,
							items: [
								{
									number: isMatch ? 33 : 7,
									title: isMatch ? "PR #33" : "search hit",
									html_url: isMatch
										? "https://github.com/octocat/hello/pull/33"
										: "https://github.com/octocat/hello/issues/7",
									state: "open",
									user: { login: isMatch ? "bob" : "carol" },
									pull_request: isMatch ? { merged_at: null } : undefined,
								},
							],
						},
					};
				}
				return {
					data: {
						total_count: 1,
						items: [
							{
								number: 7,
								title: "search hit",
								html_url: "https://github.com/octocat/hello/issues/7",
								state: "open",
								user: { login: "carol" },
								pull_request: undefined,
							},
						],
					},
				};
			},
		},
	};

	const projectId = randomUUID();

	beforeEach(async () => {
		calls.length = 0;
		host = await createTestHost({ githubFactory: async () => fakeOctokit });
		repoDir = await seedRepoFixture(
			host,
			projectId,
			"https://github.com/octocat/hello.git",
		);
	});

	afterEach(async () => {
		await host.dispose();
		rmSync(repoDir, { recursive: true, force: true });
	});

	test("searchGitHubIssues handles direct #123 lookup via issues.get", async () => {
		const result = await host.trpc.workspaceCreation.searchGitHubIssues.query({
			projectId,
			query: "#42",
		});
		expect(result.issues).toHaveLength(1);
		expect(result.issues[0].issueNumber).toBe(42);
		expect(calls[0].method).toBe("issues.get");
		expect(calls[0].args).toMatchObject({
			owner: "octocat",
			repo: "hello",
			issue_number: 42,
		});
	});

	test("searchGitHubIssues falls through to search.issuesAndPullRequests for free-text", async () => {
		const result = await host.trpc.workspaceCreation.searchGitHubIssues.query({
			projectId,
			query: "fix bug",
		});
		expect(result.issues).toHaveLength(1);
		expect(result.issues[0].issueNumber).toBe(7);
		expect(calls[0].method).toBe("search.issuesAndPullRequests");
	});

	test("searchGitHubIssues returns repoMismatch for cross-repo URLs", async () => {
		const result = await host.trpc.workspaceCreation.searchGitHubIssues.query({
			projectId,
			query: "https://github.com/other/repo/issues/1",
		});
		expect(result.issues).toEqual([]);
		expect(result.repoMismatch).toBe("octocat/hello");
		expect(calls).toHaveLength(0);
	});

	test("searchPullRequests handles direct #123 lookup via pulls.get", async () => {
		const result = await host.trpc.workspaceCreation.searchPullRequests.query({
			projectId,
			query: "#33",
			author: "@BOB",
		});
		expect(result.pullRequests).toHaveLength(1);
		expect(result.pullRequests[0].prNumber).toBe(33);
		expect(calls[0].method).toBe("pulls.get");
		expect(calls[0].args).toMatchObject({
			owner: "octocat",
			repo: "hello",
			pull_number: 33,
		});
	});

	test("searchPullRequests filters a direct lookup by author", async () => {
		const result = await host.trpc.workspaceCreation.searchPullRequests.query({
			projectId,
			query: "#33",
			author: "alice",
		});
		expect(result.pullRequests).toEqual([]);
		expect(result.totalCount).toBe(0);
		expect(calls[0].method).toBe("pulls.get");
	});

	test("searchPullRequests rejects an invalid GitHub author", async () => {
		await expect(
			host.trpc.workspaceCreation.searchPullRequests.query({
				projectId,
				author: "octo--cat",
			}),
		).rejects.toThrow("Author must be a valid GitHub username");
		expect(calls).toHaveLength(0);
	});

	test("searchPullRequests pages review filters for direct lookups", async () => {
		const result = await host.trpc.workspaceCreation.searchPullRequests.query({
			projectId,
			query: "#33",
			review: "required",
		});
		expect(result.pullRequests).toHaveLength(1);
		expect(result.pullRequests[0].prNumber).toBe(33);
		expect(calls).toHaveLength(3);
		expect(calls[0]).toMatchObject({
			method: "search.issuesAndPullRequests",
			args: { page: 1, q: expect.stringContaining("review:required") },
		});
		expect(calls[1]).toMatchObject({
			method: "search.issuesAndPullRequests",
			args: { page: 2, q: expect.stringContaining("review:required") },
		});
		expect(calls[2].method).toBe("pulls.get");
	});

	test("searchPullRequests stops after exhausting Octokit review pages", async () => {
		const result = await host.trpc.workspaceCreation.searchPullRequests.query({
			projectId,
			query: "#33",
			review: "none",
		});
		expect(result.pullRequests).toEqual([]);
		expect(result.totalCount).toBe(0);
		expect(calls).toHaveLength(2);
		expect(calls[0]).toMatchObject({
			method: "search.issuesAndPullRequests",
			args: { page: 1, q: expect.stringContaining("review:none") },
		});
		expect(calls[1]).toMatchObject({
			method: "search.issuesAndPullRequests",
			args: { page: 2, q: expect.stringContaining("review:none") },
		});
	});

	test("searchPullRequests filters search results to PRs only", async () => {
		const result = await host.trpc.workspaceCreation.searchPullRequests.query({
			projectId,
			query: "find me",
			author: "carol",
			review: "approved",
		});
		// Our fake search returns one issue (no `pull_request`), so no PRs.
		expect(result.pullRequests).toEqual([]);
		expect(calls[0].method).toBe("search.issuesAndPullRequests");
		const searchArgs = calls[0].args as { q: string };
		expect(searchArgs.q).toContain("author:carol");
		expect(searchArgs.q).toContain("review:approved");
	});
});

describe("resolveGithubRepo trusts the live local remote, never the cloud", () => {
	let host: TestHost;
	let repoDir: string;
	const projectId = randomUUID();

	const fakeOctokit = {
		pulls: {
			get: async () => ({
				data: {
					number: 33,
					title: "PR #33",
					html_url: "https://github.com/cli/cli/pull/33",
					state: "open",
					user: { login: "bob" },
					draft: false,
					merged_at: null,
				},
			}),
		},
	};

	beforeEach(async () => {
		// Cloud says `somewhere/else`; local remote is `cli/cli`. The
		// resolver MUST follow the local remote.
		host = await createTestHost({
			githubFactory: async () => fakeOctokit,
			apiOverrides: {
				"v2Project.get.query": () => ({
					id: projectId,
					githubRepository: null,
					repoCloneUrl: "https://github.com/somewhere/else.git",
				}),
			},
		});
		repoDir = await seedRepoFixture(
			host,
			projectId,
			"https://github.com/cli/cli.git",
		);
	});

	afterEach(async () => {
		await host.dispose();
		rmSync(repoDir, { recursive: true, force: true });
	});

	test("searchPullRequests routes the call against the local remote's owner/name", async () => {
		const result = await host.trpc.workspaceCreation.searchPullRequests.query({
			projectId,
			query: "#33",
		});
		expect(result.pullRequests).toHaveLength(1);
		expect(result.pullRequests[0].url).toContain("github.com/cli/cli");
	});
});

describe("resolveGithubRepo prefers the user-configured remoteName", () => {
	let host: TestHost;
	let repoDir: string;
	const projectId = randomUUID();

	const fakeOctokit = {
		pulls: {
			get: async () => ({
				data: {
					number: 5,
					title: "via upstream",
					html_url: "https://github.com/upstream-org/cli/pull/5",
					state: "open",
					user: { login: "ada" },
					draft: false,
					merged_at: null,
				},
			}),
		},
		issues: { get: async () => ({ data: {} }) },
		search: {
			issuesAndPullRequests: async () => ({
				data: { total_count: 0, items: [] },
			}),
		},
	};

	beforeEach(async () => {
		host = await createTestHost({ githubFactory: async () => fakeOctokit });
		// origin → user's fork, upstream → real source, configured = upstream.
		// Resolver must honor `remoteName=upstream`, not default to origin.
		repoDir = mkdtempSync(join(tmpdir(), "ws-creation-github-test-"));
		const git = simpleGit(repoDir);
		await git.init(["--initial-branch=main"]);
		await git.addRemote("origin", "https://github.com/me/cli.git");
		await git.addRemote("upstream", "https://github.com/upstream-org/cli.git");
		host.db
			.insert(projects)
			.values({
				id: projectId,
				repoPath: repoDir,
				repoProvider: "github",
				repoOwner: null,
				repoName: null,
				repoUrl: null,
				remoteName: "upstream",
			})
			.run();
	});

	afterEach(async () => {
		await host.dispose();
		rmSync(repoDir, { recursive: true, force: true });
	});

	test("searchPullRequests routes against `upstream`, not `origin`", async () => {
		const result = await host.trpc.workspaceCreation.searchPullRequests.query({
			projectId,
			query: "#5",
		});
		expect(result.pullRequests).toHaveLength(1);
		expect(result.pullRequests[0].url).toContain("github.com/upstream-org/cli");
	});
});

describe("both backends failing rethrows so the renderer toast fires", () => {
	let host: TestHost;
	let repoDir: string;
	const projectId = randomUUID();

	const failingOctokit = {
		pulls: {
			get: async () => {
				throw new Error("octokit pulls.get failed");
			},
		},
		issues: {
			get: async () => {
				throw new Error("octokit issues.get failed");
			},
		},
		search: {
			issuesAndPullRequests: async () => {
				throw new Error("octokit search failed");
			},
		},
	};
	const failingExecGh = async (): Promise<unknown> => {
		throw new Error("gh exec failed");
	};

	beforeEach(async () => {
		host = await createTestHost({
			githubFactory: async () => failingOctokit,
			execGh: failingExecGh,
		});
		repoDir = await seedRepoFixture(
			host,
			projectId,
			"https://github.com/octocat/hello.git",
		);
	});

	afterEach(async () => {
		await host.dispose();
		rmSync(repoDir, { recursive: true, force: true });
	});

	test("searchPullRequests rethrows when both gh and Octokit fail", async () => {
		await expect(
			host.trpc.workspaceCreation.searchPullRequests.query({
				projectId,
				query: "anything",
			}),
		).rejects.toThrow();
	});

	test("searchGitHubIssues rethrows when both gh and Octokit fail", async () => {
		await expect(
			host.trpc.workspaceCreation.searchGitHubIssues.query({
				projectId,
				query: "anything",
			}),
		).rejects.toThrow();
	});
});

describe("resolveGithubRepo throws PROJECT_NOT_SETUP when no local clone", () => {
	let host: TestHost;
	const projectId = randomUUID();

	beforeEach(async () => {
		host = await createTestHost({
			apiOverrides: {
				"v2Project.get.query": () => ({
					id: projectId,
					githubRepository: { owner: "octocat", name: "hello" },
					repoCloneUrl: "https://github.com/octocat/hello.git",
				}),
			},
		});
	});

	afterEach(async () => {
		await host.dispose();
	});

	test("searchPullRequests refuses to query GitHub without a local clone", async () => {
		await expect(
			host.trpc.workspaceCreation.searchPullRequests.query({
				projectId,
				query: "#1",
			}),
		).rejects.toThrow(/Project is not set up on this host/);
	});
});

describe("gh CLI is first-class when execGh succeeds", () => {
	let host: TestHost;
	let repoDir: string;
	const projectId = randomUUID();
	const ghCalls: Array<{ args: string[]; cwd?: string }> = [];

	// Octokit must NOT be hit when gh succeeds — throws turn accidental
	// fallbacks into loud failures.
	const fakeOctokit = {
		pulls: {
			get: async () => {
				throw new Error("octokit must not be called when gh succeeds");
			},
		},
		issues: {
			get: async () => {
				throw new Error("octokit must not be called when gh succeeds");
			},
		},
		search: {
			issuesAndPullRequests: async () => {
				throw new Error("octokit must not be called when gh succeeds");
			},
		},
	};

	const fakeExecGh = async (
		args: string[],
		options?: { cwd?: string },
	): Promise<unknown> => {
		ghCalls.push({ args, cwd: options?.cwd });
		if (args[0] === "pr" && args[1] === "view") {
			return {
				number: Number(args[2]),
				title: "PR via gh",
				url: `https://github.com/octocat/hello/pull/${args[2]}`,
				state: "OPEN",
				isDraft: false,
				author: { login: "bob" },
				mergedAt: null,
				statusCheckRollup: null,
			};
		}
		if (args[0] === "api" && args[1] === "graphql") {
			const isNextChecksPage = args.includes("cursor101=checks-page-2");
			return {
				data: {
					repository: {
						pr101: {
							number: 101,
							statusCheckRollup: {
								contexts: {
									pageInfo: {
										hasNextPage: !isNextChecksPage,
										endCursor: isNextChecksPage ? null : "checks-page-2",
									},
									nodes: [
										{
											__typename: "CheckRun",
											name: isNextChecksPage ? "Tests" : "Typecheck",
											status: "COMPLETED",
											conclusion: isNextChecksPage ? "FAILURE" : "SUCCESS",
											detailsUrl: "https://github.com/octocat/hello/actions/1",
										},
									],
								},
							},
						},
					},
				},
			};
		}
		if (args[0] === "api" && args.includes("search/issues")) {
			const qIndex = args.indexOf("-f");
			const q = args[qIndex + 1] ?? "";
			const pageArg = args.find((arg) => arg.startsWith("page="));
			const searchPage = Number.parseInt(
				pageArg?.slice("page=".length) ?? "1",
				10,
			);
			const isPr = q.includes("is:pr");
			if (isPr) {
				const isDirectReviewLookup =
					q.includes("33") &&
					(q.includes("review:required") || q.includes("review:none"));
				const foundDirectReviewLookup =
					q.includes("review:required") && searchPage === 2;
				return {
					total_count: isDirectReviewLookup ? 101 : 1,
					items: [
						{
							number: foundDirectReviewLookup ? 33 : 101,
							title: foundDirectReviewLookup ? "PR via gh" : "search result",
							html_url: `https://github.com/octocat/hello/pull/${foundDirectReviewLookup ? 33 : 101}`,
							state: "open",
							user: { login: "carol" },
							pull_request: { merged_at: null },
						},
					],
				};
			}
			return {
				total_count: 1,
				items: [
					{
						number: 7,
						title: "issue search result",
						html_url: "https://github.com/octocat/hello/issues/7",
						state: "open",
						user: { login: "dave" },
						updated_at: "2026-08-05T11:00:00Z",
					},
				],
			};
		}
		return {};
	};

	beforeEach(async () => {
		ghCalls.length = 0;
		host = await createTestHost({
			githubFactory: async () => fakeOctokit,
			execGh: fakeExecGh,
		});
		repoDir = await seedRepoFixture(
			host,
			projectId,
			"https://github.com/octocat/hello.git",
		);
	});

	afterEach(async () => {
		await host.dispose();
		rmSync(repoDir, { recursive: true, force: true });
	});

	test("searchPullRequests #N invokes `gh pr view` with cwd=repoPath", async () => {
		const result = await host.trpc.workspaceCreation.searchPullRequests.query({
			projectId,
			query: "#33",
			author: "bob",
		});
		expect(result.pullRequests).toHaveLength(1);
		expect(result.pullRequests[0].prNumber).toBe(33);
		expect(result.pullRequests[0].title).toBe("PR via gh");
		expect(result.pullRequests[0].checks).toEqual([]);
		expect(ghCalls).toHaveLength(1);
		expect(ghCalls[0].args.slice(0, 5)).toEqual([
			"pr",
			"view",
			"33",
			"--repo",
			"octocat/hello",
		]);
		// `rev-parse --show-toplevel` canonicalizes /var → /private/var on macOS.
		expect(ghCalls[0].cwd).toBe(realpathSync(repoDir));
	});

	test("searchPullRequests filters a gh direct lookup by author", async () => {
		const result = await host.trpc.workspaceCreation.searchPullRequests.query({
			projectId,
			query: "#33",
			author: "alice",
		});
		expect(result.pullRequests).toEqual([]);
		expect(result.totalCount).toBe(0);
		expect(ghCalls).toHaveLength(1);
	});

	test("searchPullRequests applies review filters to gh direct lookups", async () => {
		const result = await host.trpc.workspaceCreation.searchPullRequests.query({
			projectId,
			query: "#33",
			review: "required",
		});
		expect(result.pullRequests).toHaveLength(1);
		expect(result.pullRequests[0].prNumber).toBe(33);
		expect(ghCalls).toHaveLength(3);
		expect(ghCalls[0].args.join(" ")).toContain("review:required");
		expect(ghCalls[0].args).toContain("page=1");
		expect(ghCalls[1].args.join(" ")).toContain("review:required");
		expect(ghCalls[1].args).toContain("page=2");
		expect(ghCalls[2].args.slice(0, 3)).toEqual(["pr", "view", "33"]);
	});

	test("searchPullRequests stops after exhausting gh review pages", async () => {
		const result = await host.trpc.workspaceCreation.searchPullRequests.query({
			projectId,
			query: "#33",
			review: "none",
		});
		expect(result.pullRequests).toEqual([]);
		expect(result.totalCount).toBe(0);
		expect(ghCalls).toHaveLength(2);
		expect(ghCalls[0].args.join(" ")).toContain("review:none");
		expect(ghCalls[0].args).toContain("page=1");
		expect(ghCalls[1].args.join(" ")).toContain("review:none");
		expect(ghCalls[1].args).toContain("page=2");
	});

	test("searchPullRequests free-text invokes `gh api search/issues` with is:pr filter", async () => {
		const result = await host.trpc.workspaceCreation.searchPullRequests.query({
			projectId,
			query: "find me",
			author: "carol",
			review: "team-review-requested",
		});
		expect(result.pullRequests).toHaveLength(1);
		expect(result.pullRequests[0].prNumber).toBe(101);
		expect(result.pullRequests[0].title).toBe("search result");
		expect(result.totalCount).toBe(1);
		expect(result.hasNextPage).toBe(false);
		expect(ghCalls).toHaveLength(3);
		const args = ghCalls[0].args;
		expect(args[0]).toBe("api");
		expect(args).toContain("search/issues");
		const qArg = args[args.indexOf("-f") + 1] ?? "";
		expect(qArg).toContain("repo:octocat/hello");
		expect(qArg).toContain("is:pr");
		expect(qArg).toContain("is:open");
		expect(qArg).toContain("find me");
		expect(qArg).toContain("author:carol");
		expect(qArg).toContain("review-requested:@me");
		expect(qArg).not.toContain("team-review-requested:@me");
		expect(ghCalls[1].args.slice(0, 2)).toEqual(["api", "graphql"]);
		expect(ghCalls[1].args.join(" ")).toContain("pullRequest(number:101)");
		expect(ghCalls[1].args.join(" ")).not.toContain("pullRequest(number:999)");
		expect(ghCalls[1].args).toContain("owner=octocat");
		expect(ghCalls[1].args).toContain("name=hello");
		for (const variable of ["owner=octocat", "name=hello"]) {
			const variableIndex = ghCalls[1].args.indexOf(variable);
			expect(ghCalls[1].args[variableIndex - 1]).toBe("-f");
		}
		expect(ghCalls[2].args).toContain("cursor101=checks-page-2");
		expect(ghCalls[2].args.join(" ")).toContain(
			"contexts(first: 100, after: $cursor101)",
		);
		expect(result.pullRequests[0].checks).toHaveLength(2);
		expect(result.pullRequests[0].checksStatus).toBe("failure");
	});

	test("searchPullRequests distinguishes individual review requests", async () => {
		await host.trpc.workspaceCreation.searchPullRequests.query({
			projectId,
			query: "find me",
			review: "review-requested",
		});
		const searchCall = ghCalls.find(
			(call) => call.args[0] === "api" && call.args.includes("search/issues"),
		);
		expect(searchCall).toBeDefined();
		expect(searchCall?.args.join(" ")).toContain("user-review-requested:@me");
	});

	test("searchGitHubIssues #N filters out PRs leaked by `gh issue view`", async () => {
		// gh CLI happily returns a PR when `gh issue view <pr-number>` is
		// called — the URL is the only signal we have to detect it.
		const localHost = await createTestHost({
			githubFactory: async () => fakeOctokit,
			execGh: async (args) => {
				if (args[0] === "issue" && args[1] === "view") {
					return {
						number: Number(args[2]),
						title: "Should be filtered",
						url: `https://github.com/octocat/hello/pull/${args[2]}`,
						state: "OPEN",
						author: { login: "x" },
					};
				}
				return {};
			},
		});
		const localRepo = await seedRepoFixture(
			localHost,
			projectId,
			"https://github.com/octocat/hello.git",
		);
		const result =
			await localHost.trpc.workspaceCreation.searchGitHubIssues.query({
				projectId,
				query: "#13353",
			});
		expect(result.issues).toEqual([]);
		await localHost.dispose();
		rmSync(localRepo, { recursive: true, force: true });
	});

	test("searchGitHubIssues free-text invokes `gh api search/issues` with is:issue filter", async () => {
		const result = await host.trpc.workspaceCreation.searchGitHubIssues.query({
			projectId,
			query: "bug",
		});
		expect(result.issues).toHaveLength(1);
		expect(result.issues[0].issueNumber).toBe(7);
		expect(result.issues[0].updatedAt).toBe("2026-08-05T11:00:00Z");
		expect(result.totalCount).toBe(1);
		expect(result.hasNextPage).toBe(false);
		expect(ghCalls).toHaveLength(1);
		const args = ghCalls[0].args;
		expect(args[0]).toBe("api");
		expect(args).toContain("search/issues");
		const qArg = args[args.indexOf("-f") + 1] ?? "";
		expect(qArg).toContain("repo:octocat/hello");
		expect(qArg).toContain("is:issue");
		expect(qArg).toContain("bug");
	});
});
