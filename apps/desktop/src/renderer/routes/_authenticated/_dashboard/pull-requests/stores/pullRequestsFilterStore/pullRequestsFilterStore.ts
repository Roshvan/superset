import {
	normalizeProjectFilters,
	serializeProjectFilters,
} from "renderer/routes/_authenticated/_dashboard/components/ProjectFilter/project-filter-utils";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PullRequestsFilterState {
	search: string;
	projectFilters: string[];
	includeClosed: boolean;
	setSearch: (search: string) => void;
	setProjectFilters: (projectFilters: string[]) => void;
	setIncludeClosed: (includeClosed: boolean) => void;
}

type PersistedPullRequestsFilterState = Pick<
	PullRequestsFilterState,
	"projectFilters" | "includeClosed"
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
		includeClosed: state.includeClosed === true,
	};
}

export const usePullRequestsFilterStore = create<PullRequestsFilterState>()(
	persist(
		(set) => ({
			search: "",
			projectFilters: [],
			includeClosed: false,
			setSearch: (search) => set({ search }),
			setProjectFilters: (projectFilters) => set({ projectFilters }),
			setIncludeClosed: (includeClosed) => set({ includeClosed }),
		}),
		{
			name: "pull-requests-filter-state",
			version: 2,
			migrate: migratePullRequestsFilterState,
			partialize: (state) => ({
				projectFilters: state.projectFilters,
				includeClosed: state.includeClosed,
			}),
		},
	),
);

interface PullRequestsFilters {
	search: string;
	projectFilters: string[];
	includeClosed: boolean;
}

export function pullRequestsSearchFromFilters(
	filters: PullRequestsFilters,
): Record<string, string> {
	const search: Record<string, string> = {};
	if (filters.search) search.search = filters.search;
	const projects = serializeProjectFilters(filters.projectFilters);
	if (projects) search.projects = projects;
	if (filters.includeClosed) search.state = "all";
	return search;
}
