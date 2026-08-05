import { createFileRoute } from "@tanstack/react-router";
import { parseProjectFilterParam } from "renderer/routes/_authenticated/_dashboard/components/ProjectFilter/project-filter-utils";
import { PullRequestsView } from "./components/PullRequestsView";
import { Route as PullRequestsLayoutRoute } from "./layout";

export const Route = createFileRoute(
	"/_authenticated/_dashboard/pull-requests/",
)({
	component: PullRequestsPage,
});

function PullRequestsPage() {
	const { search, project, projects, state } =
		PullRequestsLayoutRoute.useSearch();

	return (
		<PullRequestsView
			initialSearch={search}
			initialProjects={
				projects !== undefined
					? parseProjectFilterParam(projects)
					: project
						? [project]
						: undefined
			}
			initialState={state}
		/>
	);
}
