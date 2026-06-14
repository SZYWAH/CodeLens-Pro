import { apiUrl } from "./runtime";

type StreamHandlers = {
  onDelta: (text: string) => void;
  onStatus?: (data: Record<string, unknown>) => void;
  onDone?: (data: Record<string, unknown>) => void;
  onError?: (message: string) => void;
};

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function parseEvent(raw: string): { event: string; data: Record<string, unknown> } | null {
  const lines = normalizeLineEndings(raw).split("\n");
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }

  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

function drainEventBlocks(buffer: string) {
  const normalized = normalizeLineEndings(buffer);
  const parts = normalized.split(/\n{2,}/);
  return {
    events: parts.slice(0, -1),
    rest: parts[parts.length - 1] ?? "",
  };
}

function dispatchEvent(raw: string, handlers: StreamHandlers) {
  const parsed = parseEvent(raw);
  if (!parsed) return;

  if (parsed.event === "delta") {
    handlers.onDelta(String(parsed.data.text ?? ""));
  } else if (parsed.event === "status") {
    handlers.onStatus?.(parsed.data);
  } else if (parsed.event === "done") {
    handlers.onDone?.(parsed.data);
  } else if (parsed.event === "error") {
    handlers.onError?.(String(parsed.data.message ?? "Stream request failed"));
  }
}

export async function streamPost(url: string, body: unknown, handlers: StreamHandlers) {
  const response = await fetch(apiUrl(url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    throw new Error(await response.text());
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = drainEventBlocks(buffer);
    buffer = rest;

    for (const raw of events) {
      dispatchEvent(raw, handlers);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    dispatchEvent(buffer, handlers);
  }
}
