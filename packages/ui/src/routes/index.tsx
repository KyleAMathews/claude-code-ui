import { createFileRoute } from "@tanstack/react-router";
import { Flex, Text, Box } from "@radix-ui/themes";
import { useEffect, useState, useMemo } from "react";
import { RepoSection } from "../components/RepoSection";
import { useSessions, groupSessionsByRepo } from "../hooks/useSessions";
import { RepoDropdown, type RepoOption } from "../components/RepoDropdown";
import { StatusFilter, type FilterStatus } from "../components/StatusFilter";
import { SessionCardCompact } from "../components/SessionCardCompact";
import { SessionDetailModal } from "../components/SessionDetailModal";
import type { Session, SessionStatus } from "../data/schema";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function getEffectiveStatus(session: Session): SessionStatus | "needs-approval" {
  const elapsed = Date.now() - new Date(session.lastActivityAt).getTime();
  const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

  if (elapsed > IDLE_TIMEOUT_MS) {
    return "idle";
  }
  if (session.status === "waiting" && session.hasPendingToolUse) {
    return "needs-approval";
  }
  return session.status;
}

function IndexPage() {
  const { sessions } = useSessions();
  const [selectedRepo, setSelectedRepo] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);

  // Force re-render every minute to update relative times and activity scores
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Build repo options for dropdown
  const repoOptions = useMemo((): RepoOption[] => {
    const repoMap = new Map<string, RepoOption>();

    sessions.forEach((session) => {
      const repoId = session.gitRepoId || "Other";
      if (!repoMap.has(repoId)) {
        repoMap.set(repoId, {
          repoId,
          repoUrl: session.gitRepoUrl,
          sessionCount: 0,
          statuses: new Set(),
        });
      }

      const repo = repoMap.get(repoId)!;
      repo.sessionCount++;
      repo.statuses.add(getEffectiveStatus(session));
    });

    return Array.from(repoMap.values()).sort((a, b) =>
      b.sessionCount - a.sessionCount
    );
  }, [sessions]);

  // Filter sessions for mobile view
  const filteredSessions = useMemo(() => {
    let filtered = sessions;

    // Filter by repo
    if (selectedRepo !== "all") {
      filtered = filtered.filter((s) =>
        (s.gitRepoId || "Other") === selectedRepo
      );
    }

    // Filter by status
    if (statusFilter !== "all") {
      filtered = filtered.filter((s) =>
        getEffectiveStatus(s) === statusFilter
      );
    }

    // Sort by last activity
    return filtered.sort((a, b) =>
      new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
    );
  }, [sessions, selectedRepo, statusFilter]);

  // Calculate status counts for filter badges
  const statusCounts = useMemo(() => {
    const base = selectedRepo === "all" ? sessions :
      sessions.filter((s) => (s.gitRepoId || "Other") === selectedRepo);

    return {
      all: base.length,
      working: base.filter((s) => getEffectiveStatus(s) === "working").length,
      "needs-approval": base.filter((s) => getEffectiveStatus(s) === "needs-approval").length,
      waiting: base.filter((s) => getEffectiveStatus(s) === "waiting").length,
      idle: base.filter((s) => getEffectiveStatus(s) === "idle").length,
    };
  }, [sessions, selectedRepo]);

  if (sessions.length === 0) {
    return (
      <Flex direction="column" align="center" gap="3" py="9">
        <Text color="gray" size="3">
          No sessions found
        </Text>
        <Text color="gray" size="2">
          Start a Claude Code session to see it here
        </Text>
      </Flex>
    );
  }

  const repoGroups = groupSessionsByRepo(sessions);

  return (
    <>
      {/* Mobile view */}
      <Box className="mobile-view">
        <Flex direction="column" gap="3" p="3">
          {/* Repo dropdown */}
          <RepoDropdown
            repos={repoOptions}
            selectedRepo={selectedRepo}
            onSelectRepo={setSelectedRepo}
          />

          {/* Status filter chips */}
          <StatusFilter
            activeFilter={statusFilter}
            onFilterChange={setStatusFilter}
            counts={statusCounts}
          />

          {/* Session list */}
          <Flex direction="column" gap="2">
            {filteredSessions.length === 0 ? (
              <Text color="gray" size="2" align="center" py="9">
                No sessions match the current filters
              </Text>
            ) : (
              filteredSessions.map((session) => (
                <SessionCardCompact
                  key={session.sessionId}
                  session={session}
                  onClick={() => setSelectedSession(session)}
                />
              ))
            )}
          </Flex>
        </Flex>
      </Box>

      {/* Desktop view (original Kanban) */}
      <Flex direction="column" className="desktop-view">
        {repoGroups.map((group) => (
          <RepoSection
            key={group.repoId}
            repoId={group.repoId}
            repoUrl={group.repoUrl}
            sessions={group.sessions}
            activityScore={group.activityScore}
          />
        ))}
      </Flex>

      {/* Session detail modal (mobile only) */}
      <SessionDetailModal
        session={selectedSession}
        open={selectedSession !== null}
        onOpenChange={(open) => !open && setSelectedSession(null)}
      />
    </>
  );
}
