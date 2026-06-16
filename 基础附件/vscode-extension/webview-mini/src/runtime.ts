import type { VsCodeInboundMessage } from "./types";

declare global {
  interface Window {
    CODELENS_API_BASE?: string;
    acquireVsCodeApi?: () => {
      postMessage: (message: unknown) => void;
      getState: () => unknown;
      setState: (state: unknown) => void;
    };
  }
}

let vscodeApi: ReturnType<NonNullable<typeof window.acquireVsCodeApi>> | null | undefined;

export function getVsCodeApi() {
  if (vscodeApi !== undefined) return vscodeApi;
  vscodeApi = typeof window.acquireVsCodeApi === "function" ? window.acquireVsCodeApi() : null;
  return vscodeApi;
}

export function postToVsCode(message: unknown) {
  getVsCodeApi()?.postMessage(message);
}

export function notifyReady() {
  postToVsCode({ type: "codelens.webviewReady" });
}

export function setApiBase(apiBase: string) {
  window.CODELENS_API_BASE = apiBase.replace(/\/+$/, "");
}

export function getApiBase() {
  return (window.CODELENS_API_BASE ?? "").replace(/\/+$/, "");
}

export function apiUrl(path: string) {
  const base = getApiBase();
  if (!base) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function onVsCodeMessage(handler: (message: VsCodeInboundMessage) => void) {
  const listener = (event: MessageEvent<VsCodeInboundMessage>) => {
    if (event.data && typeof event.data === "object") handler(event.data);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

export function languageFromVsCodeId(languageId?: string) {
  const normalized = (languageId ?? "").toLowerCase();
  const map: Record<string, { label: string; code: string }> = {
    python: { label: "Python", code: "python" },
    java: { label: "Java", code: "java" },
    javascript: { label: "JavaScript", code: "javascript" },
    javascriptreact: { label: "JavaScript", code: "javascript" },
    typescript: { label: "JavaScript", code: "javascript" },
    typescriptreact: { label: "JavaScript", code: "javascript" },
    cpp: { label: "C++", code: "cpp" },
    c: { label: "C", code: "c" },
    plaintext: { label: "多文件", code: "text" },
    text: { label: "多文件", code: "text" },
    markdown: { label: "Markdown", code: "markdown" },
    json: { label: "JSON", code: "json" },
  };
  return map[normalized] ?? { label: "Python", code: "python" };
}
