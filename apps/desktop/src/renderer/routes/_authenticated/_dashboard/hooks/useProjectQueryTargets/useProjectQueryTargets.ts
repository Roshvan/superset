import { useMemo } from "react";
import { useHostProjects } from "renderer/hooks/host-projects/useHostProjects";
import { useHostUrls } from "renderer/hooks/host-service/useHostTargetUrl";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { selectServingHostId } from "../useProjectHost/useProjectHost";

export interface ProjectQueryTarget {
	projectId: string;
	projectName: string;
	hostId: string | null;
	hostUrl: string | null;
}

export function useProjectQueryTargets(projectFilters: string[]) {
	const { projects, isReady } = useHostProjects();
	const { machineId } = useLocalHostService();
	const selectedProjects = useMemo(() => {
		if (projectFilters.length === 0) return projects;
		const selected = new Set(projectFilters);
		return projects.filter((project) => selected.has(project.projectKey));
	}, [projectFilters, projects]);
	const selectedHostIds = useMemo(
		() =>
			Array.from(
				new Set(
					selectedProjects
						.map((project) => selectServingHostId(project.hostIds, machineId))
						.filter((hostId): hostId is string => hostId !== null),
				),
			),
		[selectedProjects, machineId],
	);
	const hostUrls = useHostUrls(selectedHostIds);
	const hostUrlById = useMemo(
		() => new Map(hostUrls.map((target) => [target.hostId, target.url])),
		[hostUrls],
	);
	const targets = useMemo<ProjectQueryTarget[]>(
		() =>
			selectedProjects.map((project) => {
				const hostId = selectServingHostId(project.hostIds, machineId);
				return {
					projectId: project.projectKey,
					projectName: project.name,
					hostId,
					hostUrl: hostId ? (hostUrlById.get(hostId) ?? null) : null,
				};
			}),
		[selectedProjects, machineId, hostUrlById],
	);

	return { projects, targets, isReady };
}
