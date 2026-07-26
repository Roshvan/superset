import { Tabs, TabsList, TabsTrigger } from "@superset/ui/tabs";

interface OpenClosedFilterProps {
	includeClosed: boolean;
	onChange: (includeClosed: boolean) => void;
}

export function OpenClosedFilter({
	includeClosed,
	onChange,
}: OpenClosedFilterProps) {
	return (
		<div className="flex items-center gap-2">
			<span className="text-xs text-muted-foreground">State</span>
			<Tabs
				value={includeClosed ? "all" : "open"}
				onValueChange={(value) => onChange(value === "all")}
				className="flex-row gap-0"
			>
				<TabsList className="h-8 rounded-md bg-muted/50 p-0.5">
					<TabsTrigger
						value="open"
						className="h-7 rounded-sm px-2 text-xs shadow-none data-[state=active]:shadow-none"
					>
						Open
					</TabsTrigger>
					<TabsTrigger
						value="all"
						className="h-7 rounded-sm px-2 text-xs shadow-none data-[state=active]:shadow-none"
					>
						All
					</TabsTrigger>
				</TabsList>
			</Tabs>
		</div>
	);
}
