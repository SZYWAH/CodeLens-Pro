import http from "node:http";

const host = "127.0.0.1";
const requestedPort = Number.parseInt(process.env.CODELENS_MOCK_OPENAI_PORT || "0", 10) || 0;
const sockets = new Set();
const pendingResponses = new Set();
let connectionCount = 0;

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${host}`);
  const scenario = url.pathname.split("/").filter(Boolean)[0] || "unknown";
  connectionCount += 1;
  logEvent({ event: "request", scenario, connection: connectionCount });
  request.resume();

  if (!url.pathname.endsWith("/v1/chat/completions")) {
    sendJson(response, 404, { error: { message: "not found", type: "not_found" } });
    return;
  }

  if (scenario === "success-json") {
    sendJson(response, 200, {
      id: "mock-chat-completion",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "模拟模型响应完成。" }, finish_reason: "stop" }]
    });
    return;
  }

  if (scenario === "success-sse") {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });
    response.write('data: {"choices":[{"delta":{"content":"模拟"}}]}\n\n');
    response.write('data: {"choices":[{"delta":{"content":"流式响应"}}]}\n\n');
    response.end("data: [DONE]\n\n");
    return;
  }

  if (scenario === "401" || scenario === "429" || scenario === "500") {
    const status = Number(scenario);
    sendJson(response, status, {
      error: {
        message: status === 401 ? "unauthorized" : status === 429 ? "rate limited" : "server error",
        type: "mock_error"
      }
    });
    return;
  }

  if (scenario === "disconnect") {
    response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    response.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
    response.socket?.destroy();
    return;
  }

  if (scenario === "malformed") {
    response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    response.end("data: {this-is-not-json}\n\ndata: [DONE]\n\n");
    return;
  }

  if (scenario === "timeout") {
    response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    pendingResponses.add(response);
    response.on("close", () => {
      pendingResponses.delete(response);
      logEvent({ event: "closed", scenario, connection: connectionCount });
    });
    return;
  }

  sendJson(response, 404, { error: { message: "unknown scenario", type: "not_found" } });
});

server.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});

server.listen(requestedPort, host, () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock server did not bind a TCP port");
  const origin = `http://${host}:${address.port}`;
  const scenarios = ["success-json", "success-sse", "401", "429", "500", "timeout", "disconnect", "malformed"];
  process.stdout.write(`${JSON.stringify({ ready: true, host, port: address.port, baseUrls: Object.fromEntries(scenarios.map((scenario) => [scenario, `${origin}/${scenario}/v1`])) })}\n`);
});

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function logEvent(event) {
  process.stderr.write(`${JSON.stringify(event)}\n`);
}

function shutdown() {
  for (const response of pendingResponses) response.destroy();
  pendingResponses.clear();
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, shutdown);
process.on("disconnect", shutdown);
