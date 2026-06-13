type StreamHandlers = {
  onDelta: (text: string) => void;
  onDone?: (data: Record<string, unknown>) => void;
  onError?: (message: string) => void;
};

function parseEvent(raw: string): { event: string; data: Record<string, unknown> } | null {
  const lines = raw.split("\n");
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

export async function streamPost(url: string, body: unknown, handlers: StreamHandlers) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream"
    },
    body: JSON.stringify(body)
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
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const raw of events) {
      const parsed = parseEvent(raw);
      if (!parsed) continue;

      if (parsed.event === "delta") {
        handlers.onDelta(String(parsed.data.text ?? ""));
      } else if (parsed.event === "done") {
        handlers.onDone?.(parsed.data);
      } else if (parsed.event === "error") {
        handlers.onError?.(String(parsed.data.message ?? "流式请求失败"));
      }
    }
  }
}
