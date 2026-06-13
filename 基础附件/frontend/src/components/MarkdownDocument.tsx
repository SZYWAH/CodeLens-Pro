import { Check, Copy } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownDocument({
  content,
  className = ""
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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

function MarkdownParagraph({ children }: { children?: ReactNode }) {
  const text = flattenText(children).trim();
  const isCallout = /^(问题|建议|风险|原因|影响|修改|优化|结论|注意|示例|场景|总结)\s*\d*\s*[：:]/.test(text);

  if (isCallout) {
    return <p className="report-callout">{children}</p>;
  }

  return <p>{children}</p>;
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

  async function copyCode() {
    await navigator.clipboard.writeText(rawText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  if (!isBlock) {
    return <code className={className}>{children}</code>;
  }

  return (
    <div className="markdown-code-block">
      <button className="code-copy-button" onClick={copyCode} type="button">
        {copied ? <Check size={13} /> : <Copy size={13} />}
        <span>{copied ? "已复制" : "复制"}</span>
      </button>
      {language ? <div className="absolute left-4 top-3 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-[#8f8f8f]">{language}</div> : null}
      <pre>
        <code className={className}>{highlightCode(rawText, language)}</code>
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
