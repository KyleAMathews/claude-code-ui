import { Card, Flex, Text, Code, Badge } from "@radix-ui/themes";
import type { Session } from "../data/schema";

interface SessionCardCompactProps {
  session: Session;
  onClick?: () => void;
}

function getStatusEmoji(session: Session): string {
  if (session.status === "working") return "🟢";
  if (session.status === "waiting" && session.hasPendingToolUse) return "🟠";
  if (session.status === "waiting") return "🟡";
  return "⚪";
}

function formatTimeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

function getCIStatusColor(status: string): "green" | "red" | "yellow" | "gray" {
  switch (status) {
    case "success":
      return "green";
    case "failure":
      return "red";
    case "running":
    case "pending":
      return "yellow";
    default:
      return "gray";
  }
}

function getCIStatusIcon(status: string): string {
  switch (status) {
    case "success":
      return "✓";
    case "failure":
      return "✗";
    case "running":
    case "pending":
      return "◎";
    default:
      return "?";
  }
}

export function SessionCardCompact({ session, onClick }: SessionCardCompactProps) {
  const repoName = session.gitRepoId || "Other";
  const branch = session.gitBranch || "no branch";

  return (
    <Card
      size="2"
      className="session-card-compact"
      style={{ cursor: onClick ? "pointer" : "default" }}
      onClick={onClick}
    >
      <Flex direction="column" gap="2">
        {/* Header: status + repo/branch + time */}
        <Flex justify="between" align="center">
          <Flex align="center" gap="2">
            <Text size="2">{getStatusEmoji(session)}</Text>
            <Text size="1" color="gray" weight="medium">
              {repoName} • {branch.length > 20 ? branch.slice(0, 17) + "..." : branch}
            </Text>
          </Flex>
          <Text size="1" color="gray">
            {formatTimeAgo(session.lastActivityAt)}
          </Text>
        </Flex>

        {/* Goal/prompt */}
        <Text size="2" weight="medium" highContrast>
          {session.goal || session.originalPrompt.slice(0, 60)}
        </Text>

        {/* Summary or pending tool */}
        <Text size="1" color="gray" style={{ lineHeight: 1.4 }}>
          {session.hasPendingToolUse && session.pendingTool ? (
            <>
              ⚠️ {session.pendingTool.tool}: {session.pendingTool.target.slice(0, 40)}
            </>
          ) : (
            session.summary
          )}
        </Text>

        {/* Footer: PR/branch + message count */}
        <Flex justify="between" align="center">
          <Flex align="center" gap="2">
            {session.pr ? (
              <a
                href={session.pr.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{ textDecoration: "none" }}
              >
                <Badge
                  color={getCIStatusColor(session.pr.ciStatus)}
                  variant="soft"
                  size="1"
                >
                  {getCIStatusIcon(session.pr.ciStatus)} PR #{session.pr.number}
                </Badge>
              </a>
            ) : session.gitBranch ? (
              <Code size="1" variant="soft" color="gray">
                [{session.gitBranch.slice(0, 20)}]
              </Code>
            ) : null}
          </Flex>
          <Text size="1" color="gray">
            {session.messageCount} msgs
          </Text>
        </Flex>
      </Flex>
    </Card>
  );
}
