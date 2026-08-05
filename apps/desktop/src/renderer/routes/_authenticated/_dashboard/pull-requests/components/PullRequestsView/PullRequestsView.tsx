import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDebouncedSearchNavigation } from "renderer/routes/_authenticated/_dashboard/hooks/useDebouncedSearchNavigation";
import { useProjectQueryTargets } from "renderer/routes/_authenticated/_dashboard/hooks/useProjectQueryTargets";
import {
	pullRequestsSearchFromFilters,
	usePullRequestsFilterStore,
} from "../../stores/pullRequestsFilterStore";
import { PullRequestsContent } from "./components/PullRequestsContent";
import { PullRequestsTopBar } from "./components/PullRequestsTopBar";

interface PullRequestsViewProps {
	initialSearch?: string;
	initialProjects?: string[];
	initialState?: "open" | "all";
}

export function PullRequestsView({
	initialSearch,
	initialProjects,
	initialState,
}: PullRequestsViewProps) {
	const navigate = useNavigate();
	const {
		search: storedSearch,
		projectFilters: storedProjectFilters,
		includeClosed: storedIncludeClosed,
		setSearch: storeSetSearch,
		setProjectFilters: storeSetProjectFilters,
		setIncludeClosed: storeSetIncludeClosed,
	} = usePullRequestsFilterStore();
	const [searchQuery, setSearchQuery] = useState(initialSearch ?? storedSearch);
	const projectFilters = initialProjects ?? storedProjectFilters;
	const includeClosed =
		initialState === undefined ? storedIncludeClosed : initialState === "all";
	const {
		isReady: areProjectsReady,
		projects: hostProjects,
		targets: projectTargets,
	} = useProjectQueryTargets(projectFilters);

	useEffect(() => {
		setSearchQuery(initialSearch ?? storedSearch);
	}, [initialSearch, storedSearch]);

	useEffect(() => {
		storeSetSearch(searchQuery);
	}, [searchQuery, storeSetSearch]);

	const buildSearch = useCallback(
		(overrides: {
			search?: string;
			projects?: string[];
			includeClosed?: boolean;
		}) =>
			pullRequestsSearchFromFilters({
				search: overrides.search ?? searchQuery,
				projectFilters:
					overrides.projects !== undefined
						? overrides.projects
						: projectFilters,
				includeClosed: overrides.includeClosed ?? includeClosed,
			}),
		[includeClosed, projectFilters, searchQuery],
	);
	const navigateSearch = useCallback(
		(query: string) => {
			navigate({
				to: "/pull-requests",
				search: buildSearch({ search: query }),
				replace: true,
			});
		},
		[buildSearch, navigate],
	);
	const {
		cancelPendingSearchNavigation,
		scheduleSearchNavigation: syncSearchToUrl,
	} = useDebouncedSearchNavigation(navigateSearch);

	useEffect(() => {
		storeSetProjectFilters(projectFilters);
	}, [projectFilters, storeSetProjectFilters]);

	useEffect(() => {
		storeSetIncludeClosed(includeClosed);
	}, [includeClosed, storeSetIncludeClosed]);

	const projects = useMemo(
		() =>
			hostProjects.map((project) => ({
				id: project.projectKey,
				name: project.name,
			})),
		[hostProjects],
	);

	useEffect(() => {
		if (!areProjectsReady) return;
		const availableIds = new Set(projects.map((project) => project.id));
		const availableFilters = projectFilters.filter((projectId) =>
			availableIds.has(projectId),
		);
		if (availableFilters.length === projectFilters.length) return;
		cancelPendingSearchNavigation();
		navigate({
			to: "/pull-requests",
			search: buildSearch({ projects: availableFilters }),
			replace: true,
		});
	}, [
		areProjectsReady,
		buildSearch,
		cancelPendingSearchNavigation,
		navigate,
		projectFilters,
		projects,
	]);

	const handleSearchChange = useCallback(
		(query: string) => {
			setSearchQuery(query);
			storeSetSearch(query);
			syncSearchToUrl(query);
		},
		[storeSetSearch, syncSearchToUrl],
	);

	const handleProjectFiltersChange = (projects: string[]) => {
		cancelPendingSearchNavigation();
		storeSetProjectFilters(projects);
		navigate({
			to: "/pull-requests",
			search: buildSearch({ projects }),
			replace: true,
		});
	};

	const handleIncludeClosedChange = (nextIncludeClosed: boolean) => {
		cancelPendingSearchNavigation();
		storeSetIncludeClosed(nextIncludeClosed);
		navigate({
			to: "/pull-requests",
			search: buildSearch({ includeClosed: nextIncludeClosed }),
			replace: true,
		});
	};

	return (
		<div
			data-pull-requests-view
			className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
		>
			<PullRequestsTopBar
				searchQuery={searchQuery}
				onSearchChange={handleSearchChange}
				projectFilters={projectFilters}
				onProjectFiltersChange={handleProjectFiltersChange}
				includeClosed={includeClosed}
				onIncludeClosedChange={handleIncludeClosedChange}
			/>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				<PullRequestsContent
					projectFilters={projectFilters}
					projectTargets={projectTargets}
					areProjectsReady={areProjectsReady}
					hasProjects={projects.length > 0}
					searchQuery={searchQuery}
					includeClosed={includeClosed}
				/>
			</div>
		</div>
	);
}
