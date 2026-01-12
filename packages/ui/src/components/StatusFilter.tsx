import { Flex, Badge } from "@radix-ui/themes";

type FilterStatus = "all" | "working" | "needs-approval" | "waiting" | "idle";

interface StatusFilterProps {
  activeFilter: FilterStatus;
  onFilterChange: (filter: FilterStatus) => void;
  counts: Record<FilterStatus, number>;
}

const filterConfig: Array<{
  value: FilterStatus;
  label: string;
  emoji: string;
  color: "gray" | "green" | "orange" | "yellow";
}> = [
  { value: "all", label: "All", emoji: "", color: "gray" },
  { value: "working", label: "Working", emoji: "🟢", color: "green" },
  { value: "needs-approval", label: "Approval", emoji: "🟠", color: "orange" },
  { value: "waiting", label: "Waiting", emoji: "🟡", color: "yellow" },
  { value: "idle", label: "Idle", emoji: "⚪", color: "gray" },
];

export function StatusFilter({ activeFilter, onFilterChange, counts }: StatusFilterProps) {
  return (
    <Flex gap="2" wrap="wrap" className="status-filter">
      {filterConfig.map((filter) => {
        const count = counts[filter.value];
        const isActive = activeFilter === filter.value;

        return (
          <Badge
            key={filter.value}
            color={isActive ? filter.color : "gray"}
            variant={isActive ? "solid" : "soft"}
            size="2"
            style={{ cursor: "pointer" }}
            onClick={() => onFilterChange(filter.value)}
          >
            {filter.emoji} {filter.label} {count > 0 && `(${count})`}
          </Badge>
        );
      })}
    </Flex>
  );
}

export type { FilterStatus };
