import { createFileRoute } from "@tanstack/react-router";
import { Flex, Text } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { RepoSection } from "../components/RepoSection";
import { SessionExplorer } from "../components/SessionExplorer";
import { useSessions, groupSessionsByRepo } from "../hooks/useSessions";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  const { sessions } = useSessions();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  // Force re-render every minute to update relative times and activity scores
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

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
      <Flex direction="column">
        {repoGroups.map((group) => (
          <RepoSection
            key={group.repoId}
            repoId={group.repoId}
            repoUrl={group.repoUrl}
            sessions={group.sessions}
            activityScore={group.activityScore}
            onSessionClick={setSelectedSessionId}
          />
        ))}
      </Flex>

      <SessionExplorer
        sessionId={selectedSessionId}
        onClose={() => setSelectedSessionId(null)}
      />
    </>
  );
}
