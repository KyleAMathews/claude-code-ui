import { useState, useEffect } from "react";
import {
  Dialog,
  Flex,
  Text,
  Code,
  Box,
  Heading,
  ScrollArea,
  Badge,
  IconButton,
  Separator,
} from "@radix-ui/themes";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

// Customize oneDark for better contrast
const codeTheme = {
  ...oneDark,
  comment: { ...oneDark["comment"], color: "#8b949e" },
};

interface SessionEntry {
  type: "user" | "assistant" | "tool_result" | "system";
  content?: string | ContentBlock[];
  results?: { toolUseId: string; content: string | unknown }[];
  timestamp?: string;
  model?: string;
}

interface ContentBlock {
  type: "text" | "tool_use" | "thinking";
  text?: string;
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
  id?: string;
}

interface FullSession {
  sessionId: string;
  cwd: string;
  gitBranch: string | null;
  originalPrompt: string;
  entries: SessionEntry[];
}

interface SessionExplorerProps {
  sessionId: string | null;
  onClose: () => void;
}

const API_BASE = "http://127.0.0.1:4451";

export function SessionExplorer({ sessionId, onClose }: SessionExplorerProps) {
  const [session, setSession] = useState<FullSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`${API_BASE}/api/sessions/${sessionId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load session");
        return res.json();
      })
      .then((data) => {
        setSession(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [sessionId]);

  return (
    <Dialog.Root open={!!sessionId} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content
        style={{ maxWidth: 900, width: "90vw", maxHeight: "85vh" }}
      >
        <Dialog.Title>
          <Flex justify="between" align="center">
            <Heading size="4">Session Explorer</Heading>
            <Dialog.Close>
              <IconButton variant="ghost" color="gray">
                ✕
              </IconButton>
            </Dialog.Close>
          </Flex>
        </Dialog.Title>

        {loading && (
          <Flex justify="center" p="6">
            <Text color="gray">Loading session...</Text>
          </Flex>
        )}

        {error && (
          <Flex justify="center" p="6">
            <Text color="red">{error}</Text>
          </Flex>
        )}

        {session && (
          <Flex direction="column" gap="4">
            {/* Header info */}
            <Box>
              <Flex gap="2" align="center" mb="2">
                <Code size="1">{session.cwd}</Code>
                {session.gitBranch && (
                  <Badge color="blue" size="1">
                    {session.gitBranch}
                  </Badge>
                )}
              </Flex>
              <Text size="2" color="gray">
                {session.entries.length} entries
              </Text>
            </Box>

            <Separator size="4" />

            {/* Chat messages */}
            <ScrollArea
              style={{ height: "calc(85vh - 200px)" }}
              scrollbars="vertical"
            >
              <Flex direction="column" gap="4" pr="4">
                {session.entries
                  .filter((e) => e.type !== "system")
                  .map((entry, i) => (
                    <EntryBlock key={i} entry={entry} />
                  ))}
                <div ref={(el) => el?.scrollIntoView()} />
              </Flex>
            </ScrollArea>
          </Flex>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

// Helper to extract text from content (string or array of content blocks)
function extractTextContent(content: string | ContentBlock[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block.type === "text" && block.text) return block.text;
        if (block.type === "thinking" && block.thinking) return `[Thinking: ${block.thinking.slice(0, 100)}...]`;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function EntryBlock({ entry }: { entry: SessionEntry }) {
  if (entry.type === "user") {
    const textContent = extractTextContent(entry.content);
    return (
      <Box
        p="3"
        style={{
          backgroundColor: "var(--blue-3)",
          borderRadius: "var(--radius-3)",
          borderLeft: "3px solid var(--blue-9)",
        }}
      >
        <Text size="1" weight="medium" color="blue" mb="2">
          You
        </Text>
        <Text size="2">{textContent}</Text>
      </Box>
    );
  }

  if (entry.type === "tool_result" && entry.results) {
    return (
      <Box
        p="3"
        style={{
          backgroundColor: "var(--gray-3)",
          borderRadius: "var(--radius-3)",
          borderLeft: "3px solid var(--gray-8)",
        }}
      >
        <Text size="1" weight="medium" color="gray" mb="2">
          Tool Results
        </Text>
        {entry.results.map((result, i) => {
          const contentStr = typeof result.content === "string"
            ? result.content
            : JSON.stringify(result.content, null, 2);
          return (
            <Box key={i} mt="2">
              <Code
                size="1"
                style={{
                  display: "block",
                  whiteSpace: "pre-wrap",
                  maxHeight: 200,
                  overflow: "auto",
                }}
              >
                {contentStr?.slice(0, 1000) || "(empty)"}
                {contentStr && contentStr.length > 1000 && "..."}
              </Code>
            </Box>
          );
        })}
      </Box>
    );
  }

  if (entry.type === "assistant" && Array.isArray(entry.content)) {
    return (
      <Box
        p="3"
        style={{
          backgroundColor: "var(--gray-2)",
          borderRadius: "var(--radius-3)",
          borderLeft: "3px solid var(--grass-9)",
        }}
      >
        <Flex justify="between" align="center" mb="2">
          <Text size="1" weight="medium" color="grass">
            Claude
          </Text>
          {entry.model && (
            <Code size="1" color="gray">
              {entry.model.split("-").slice(0, 2).join("-")}
            </Code>
          )}
        </Flex>

        {entry.content.map((block, i) => (
          <ContentBlockView key={i} block={block} />
        ))}
      </Box>
    );
  }

  return null;
}

function ContentBlockView({ block }: { block: ContentBlock }) {
  if (block.type === "text" && block.text) {
    return (
      <Box className="markdown-content" mb="2">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => (
              <Text as="p" size="2" mb="2">
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
                    margin: "8px 0",
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
            pre: ({ children }) => <Box mb="2">{children}</Box>,
            ul: ({ children }) => (
              <ul style={{ paddingLeft: "var(--space-5)", marginBottom: "var(--space-2)" }}>
                {children}
              </ul>
            ),
            ol: ({ children }) => (
              <ol style={{ paddingLeft: "var(--space-5)", marginBottom: "var(--space-2)" }}>
                {children}
              </ol>
            ),
            li: ({ children }) => (
              <li style={{ fontSize: "var(--font-size-2)" }}>{children}</li>
            ),
          }}
        >
          {block.text}
        </Markdown>
      </Box>
    );
  }

  if (block.type === "tool_use") {
    return (
      <Box
        p="2"
        my="2"
        style={{
          backgroundColor: "var(--violet-3)",
          borderRadius: "var(--radius-2)",
        }}
      >
        <Flex align="center" gap="2" mb="1">
          <Badge color="violet" size="1">
            {block.name}
          </Badge>
        </Flex>
        {block.input && (
          <Code
            size="1"
            style={{
              display: "block",
              whiteSpace: "pre-wrap",
              maxHeight: 150,
              overflow: "auto",
            }}
          >
            {JSON.stringify(block.input, null, 2).slice(0, 500)}
          </Code>
        )}
      </Box>
    );
  }

  if (block.type === "thinking" && block.thinking) {
    return (
      <Box
        p="2"
        my="2"
        style={{
          backgroundColor: "var(--amber-3)",
          borderRadius: "var(--radius-2)",
          opacity: 0.8,
        }}
      >
        <Text size="1" color="amber" weight="medium" mb="1">
          Thinking
        </Text>
        <Text
          size="1"
          color="gray"
          style={{
            display: "block",
            maxHeight: 100,
            overflow: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          {block.thinking.slice(0, 500)}
          {block.thinking.length > 500 && "..."}
        </Text>
      </Box>
    );
  }

  return null;
}
