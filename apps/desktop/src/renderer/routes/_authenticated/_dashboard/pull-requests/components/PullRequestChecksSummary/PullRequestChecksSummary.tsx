import { cn } from "@superset/ui/utils";
import { LuCheck, LuCircleMinus, LuLoaderCircle, LuX } from "react-icons/lu";
import {
	type PullRequestCheck,
	summarizePullRequestChecks,
} from "../pull-request-checks";

interface PullRequestChecksSummaryProps {
	checks: PullRequestCheck[];
}

const STATUS_CONFIG = {
	success: {
		Icon: LuCheck,
		className: "text-emerald-600 dark:text-emerald-400",
	},
	failure: { Icon: LuX, className: "text-red-600 dark:text-red-400" },
	pending: {
		Icon: LuLoaderCircle,
		className: "text-amber-600 dark:text-amber-400",
	},
	none: { Icon: LuCircleMinus, className: "text-muted-foreground" },
} as const;

export function PullRequestChecksSummary({
	checks,
}: PullRequestChecksSummaryProps) {
	const summary = summarizePullRequestChecks(checks);
	const { Icon, className } = STATUS_CONFIG[summary.status];
	const label =
		summary.status === "none"
			? "No checks reported"
			: summary.status === "success"
				? `All ${summary.relevantChecks.length} checks passed`
				: summary.status === "failure"
					? `${summary.failing} of ${summary.relevantChecks.length} checks failed`
					: `${summary.pending} of ${summary.relevantChecks.length} checks running`;

	return (
		<output
			className={cn("flex shrink-0 items-center gap-1.5 text-xs", className)}
			title={label}
			aria-label={label}
		>
			<Icon
				className={cn(
					"size-3.5",
					summary.status === "pending" &&
						"animate-spin motion-reduce:animate-none",
				)}
			/>
			<span className="hidden tabular-nums @lg:inline">
				{summary.status === "none"
					? "No checks"
					: `${summary.passing}/${summary.relevantChecks.length}`}
			</span>
		</output>
	);
}
