import { createFileRoute } from "@tanstack/react-router";
import { resolveProjectFilterParams } from "renderer/routes/_authenticated/_dashboard/components/ProjectFilter/project-filter-utils";
import { PullRequestsView } from "./components/PullRequestsView";
import { Route as PullRequestsLayoutRoute } from "./layout";

export const Route = createFileRoute(
	"/_authenticated/_dashboard/pull-requests/",
)({
	component: PullRequestsPage,
});

function PullRequestsPage() {
	const { search, project, projects, author, state } =
		PullRequestsLayoutRoute.useSearch();

	return (
		<PullRequestsView
			initialSearch={search}
			initialProjects={resolveProjectFilterParams(projects, project, undefined)}
			initialAuthor={author}
			initialState={state}
		/>
	);
}
