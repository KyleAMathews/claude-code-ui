import { Select } from "@radix-ui/themes";

interface RepoOption {
  repoId: string;
  repoUrl: string | null;
  sessionCount: number;
  statuses: Set<string>; // 'working', 'waiting', 'idle', 'needs-approval'
}

interface RepoDropdownProps {
  repos: RepoOption[];
  selectedRepo: string;
  onSelectRepo: (repoId: string) => void;
}

function getStatusEmojis(statuses: Set<string>): string {
  const emojis: string[] = [];
  if (statuses.has("working")) emojis.push("🟢");
  if (statuses.has("needs-approval")) emojis.push("🟠");
  if (statuses.has("waiting")) emojis.push("🟡");
  if (statuses.has("idle") && emojis.length === 0) emojis.push("⚪");
  return emojis.join("");
}

export function RepoDropdown({ repos, selectedRepo, onSelectRepo }: RepoDropdownProps) {
  return (
    <Select.Root value={selectedRepo} onValueChange={onSelectRepo}>
      <Select.Trigger
        className="mobile-dropdown-trigger"
        style={{ width: "100%" }}
      />
      <Select.Content>
        <Select.Item value="all">All Repos</Select.Item>
        {repos.map((repo) => (
          <Select.Item key={repo.repoId} value={repo.repoId}>
            {getStatusEmojis(repo.statuses)} {repo.repoId} ({repo.sessionCount})
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

export type { RepoOption };
