export function normalizeProjectFilters(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [
		...new Set(
			value.filter(
				(projectId): projectId is string =>
					typeof projectId === "string" && projectId.trim().length > 0,
			),
		),
	];
}

export function parseProjectFilterParam(value: string | undefined): string[] {
	if (!value) return [];
	return normalizeProjectFilters(value.split(","));
}

export function serializeProjectFilters(
	projectFilters: string[],
): string | undefined {
	return projectFilters.length > 0 ? projectFilters.join(",") : undefined;
}
