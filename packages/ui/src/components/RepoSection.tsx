import { Box, Flex, Heading, Link, Text, Separator } from "@radix-ui/themes";
import { KanbanColumn } from "./KanbanColumn";
import type { Session, SessionStatus } from "../data/schema";

const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour - match daemon setting

/**
 * Get effective status based on elapsed time since last activity.
 * Sessions inactive for 1 hour are considered idle regardless of stored status.
 */
function getEffectiveStatus(session: Session): SessionStatus {
  const elapsed = Date.now() - new Date(session.lastActivityAt).getTime();
  if (elapsed > IDLE_TIMEOUT_MS) {
    return "idle";
  }
  return session.status;
}

interface RepoSectionProps {
  repoId: string;
  repoUrl: string | null;
  sessions: Session[];
  activityScore: number;
  onSessionClick?: (sessionId: string) => void;
}

export function RepoSection({ repoId, repoUrl, sessions, activityScore, onSessionClick }: RepoSectionProps) {
  // Use effective status to categorize sessions (accounts for time-based idle)
  const working = sessions.filter((s) => getEffectiveStatus(s) === "working");
  const needsApproval = sessions.filter(
    (s) => getEffectiveStatus(s) === "waiting" && s.hasPendingToolUse
  );
  const waiting = sessions.filter(
    (s) => getEffectiveStatus(s) === "waiting" && !s.hasPendingToolUse
  );
  const idle = sessions.filter((s) => getEffectiveStatus(s) === "idle");

  const isHot = activityScore > 50;

  return (
    <Box mb="7">
      <Flex align="center" gap="3" mb="4">
        <Heading size="6" weight="bold">
          {repoId === "Other" ? (
            <Text color="gray">Other</Text>
          ) : repoUrl ? (
            <Link href={repoUrl} target="_blank" color="violet" highContrast>
              {repoId}
            </Link>
          ) : (
            repoId
          )}
        </Heading>
        {isHot && (
          <Text size="2" color="orange">
            🔥
          </Text>
        )}
        <Text size="2" color="gray">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""}
        </Text>
      </Flex>

      <Flex gap="3" style={{ minHeight: 240 }}>
        <KanbanColumn
          title="Working"
          status="working"
          sessions={working}
          color="green"
          onSessionClick={onSessionClick}
        />
        <KanbanColumn
          title="Needs Approval"
          status="needs-approval"
          sessions={needsApproval}
          color="orange"
          onSessionClick={onSessionClick}
        />
        <KanbanColumn
          title="Waiting"
          status="waiting"
          sessions={waiting}
          color="yellow"
          onSessionClick={onSessionClick}
        />
        <KanbanColumn
          title="Idle"
          status="idle"
          sessions={idle}
          color="gray"
          onSessionClick={onSessionClick}
        />
      </Flex>

      <Separator size="4" mt="6" />
    </Box>
  );
}
