import {
	type UseQueryOptions,
	type UseQueryResult,
	useQueries,
} from "@tanstack/react-query";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { combineQueryResults } from "renderer/routes/_authenticated/_dashboard/utils/mergePaginatedProjectRows";
import type { ProjectQueryTarget } from "../useProjectQueryTargets";

interface PaginatedQueryData {
	hasNextPage: boolean;
}

export interface PaginatedProjectQueryTarget {
	target: ProjectQueryTarget;
	page: number;
}

interface MultiRepoProjectPaginationOptions<TData extends PaginatedQueryData> {
	projectTargets: ProjectQueryTarget[];
	resetKey: string;
	getQueryOptions: (
		queryTarget: PaginatedProjectQueryTarget,
	) => UseQueryOptions<TData | null, Error>;
}

interface MultiRepoProjectPaginationResult<TData extends PaginatedQueryData> {
	queries: UseQueryResult<TData | null, Error>[];
	queryTargets: PaginatedProjectQueryTarget[];
	isFetching: boolean;
	isFetchingNextPage: boolean;
	hasNextPage: boolean;
	error: Error | null;
	refetch: () => Promise<unknown[]>;
	scrollRef: RefObject<HTMLDivElement | null>;
	sentinelRef: RefObject<HTMLDivElement | null>;
}

export function buildPaginatedProjectQueryTargets(
	projectTargets: ProjectQueryTarget[],
	pageCountByProject: Readonly<Record<string, number>>,
): PaginatedProjectQueryTarget[] {
	return projectTargets.flatMap((target) => {
		const pageCount = pageCountByProject[target.projectId] ?? 1;
		return Array.from({ length: pageCount }, (_, index) => ({
			target,
			page: index + 1,
		}));
	});
}

export function useMultiRepoProjectPagination<
	TData extends PaginatedQueryData,
>({
	projectTargets,
	resetKey,
	getQueryOptions,
}: MultiRepoProjectPaginationOptions<TData>): MultiRepoProjectPaginationResult<TData> {
	const projectTargetsKey = projectTargets
		.map(({ projectId, hostUrl }) => `${projectId}:${hostUrl ?? ""}`)
		.join("\0");
	const paginationKey = `${projectTargetsKey}\0${resetKey}`;
	const [pagination, setPagination] = useState<{
		key: string;
		pageCountByProject: Record<string, number>;
	}>({ key: paginationKey, pageCountByProject: {} });
	const pageCountByProject =
		pagination.key === paginationKey ? pagination.pageCountByProject : {};
	const queryTargets = useMemo(
		() => buildPaginatedProjectQueryTargets(projectTargets, pageCountByProject),
		[pageCountByProject, projectTargets],
	);
	const queryOptions = queryTargets.map(getQueryOptions);
	const queries = useQueries({
		queries: queryOptions,
		combine: combineQueryResults,
	});
	const isFetching = queries.some((query) => query.isFetching);
	const error = queries.find((query) => query.error)?.error ?? null;
	const latestProjectQueries = projectTargets.map((target) => {
		const page = pageCountByProject[target.projectId] ?? 1;
		const index = queryTargets.findIndex(
			(queryTarget) =>
				queryTarget.target.projectId === target.projectId &&
				queryTarget.page === page,
		);
		return { target, page, query: queries[index] };
	});
	const isFetchingNextPage = latestProjectQueries.some(
		({ page, query }) => page > 1 && query?.isFetching,
	);
	const expandableProjectIds = latestProjectQueries.flatMap(
		({ target, query }) => (query?.data?.hasNextPage ? [target.projectId] : []),
	);
	const expandableProjectIdsRef = useRef(expandableProjectIds);
	expandableProjectIdsRef.current = expandableProjectIds;
	const expandableProjectIdsKey = expandableProjectIds.join("\0");
	const hasNextPage = expandableProjectIdsKey.length > 0;
	const scrollRef = useRef<HTMLDivElement>(null);
	const sentinelRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const sentinel = sentinelRef.current;
		const scrollContainer = scrollRef.current;
		if (
			!sentinel ||
			!scrollContainer ||
			!expandableProjectIdsKey ||
			isFetchingNextPage
		) {
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries[0]?.isIntersecting) return;
				setPagination((current) => {
					const currentPageCounts =
						current.key === paginationKey ? current.pageCountByProject : {};
					const next = { ...currentPageCounts };
					for (const projectId of expandableProjectIdsRef.current) {
						next[projectId] = (currentPageCounts[projectId] ?? 1) + 1;
					}
					return { key: paginationKey, pageCountByProject: next };
				});
			},
			{ root: scrollContainer, rootMargin: "200px" },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [expandableProjectIdsKey, isFetchingNextPage, paginationKey]);

	return {
		queries,
		queryTargets,
		isFetching,
		isFetchingNextPage,
		hasNextPage,
		error,
		refetch: () => Promise.all(queries.map((query) => query.refetch())),
		scrollRef,
		sentinelRef,
	};
}
