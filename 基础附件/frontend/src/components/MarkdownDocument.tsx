import { Check, Copy } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type MarkdownHeadingItem = {
  id: string;
  text: string;
  level: 1 | 2 | 3;
};

export function MarkdownDocument({
  content,
  className = ""
}: {
  content: string;
  className?: string;
}) {
  const headingIds = buildHeadingIdMap(content);

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: MarkdownHeading("h1", headingIds),
          h2: MarkdownHeading("h2", headingIds),
          h3: MarkdownHeading("h3", headingIds),
          p: MarkdownParagraph,
          pre: ({ children }) => <>{children}</>,
          code: MarkdownCode
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function MarkdownHeading(Tag: "h1" | "h2" | "h3", headingIds: Map<string, string[]>) {
  return function Heading({ children }: { children?: ReactNode }) {
    const text = flattenText(children).trim();
    const level = Number(Tag.slice(1));
    const key = `${level}:${text}`;
    const ids = headingIds.get(key);
    const id = ids?.shift() ?? headingId(text);
    return <Tag id={id}>{children}</Tag>;
  };
}

function MarkdownParagraph({ children }: { children?: ReactNode }) {
  const text = flattenText(children).trim();
  const isCallout = /^(问题|建议|风险|原因|影响|修改|优化|结论|注意|示例|场景|总结)\s*\d*\s*[：:]/.test(text);

  if (isCallout) {
    return <p className="report-callout">{children}</p>;
  }

  return <p>{children}</p>;
}

export function headingId(text: string) {
  return text
    .replace(/[#*_`>\[\]{}()（）【】"'“”‘’]+/g, " ")
    .trim()
    .replace(/[^0-9A-Za-z\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "section";
}

export function extractMarkdownHeadings(content: string): MarkdownHeadingItem[] {
  const usedIds = new Map<string, number>();
  const headings: MarkdownHeadingItem[] = [];
  let inFence = false;

  content.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (/^```/.test(line) || /^~~~/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    const match = /^(#{1,3})\s+(.+?)\s*#*$/.exec(line);
    if (!match) return;

    const text = match[2].trim();
    if (!text) return;

    const baseId = headingId(text);
    const count = usedIds.get(baseId) ?? 0;
    usedIds.set(baseId, count + 1);
    headings.push({
      id: count ? `${baseId}-${count + 1}` : baseId,
      text,
      level: match[1].length as 1 | 2 | 3
    });
  });

  return headings.slice(0, 64);
}

function buildHeadingIdMap(content: string) {
  const map = new Map<string, string[]>();
  extractMarkdownHeadings(content).forEach((heading) => {
    const key = `${heading.level}:${heading.text}`;
    const ids = map.get(key) ?? [];
    ids.push(heading.id);
    map.set(key, ids);
  });
  return map;
}

function flattenText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return flattenText(props?.children);
  }
  return "";
}

function MarkdownCode({
  inline,
  className,
  children
}: {
  inline?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const rawText = String(children ?? "").replace(/\n$/, "");
  const language = className?.replace("language-", "") ?? "";
  const isBlock = !inline && (Boolean(className) || rawText.includes("\n"));

  if (!isBlock) {
    return (
      <code className={["markdown-inline-code", inlineCodeKindClass(rawText), className].filter(Boolean).join(" ")}>
        {highlightCodePart(rawText)}
      </code>
    );
  }

  return <CodeSnippetBlock code={rawText} language={language} className={className} copied={copied} setCopied={setCopied} />;
}

export function CodeSnippetBlock({
  code,
  language = "",
  className,
  compact = false,
  copied: controlledCopied,
  setCopied: setControlledCopied
}: {
  code: string;
  language?: string;
  className?: string;
  compact?: boolean;
  copied?: boolean;
  setCopied?: (value: boolean) => void;
}) {
  const [localCopied, setLocalCopied] = useState(false);
  const copied = controlledCopied ?? localCopied;
  const setCopied = setControlledCopied ?? setLocalCopied;
  const codeClassName = className ?? (language ? `language-${language}` : undefined);

  async function copyCode() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className={["markdown-code-block", compact ? "markdown-code-block-compact" : ""].filter(Boolean).join(" ")}>
      <button
        aria-label={copied ? "代码已复制" : "复制代码"}
        className="code-copy-button"
        onClick={copyCode}
        title={copied ? "已复制" : "复制代码"}
        type="button"
      >
        {copied ? <Check size={10} /> : <Copy size={10} />}
      </button>
      {language ? <div className="code-language-label">{language}</div> : null}
      <pre>
        <code className={codeClassName}>{highlightCode(code, language)}</code>
      </pre>
    </div>
  );
}

const KEYWORDS = new Set([
  "and",
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "def",
  "default",
  "do",
  "elif",
  "else",
  "except",
  "false",
  "False",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "interface",
  "let",
  "new",
  "None",
  "not",
  "null",
  "or",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "switch",
  "this",
  "throw",
  "true",
  "True",
  "try",
  "var",
  "void",
  "while",
  "with"
]);

function highlightCode(code: string, language: string) {
  const lines = code.split("\n");

  return lines.map((line, index) => {
    const commentIndex = findCommentIndex(line, language);
    const codePart = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
    const commentPart = commentIndex >= 0 ? line.slice(commentIndex) : "";

    return (
      <Fragment key={`${index}-${line}`}>
        <span className="syntax-line">
          <span className="syntax-line-number">{index + 1}</span>
          <span className="syntax-line-content">
            {highlightCodePart(codePart)}
            {commentPart ? <span className="syntax-comment">{commentPart}</span> : null}
          </span>
        </span>
        {index < lines.length - 1 ? "\n" : null}
      </Fragment>
    );
  });
}

function findCommentIndex(line: string, language: string) {
  const markers = language === "python" || language === "py" ? ["#"] : ["//", "/*"];
  let quote: string | null = null;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    for (const marker of markers) {
      if (line.startsWith(marker, index)) {
        return index;
      }
    }
  }

  return -1;
}

const FUNCTION_LIKE_PREFIXES = [
  "apply",
  "build",
  "clean",
  "close",
  "create",
  "delete",
  "extract",
  "find",
  "get",
  "handle",
  "load",
  "open",
  "persist",
  "queue",
  "render",
  "restore",
  "save",
  "scan",
  "set",
  "stream",
  "update"
];

const STATE_LIKE_SUFFIXES = ["_page", "_mode", "_state", "_status", "_flag", "_value", "_id", "_ids"];

function inlineCodeKindClass(text: string) {
  const value = text.trim();

  if (!value) return "inline-code-symbol";
  if (/^["'`].*["'`]$/.test(value)) return "inline-code-string";
  if (KEYWORDS.has(value)) return "inline-code-keyword";
  if (/[=!<>+\-*/]|[\s]/.test(value)) return "inline-code-expression";
  if (/[\\/]/.test(value) || /\.[A-Za-z0-9]{1,6}$/.test(value)) return "inline-code-path";
  if (/\w+\s*\(.*\)$/.test(value)) return "inline-code-call";

  const normalized = value.replace(/\(.*\)$/, "");
  if (FUNCTION_LIKE_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}_`))) {
    return "inline-code-call";
  }
  if (STATE_LIKE_SUFFIXES.some((suffix) => normalized.endsWith(suffix)) || /^(active|current|pending|selected|is|has|can)_/.test(normalized)) {
    return "inline-code-state";
  }

  return "inline-code-symbol";
}

function highlightCodePart(text: string) {
  const tokenPattern = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b|[()[\]{}.,:+\-*/%=<>!]+)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    let className = "syntax-plain";
    if (/^["'`]/.test(token)) {
      className = "syntax-string";
    } else if (/^\d/.test(token)) {
      className = "syntax-number";
    } else if (KEYWORDS.has(token)) {
      className = "syntax-keyword";
    } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(token) && text.slice(tokenPattern.lastIndex).trimStart().startsWith("(")) {
      className = "syntax-function";
    } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) {
      className = "syntax-identifier";
    } else if (/^[()[\]{}.,:+\-*/%=<>!]+$/.test(token)) {
      className = "syntax-punctuation";
    }

    nodes.push(
      <span className={className} key={`${token}-${match.index}`}>
        {token}
      </span>
    );
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}
