import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "@superset/ui/context-menu";
import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { type ReactNode, useState } from "react";
import {
	LuArrowRightLeft,
	LuArrowUp,
	LuFolderPlus,
	LuTrash2,
	LuX,
} from "react-icons/lu";
import { useDashboardSidebarState } from "renderer/routes/_authenticated/hooks/useDashboardSidebarState";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { useDashboardSidebarHover } from "../../../../providers/DashboardSidebarHoverProvider";
import { useDashboardSidebarSelection } from "../../../../providers/DashboardSidebarSelectionProvider";
import type { DashboardSidebarWorkspace } from "../../../../types";
import { workspaceIdsForSectionMove } from "../../../../utils/bulkWorkspaceActions";
import { DashboardSidebarBulkDeleteDialog } from "../../../DashboardSidebarBulkDeleteDialog";
import { useDashboardSidebarSectionRename } from "../../../DashboardSidebarSectionRenameContext";
import { useWorkspaceBulkMenuScope } from "./WorkspaceBulkMenuScope";

interface DashboardSidebarWorkspaceBulkContextMenuProps {
	children: ReactNode;
}

export function DashboardSidebarWorkspaceBulkContextMenu({
	children,
}: DashboardSidebarWorkspaceBulkContextMenuProps) {
	const scope = useWorkspaceBulkMenuScope();
	const collections = useCollections();
	const { setContextMenuOpen } = useDashboardSidebarHover();
	const { createSection, moveWorkspaceToSection } = useDashboardSidebarState();
	const { requestSectionRename } = useDashboardSidebarSectionRename();
	const { clearSelection, removeSelectedWorkspaces, selectedWorkspaceIds } =
		useDashboardSidebarSelection();
	const [deleteTargets, setDeleteTargets] = useState<
		DashboardSidebarWorkspace[]
	>([]);
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
	const projectId = scope?.projectId ?? "";
	const selectedWorkspaces = selectedWorkspaceIds.flatMap((workspaceId) => {
		const workspace = scope?.workspacesById.get(workspaceId);
		return workspace ? [workspace] : [];
	});
	const groupedWorkspaceIds = selectedWorkspaceIds.filter((workspaceId) =>
		scope?.sectionIdByWorkspaceId.has(workspaceId),
	);

	const { data: sections = [] } = useLiveQuery(
		(q) =>
			q
				.from({ sidebarSections: collections.v2SidebarSections })
				.where(({ sidebarSections }) =>
					eq(sidebarSections.projectId, projectId),
				)
				.orderBy(({ sidebarSections }) => sidebarSections.tabOrder, "asc")
				.select(({ sidebarSections }) => ({
					id: sidebarSections.sectionId,
					name: sidebarSections.name,
					color: sidebarSections.color,
				})),
		[collections, projectId],
	);

	if (!scope) return children;

	const selectedIds = selectedWorkspaces.map((workspace) => workspace.id);
	const count = selectedWorkspaces.length;
	const workspaceLabel = count === 1 ? "Workspace" : "Workspaces";

	const moveSelectionToSection = (sectionId: string) => {
		for (const workspaceId of workspaceIdsForSectionMove(
			selectedIds,
			scope.sectionIdByWorkspaceId,
			sectionId,
		)) {
			moveWorkspaceToSection(workspaceId, projectId, sectionId);
		}
		clearSelection();
	};

	const createGroupFromSelection = () => {
		const sectionId = createSection(projectId);
		for (const workspaceId of selectedIds) {
			moveWorkspaceToSection(workspaceId, projectId, sectionId);
		}
		clearSelection();
		requestSectionRename(sectionId);
	};

	const ungroupSelection = () => {
		for (const workspaceId of groupedWorkspaceIds) {
			moveWorkspaceToSection(workspaceId, projectId, null);
		}
		clearSelection();
	};

	return (
		<>
			<ContextMenu onOpenChange={setContextMenuOpen}>
				<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
				<ContextMenuContent
					onCloseAutoFocus={(event) => event.preventDefault()}
				>
					<ContextMenuSub>
						<ContextMenuSubTrigger>
							<LuArrowRightLeft className="size-4 mr-2" />
							Move {count} to Group
						</ContextMenuSubTrigger>
						<ContextMenuSubContent>
							<ContextMenuItem onSelect={createGroupFromSelection}>
								<LuFolderPlus className="size-4 mr-2" />
								New group
							</ContextMenuItem>
							{sections.length > 0 && <ContextMenuSeparator />}
							{sections.map((section) => (
								<ContextMenuItem
									key={section.id}
									onSelect={() => moveSelectionToSection(section.id)}
								>
									{section.color && (
										<span
											className="size-2 shrink-0 rounded-full mr-2"
											style={{ backgroundColor: section.color }}
										/>
									)}
									{section.name}
								</ContextMenuItem>
							))}
						</ContextMenuSubContent>
					</ContextMenuSub>
					{groupedWorkspaceIds.length > 0 && (
						<ContextMenuItem onSelect={ungroupSelection}>
							<LuArrowUp className="size-4 mr-2" />
							Ungroup
						</ContextMenuItem>
					)}
					<ContextMenuSeparator />
					<ContextMenuItem
						onSelect={() => {
							setDeleteTargets(selectedWorkspaces);
							setIsDeleteDialogOpen(true);
						}}
						className="text-destructive focus:text-destructive"
					>
						<LuTrash2 className="size-4 mr-2 text-destructive" />
						Delete {count} {workspaceLabel}
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem onSelect={clearSelection}>
						<LuX className="size-4 mr-2" />
						Clear Selection
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>

			<DashboardSidebarBulkDeleteDialog
				workspaces={deleteTargets}
				open={isDeleteDialogOpen}
				onOpenChange={(open) => {
					setIsDeleteDialogOpen(open);
					if (!open) setDeleteTargets([]);
				}}
				onDeleted={removeSelectedWorkspaces}
			/>
		</>
	);
}
