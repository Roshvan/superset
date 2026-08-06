import { z } from "zod";
import type {
	ChecksStatus,
	PullRequestCheck,
} from "../../../../runtime/pull-requests/utils/pull-request-mappers";
import { protectedProcedure } from "../../../index";
import {
	normalizePullRequestChecks,
	pullRequestCheckContextSchema,
} from "../../pull-requests/pull-request-checks";
import { normalizeGitHubQuery } from "../normalize-github-query";
import { githubSearchInputSchema } from "../schemas";
import {
	type ResolvedGithubRepo,
	resolveGithubRepo,
} from "../shared/project-helpers";
import type { ExecGh } from "../utils/exec-gh";

interface PullRequestResult {
	prNumber: number;
	title: string;
	url: string;
	state: "open" | "closed" | "merged";
	isDraft: boolean;
	authorLogin: string | null;
	updatedAt: string | null;
	checks: PullRequestCheck[];
	checksStatus: ChecksStatus;
}

export interface PullRequestsPage {
	pullRequests: PullRequestResult[];
	totalCount: number;
	hasNextPage: boolean;
	page: number;
	repoMismatch?: string;
}

const githubAuthorSchema = z
	.string()
	.trim()
	.regex(
		/^@?(?!.*--)[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?(?:\[bot\])?$/i,
		"Author must be a valid GitHub username",
	)
	.transform((author) => author.replace(/^@/, ""));

const searchPullRequestsInputSchema = githubSearchInputSchema.extend({
	author: githubAuthorSchema.optional(),
});

function emptyPullRequestsPage(page: number): PullRequestsPage {
	return {
		pullRequests: [],
		totalCount: 0,
		hasNextPage: false,
		page,
	};
}

function matchesAuthor(
	authorLogin: string | null,
	authorFilter: string | undefined,
): boolean {
	return (
		!authorFilter || authorLogin?.toLowerCase() === authorFilter.toLowerCase()
	);
}

function normalizePullRequestState(
	state: string,
	mergedAt: string | null | undefined,
): "open" | "closed" | "merged" {
	if (mergedAt) return "merged";
	return state.toLowerCase() === "closed" ? "closed" : "open";
}

const ghPrViewSchema = z.object({
	number: z.number(),
	title: z.string(),
	url: z.string(),
	state: z.string(),
	isDraft: z.boolean().optional(),
	author: z.object({ login: z.string() }).nullable().optional(),
	mergedAt: z.string().nullable().optional(),
	updatedAt: z.string().nullable().optional(),
	statusCheckRollup: z
		.array(pullRequestCheckContextSchema)
		.nullable()
		.optional(),
});

const PR_VIEW_FIELDS =
	"number,title,url,state,isDraft,author,mergedAt,updatedAt,statusCheckRollup";

async function ghDirectLookup(
	execGh: ExecGh,
	repo: ResolvedGithubRepo,
	prNumber: number,
): Promise<PullRequestResult> {
	const raw = await execGh(
		[
			"pr",
			"view",
			String(prNumber),
			"--repo",
			`${repo.owner}/${repo.name}`,
			"--json",
			PR_VIEW_FIELDS,
		],
		{ cwd: repo.repoPath ?? undefined },
	);
	const pr = ghPrViewSchema.parse(raw);
	const { checks, checksStatus } = normalizePullRequestChecks(
		pr.statusCheckRollup,
	);
	return {
		prNumber: pr.number,
		title: pr.title,
		url: pr.url,
		state: normalizePullRequestState(pr.state, pr.mergedAt),
		isDraft: pr.isDraft ?? false,
		authorLogin: pr.author?.login ?? null,
		updatedAt: pr.updatedAt ?? null,
		checks,
		checksStatus,
	};
}

const searchIssuesItemSchema = z.object({
	number: z.number(),
	title: z.string(),
	html_url: z.string(),
	state: z.string(),
	draft: z.boolean().optional(),
	user: z.object({ login: z.string() }).nullable().optional(),
	pull_request: z
		.object({
			merged_at: z.string().nullable().optional(),
		})
		.optional(),
	updated_at: z.string().optional(),
});

const searchIssuesResponseSchema = z.object({
	total_count: z.number(),
	items: z.array(searchIssuesItemSchema),
});

async function ghApiSearchPullRequests(
	execGh: ExecGh,
	repo: ResolvedGithubRepo,
	query: string,
	includeClosed: boolean,
	page: number,
	perPage: number,
): Promise<{
	items: PullRequestResult[];
	totalCount: number;
	hasNextPage: boolean;
}> {
	const stateFilter = includeClosed ? "" : " is:open";
	const q =
		`repo:${repo.owner}/${repo.name} is:pr${stateFilter}${query ? ` ${query}` : ""}`.trim();
	const args = [
		"api",
		"-X",
		"GET",
		"search/issues",
		"-f",
		`q=${q}`,
		"-F",
		`per_page=${perPage}`,
		"-F",
		`page=${page}`,
		"-f",
		"sort=updated",
		"-f",
		"order=desc",
	];
	const raw = await execGh(args, { cwd: repo.repoPath ?? undefined });
	const parsed = searchIssuesResponseSchema.parse(raw);
	const items: PullRequestResult[] = parsed.items
		.filter((item) => !!item.pull_request)
		.map((item) => ({
			prNumber: item.number,
			title: item.title,
			url: item.html_url,
			state: normalizePullRequestState(
				item.state,
				item.pull_request?.merged_at,
			),
			isDraft: item.draft ?? false,
			authorLogin: item.user?.login ?? null,
			updatedAt: item.updated_at ?? null,
			checks: [],
			checksStatus: "none",
		}));
	const hasNextPage = page * perPage < parsed.total_count;
	return { items, totalCount: parsed.total_count, hasNextPage };
}

const ghChecksGraphqlResponseSchema = z.object({
	data: z.object({
		repository: z
			.record(
				z.string(),
				z
					.object({
						number: z.number(),
						statusCheckRollup: z
							.object({
								contexts: z.object({
									nodes: z.array(pullRequestCheckContextSchema.nullable()),
									pageInfo: z.object({
										hasNextPage: z.boolean(),
										endCursor: z.string().nullable(),
									}),
								}),
							})
							.nullable()
							.optional(),
					})
					.nullable(),
			)
			.nullable(),
	}),
});

async function ghGetPullRequestChecks(
	execGh: ExecGh,
	repo: ResolvedGithubRepo,
	pullRequestNumbers: number[],
): Promise<Map<number, Pick<PullRequestResult, "checks" | "checksStatus">>> {
	if (pullRequestNumbers.length === 0) return new Map();
	const contextsByPullRequest = new Map<
		number,
		z.infer<typeof pullRequestCheckContextSchema>[]
	>();
	let cursors = new Map<number, string | null>(
		pullRequestNumbers.map((number) => [number, null]),
	);

	while (cursors.size > 0) {
		const cursorDefinitions = [...cursors]
			.flatMap(([number, cursor]) =>
				cursor ? [`$cursor${number}: String!`] : [],
			)
			.join(", ");
		const selections = [...cursors]
			.map(
				([number, cursor]) => `pr${number}:pullRequest(number:${number}) {
				number
				statusCheckRollup {
					contexts(first: 100${cursor ? `, after: $cursor${number}` : ""}) {
						pageInfo { hasNextPage endCursor }
						nodes {
							__typename
							... on CheckRun {
								name
								status
								conclusion
								detailsUrl
								startedAt
								completedAt
							}
							... on StatusContext {
								context
								state
								targetUrl
								createdAt
							}
						}
					}
				}
			}`,
			)
			.join("\n");
		const query = `query($owner: String!, $name: String!${cursorDefinitions ? `, ${cursorDefinitions}` : ""}) {
		repository(owner: $owner, name: $name) {
			${selections}
		}
	}`;
		const cursorArgs = [...cursors].flatMap(([number, cursor]) =>
			cursor ? ["-f", `cursor${number}=${cursor}`] : [],
		);
		const raw = await execGh(
			[
				"api",
				"graphql",
				"-f",
				`query=${query}`,
				"-f",
				`owner=${repo.owner}`,
				"-f",
				`name=${repo.name}`,
				...cursorArgs,
			],
			{ cwd: repo.repoPath ?? undefined },
		);
		const repository = ghChecksGraphqlResponseSchema.parse(raw).data.repository;
		if (!repository) return new Map();

		const nextCursors = new Map<number, string | null>();
		for (const pullRequest of Object.values(repository)) {
			if (!pullRequest) continue;
			const contexts =
				pullRequest.statusCheckRollup?.contexts.nodes.filter(
					(context): context is z.infer<typeof pullRequestCheckContextSchema> =>
						context !== null,
				) ?? [];
			const existing = contextsByPullRequest.get(pullRequest.number) ?? [];
			contextsByPullRequest.set(pullRequest.number, [...existing, ...contexts]);
			const pageInfo = pullRequest.statusCheckRollup?.contexts.pageInfo;
			if (pageInfo?.hasNextPage) {
				if (!pageInfo.endCursor) {
					throw new Error(
						`Missing check-rollup cursor for PR #${pullRequest.number}`,
					);
				}
				if (pageInfo.endCursor === cursors.get(pullRequest.number)) {
					throw new Error(
						`Check-rollup cursor did not advance for PR #${pullRequest.number}`,
					);
				}
				nextCursors.set(pullRequest.number, pageInfo.endCursor);
			}
		}
		cursors = nextCursors;
	}

	return new Map(
		pullRequestNumbers.map((pullRequestNumber) => {
			const contexts = contextsByPullRequest.get(pullRequestNumber) ?? [];
			const { checks, checksStatus } = normalizePullRequestChecks(contexts);
			return [pullRequestNumber, { checks, checksStatus }] as const;
		}),
	);
}

export const searchPullRequests = protectedProcedure
	.input(searchPullRequestsInputSchema)
	.query(async ({ ctx, input }): Promise<PullRequestsPage> => {
		const repo = await resolveGithubRepo(ctx, input.projectId);
		const limit = input.limit ?? 30;
		const page = input.page ?? 1;

		const raw = input.query?.trim() ?? "";
		const normalized = normalizeGitHubQuery(raw, repo, "pull");

		if (normalized.repoMismatch) {
			return {
				pullRequests: [],
				totalCount: 0,
				hasNextPage: false,
				page,
				repoMismatch: `${repo.owner}/${repo.name}`,
			};
		}

		const effectiveQuery = [
			normalized.query,
			input.author ? `author:${input.author}` : "",
		]
			.filter(Boolean)
			.join(" ");

		// gh-first uses the user's local `gh auth login`; falls back to
		// Octokit when gh is missing, unauthed, or errors.
		try {
			if (normalized.isDirectLookup) {
				const prNumber = Number.parseInt(normalized.query, 10);
				const pr = await ghDirectLookup(ctx.execGh, repo, prNumber);
				if (!matchesAuthor(pr.authorLogin, input.author)) {
					return emptyPullRequestsPage(page);
				}
				return {
					pullRequests: [pr],
					totalCount: 1,
					hasNextPage: false,
					page,
				};
			}
			const result = await ghApiSearchPullRequests(
				ctx.execGh,
				repo,
				effectiveQuery,
				input.includeClosed ?? false,
				page,
				limit,
			);
			let pullRequests = result.items;
			try {
				const checksByPullRequest = await ghGetPullRequestChecks(
					ctx.execGh,
					repo,
					result.items.map((pullRequest) => pullRequest.prNumber),
				);
				pullRequests = result.items.map((pullRequest) => ({
					...pullRequest,
					...checksByPullRequest.get(pullRequest.prNumber),
				}));
			} catch (checksError) {
				console.warn(
					"[workspaceCreation.searchPullRequests] failed to enrich checks",
					checksError,
				);
			}
			return {
				pullRequests,
				totalCount: result.totalCount,
				hasNextPage: result.hasNextPage,
				page,
			};
		} catch (ghErr) {
			console.warn(
				"[workspaceCreation.searchPullRequests] gh path failed; falling back to Octokit",
				ghErr,
			);
		}

		const octokit = await ctx.github();

		try {
			if (normalized.isDirectLookup) {
				const prNumber = Number.parseInt(normalized.query, 10);
				const { data: pr } = await octokit.pulls.get({
					owner: repo.owner,
					repo: repo.name,
					pull_number: prNumber,
				});
				if (!matchesAuthor(pr.user?.login ?? null, input.author)) {
					return emptyPullRequestsPage(page);
				}
				const state = normalizePullRequestState(pr.state, pr.merged_at);
				return {
					pullRequests: [
						{
							prNumber: pr.number,
							title: pr.title,
							url: pr.html_url,
							state,
							isDraft: pr.draft ?? false,
							authorLogin: pr.user?.login ?? null,
							updatedAt: pr.updated_at ?? null,
							checks: [],
							checksStatus: "none",
						},
					],
					totalCount: 1,
					hasNextPage: false,
					page,
				};
			}

			const stateFilter = input.includeClosed ? "" : " is:open";
			const query =
				`repo:${repo.owner}/${repo.name} is:pr${stateFilter} ${effectiveQuery}`.trim();
			const { data } = await octokit.search.issuesAndPullRequests({
				q: query,
				per_page: limit,
				page,
				sort: "updated",
				order: "desc",
			});
			const pullRequests: PullRequestResult[] = data.items
				.filter((item) => item.pull_request)
				.map((item) => {
					const state = normalizePullRequestState(
						item.state,
						item.pull_request?.merged_at,
					);
					return {
						prNumber: item.number,
						title: item.title,
						url: item.html_url,
						state,
						isDraft: item.draft ?? false,
						authorLogin: item.user?.login ?? null,
						updatedAt: item.updated_at ?? null,
						checks: [],
						checksStatus: "none",
					};
				});
			const hasNextPage = page * limit < data.total_count;
			return {
				pullRequests,
				totalCount: data.total_count,
				hasNextPage,
				page,
			};
		} catch (err) {
			// Both gh and Octokit failed — rethrow so the renderer's toast
			// fires instead of the dropdown silently rendering "no results".
			console.warn(
				"[workspaceCreation.searchPullRequests] octokit fallback failed",
				err,
			);
			throw err;
		}
	});
