import { createFileRoute } from "@tanstack/react-router";
import {
  Flex,
  Text,
  Box,
  Button,
  Code,
  IconButton,
  Tooltip,
} from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { RepoSection } from "../components/RepoSection";
import { useSessions, groupSessionsByRepo } from "../hooks/useSessions";
import { useColumnChangeSound } from "../hooks/useColumnChangeSound";
import { playColumnSound } from "../sounds/columnSounds";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function Soundboard() {
  const [isVisible, setIsVisible] = useState(true);

  return (
    <Box mb="4">
      <Flex align="center" gap="2" mb={isVisible ? "2" : "0"}>
        <Text size="2" weight="medium" color="gray">
          Soundboard
        </Text>
        <Tooltip
          content="To customize sounds, ask Claude: Change the [column] sound to [description]"
          maxWidth="300px"
        >
          <Box
            asChild
            style={{
              color: "var(--gray-a11)",
              cursor: "help",
              display: "flex",
            }}
          >
            <span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 15 15"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M7.49991 0.876892C3.84222 0.876892 0.877075 3.84204 0.877075 7.49972C0.877075 11.1574 3.84222 14.1226 7.49991 14.1226C11.1576 14.1226 14.1227 11.1574 14.1227 7.49972C14.1227 3.84204 11.1576 0.876892 7.49991 0.876892ZM1.82707 7.49972C1.82707 4.36671 4.36689 1.82689 7.49991 1.82689C10.6329 1.82689 13.1727 4.36671 13.1727 7.49972C13.1727 10.6327 10.6329 13.1726 7.49991 13.1726C4.36689 13.1726 1.82707 10.6327 1.82707 7.49972ZM8.24992 4.49999C8.24992 4.9142 7.91413 5.24999 7.49992 5.24999C7.08571 5.24999 6.74992 4.9142 6.74992 4.49999C6.74992 4.08577 7.08571 3.74999 7.49992 3.74999C7.91413 3.74999 8.24992 4.08577 8.24992 4.49999ZM6.00003 5.99999H6.50003H7.50003C7.77618 5.99999 8.00003 6.22384 8.00003 6.49999V9.99999H8.50003H9.00003V11H8.50003H7.50003H6.50003H6.00003V9.99999H6.50003H7.00003V6.99999H6.50003H6.00003V5.99999Z"
                  fill="currentColor"
                  fillRule="evenodd"
                  clipRule="evenodd"
                />
              </svg>
            </span>
          </Box>
        </Tooltip>
        <IconButton
          size="1"
          variant="ghost"
          color="gray"
          onClick={() => setIsVisible(!isVisible)}
        >
          {isVisible ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 15 15"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M3.13523 6.15803C3.3241 5.95657 3.64052 5.94637 3.84197 6.13523L7.5 9.56464L11.158 6.13523C11.3595 5.94637 11.6759 5.95657 11.8648 6.15803C12.0536 6.35949 12.0434 6.67591 11.842 6.86477L7.84197 10.6148C7.64964 10.7951 7.35036 10.7951 7.15803 10.6148L3.15803 6.86477C2.95657 6.67591 2.94637 6.35949 3.13523 6.15803Z"
                fill="currentColor"
                fillRule="evenodd"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 15 15"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M6.1584 3.13508C6.35985 2.94621 6.67627 2.95642 6.86514 3.15788L10.6151 7.15788C10.7954 7.3502 10.7954 7.64949 10.6151 7.84182L6.86514 11.8418C6.67627 12.0433 6.35985 12.0535 6.1584 11.8646C5.95694 11.6757 5.94673 11.3593 6.1356 11.1579L9.565 7.49985L6.1356 3.84182C5.94673 3.64036 5.95694 3.32394 6.1584 3.13508Z"
                fill="currentColor"
                fillRule="evenodd"
                clipRule="evenodd"
              />
            </svg>
          )}
        </IconButton>
      </Flex>
      {isVisible && (
        <Flex gap="2">
          <Button
            size="1"
            color="green"
            variant="soft"
            onClick={() => playColumnSound("working")}
          >
            Working
          </Button>
          <Button
            size="1"
            color="orange"
            variant="soft"
            onClick={() => playColumnSound("needs-approval")}
          >
            Needs Approval
          </Button>
          <Button
            size="1"
            color="yellow"
            variant="soft"
            onClick={() => playColumnSound("waiting")}
          >
            Waiting
          </Button>
          <Button
            size="1"
            color="gray"
            variant="soft"
            onClick={() => playColumnSound("idle")}
          >
            Idle
          </Button>
        </Flex>
      )}
    </Box>
  );
}

function IndexPage() {
  const { sessions } = useSessions();

  // Force re-render every minute to update relative times and activity scores
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Play sounds when sessions change columns
  useColumnChangeSound(sessions);

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
    <Flex direction="column">
      <Soundboard />
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
  );
}
