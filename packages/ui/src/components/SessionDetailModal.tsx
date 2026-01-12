import { Dialog, Flex, Heading, Text, Box, Badge, Code, Separator, Blockquote, ScrollArea } from "@radix-ui/themes";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Session } from "../data/schema";

const codeTheme = {
  ...oneDark,
  'comment': { ...oneDark['comment'], color: '#8b949e' },
  'prolog': { ...oneDark['prolog'], color: '#8b949e' },
  'doctype': { ...oneDark['doctype'], color: '#8b949e' },
  'cdata': { ...oneDark['cdata'], color: '#8b949e' },
};

interface SessionDetailModalProps {
  session: Session | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getRoleColor(role: "user" | "assistant" | "tool"): string {
  switch (role) {
    case "user":
      return "var(--blue-11)";
    case "assistant":
      return "var(--gray-12)";
    case "tool":
      return "var(--violet-11)";
  }
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

export function SessionDetailModal({ session, open, onOpenChange }: SessionDetailModalProps) {
  if (!session) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        style={{ maxWidth: "95vw", width: 600, maxHeight: "90vh" }}
      >
        <Dialog.Title mb="2">
          {session.goal || session.originalPrompt.slice(0, 60)}
        </Dialog.Title>

        <Dialog.Description size="2" mb="4">
          {session.cwd.replace(/^\/Users\/\w+\//, "~/")}
        </Dialog.Description>

        <ScrollArea style={{ maxHeight: "60vh" }}>
          <Flex direction="column" gap="3">
            {/* Recent output */}
            <Box
              p="3"
              style={{
                backgroundColor: "var(--gray-2)",
                borderRadius: "var(--radius-3)",
              }}
            >
              {session.recentOutput?.length > 0 ? (
                session.recentOutput.map((output, i) => (
                  <Box
                    key={i}
                    style={{ color: getRoleColor(output.role) }}
                    className="markdown-content"
                  >
                    {output.role === "user" && (
                      <>
                        <Separator size="4" color="blue" mb="4" />
                        <Text as="p" size="1" weight="medium" mb="3">
                          You:
                        </Text>
                      </>
                    )}
                    <Markdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: ({ children }) => (
                          <Text as="p" size="1" mb="4">
                            {children}
                          </Text>
                        ),
                        code: ({ className, children }) => {
                          const match = /language-(\w+)/.exec(className || "");
                          const isBlock = Boolean(match);
                          return isBlock ? (
                            <SyntaxHighlighter
                              style={codeTheme}
                              language={match![1]}
                              PreTag="div"
                              customStyle={{
                                margin: 0,
                                borderRadius: "var(--radius-2)",
                                fontSize: "var(--font-size-1)",
                              }}
                            >
                              {String(children).replace(/\n$/, "")}
                            </SyntaxHighlighter>
                          ) : (
                            <Code size="1">{children}</Code>
                          );
                        },
                        pre: ({ children }) => <Box mb="4">{children}</Box>,
                        ul: ({ children }) => (
                          <ul
                            style={{
                              paddingLeft: "var(--space-5)",
                              marginBottom: "var(--space-4)",
                              listStyleType: "disc",
                            }}
                          >
                            {children}
                          </ul>
                        ),
                        ol: ({ children }) => (
                          <ol
                            style={{
                              paddingLeft: "var(--space-5)",
                              marginBottom: "var(--space-4)",
                              listStyleType: "decimal",
                            }}
                          >
                            {children}
                          </ol>
                        ),
                        li: ({ children }) => (
                          <li
                            style={{
                              marginBottom: "var(--space-1)",
                              fontSize: "var(--font-size-1)",
                            }}
                          >
                            {children}
                          </li>
                        ),
                        h1: ({ children }) => (
                          <Heading size="3" mb="4">
                            {children}
                          </Heading>
                        ),
                        h2: ({ children }) => (
                          <Heading size="2" mb="4">
                            {children}
                          </Heading>
                        ),
                        h3: ({ children }) => (
                          <Heading size="1" mb="4">
                            {children}
                          </Heading>
                        ),
                        blockquote: ({ children }) => (
                          <Blockquote size="1" mb="4">
                            {children}
                          </Blockquote>
                        ),
                        a: ({ href, children }) => (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {output.content}
                    </Markdown>
                    {output.role === "user" && (
                      <Separator size="4" color="blue" my="4" />
                    )}
                  </Box>
                ))
              ) : (
                <Text size="1" color="gray">
                  No recent output
                </Text>
              )}
              {session.status === "working" && (
                <Text color="grass" size="1">
                  █
                </Text>
              )}
            </Box>

            {/* PR Info if available */}
            {session.pr && (
              <Box>
                <Flex align="center" gap="2" mb="2">
                  <a
                    href={session.pr.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: "var(--font-size-1)", fontWeight: 500 }}
                  >
                    PR #{session.pr.number}: {session.pr.title}
                  </a>
                </Flex>
                {session.pr.ciChecks.length > 0 && (
                  <Flex gap="2" wrap="wrap">
                    {session.pr.ciChecks.map((check) => (
                      <Badge
                        key={check.name}
                        color={getCIStatusColor(check.status)}
                        variant="soft"
                        size="1"
                      >
                        {getCIStatusIcon(check.status)}{" "}
                        {check.name.slice(0, 20)}
                      </Badge>
                    ))}
                  </Flex>
                )}
              </Box>
            )}

            {/* Session metadata */}
            <Flex justify="between">
              <Text size="1" color="gray">
                {session.messageCount} messages
              </Text>
              <Text size="1" color="gray">
                {session.sessionId.slice(0, 8)}
              </Text>
            </Flex>
          </Flex>
        </ScrollArea>
      </Dialog.Content>
    </Dialog.Root>
  );
}
