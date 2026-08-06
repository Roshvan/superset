import {
	normalizeProjectFilters,
	serializeProjectFilters,
} from "renderer/routes/_authenticated/_dashboard/components/ProjectFilter/project-filter-utils";
import { normalizeAuthorFilter } from "renderer/routes/_authenticated/_dashboard/pull-requests/utils/normalizeAuthorFilter";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PullRequestsFilterState {
	search: string;
	projectFilters: string[];
	authorFilter: string | null;
	includeClosed: boolean;
	setSearch: (search: string) => void;
	setProjectFilters: (projectFilters: string[]) => void;
	setAuthorFilter: (authorFilter: string | null) => void;
	setIncludeClosed: (includeClosed: boolean) => void;
}

type PersistedPullRequestsFilterState = Pick<
	PullRequestsFilterState,
	"projectFilters" | "authorFilter" | "includeClosed"
>;

export function migratePullRequestsFilterState(
	persistedState: unknown,
): PersistedPullRequestsFilterState {
	const state =
		persistedState && typeof persistedState === "object"
			? (persistedState as Record<string, unknown>)
			: {};
	const legacyProject =
		typeof state.projectFilter === "string" ? state.projectFilter : null;
	return {
		projectFilters: normalizeProjectFilters(
			state.projectFilters ?? (legacyProject ? [legacyProject] : []),
		),
		authorFilter: normalizeAuthorFilter(state.authorFilter),
		includeClosed: state.includeClosed === true,
	};
}

export const usePullRequestsFilterStore = create<PullRequestsFilterState>()(
	persist(
		(set) => ({
			search: "",
			projectFilters: [],
			authorFilter: null,
			includeClosed: false,
			setSearch: (search) => set({ search }),
			setProjectFilters: (projectFilters) =>
				set({ projectFilters: normalizeProjectFilters(projectFilters) }),
			setAuthorFilter: (authorFilter) =>
				set({ authorFilter: normalizeAuthorFilter(authorFilter) }),
			setIncludeClosed: (includeClosed) => set({ includeClosed }),
		}),
		{
			name: "pull-requests-filter-state",
			version: 3,
			migrate: migratePullRequestsFilterState,
			partialize: (state) => ({
				projectFilters: state.projectFilters,
				authorFilter: state.authorFilter,
				includeClosed: state.includeClosed,
			}),
		},
	),
);

interface PullRequestsFilters {
	search: string;
	projectFilters: string[];
	authorFilter: string | null;
	includeClosed: boolean;
}

export function pullRequestsSearchFromFilters(
	filters: PullRequestsFilters,
): Record<string, string> {
	const search: Record<string, string> = {};
	if (filters.search) search.search = filters.search;
	const projects = serializeProjectFilters(filters.projectFilters);
	if (projects) search.projects = projects;
	if (filters.authorFilter) search.author = filters.authorFilter;
	if (filters.includeClosed) search.state = "all";
	return search;
}
