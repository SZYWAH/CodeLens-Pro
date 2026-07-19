import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const child = spawn(process.execPath, [fileURLToPath(new URL("./mock-openai-server.mjs", import.meta.url))], {
  stdio: ["ignore", "pipe", "ignore"],
  windowsHide: true
});

try {
  const lines = createInterface({ input: child.stdout });
  const [line] = await Promise.race([
    once(lines, "line"),
    new Promise((_, reject) => setTimeout(() => reject(new Error("mock server readiness timeout")), 3000))
  ]);
  const ready = JSON.parse(line);
  if (!ready.ready || !ready.port) throw new Error("mock server did not report readiness");

  await expectStatus(ready.baseUrls["success-json"], 200);
  await expectStatus(ready.baseUrls["success-sse"], 200);
  await expectStatus(ready.baseUrls["401"], 401);
  await expectStatus(ready.baseUrls["429"], 429);
  await expectStatus(ready.baseUrls["500"], 500);
  await expectStatus(ready.baseUrls.malformed, 200);
  await expectDisconnect(ready.baseUrls.disconnect);
  await expectTimeout(ready.baseUrls.timeout);
  process.stdout.write("mock OpenAI server: 8/8 scenarios passed\n");
} finally {
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1500))]);
}

async function expectStatus(baseUrl, expected) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-placeholder" },
    body: JSON.stringify({ model: "mock", messages: [{ role: "user", content: "redacted" }] })
  });
  if (response.status !== expected) throw new Error(`${baseUrl} returned ${response.status}, expected ${expected}`);
  await response.text();
}

async function expectDisconnect(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, { method: "POST", body: "{}" });
    await response.text();
  } catch {
    return;
  }
  throw new Error("disconnect scenario completed without a transport error");
}

async function expectTimeout(baseUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180);
  try {
    await fetch(`${baseUrl}/chat/completions`, { method: "POST", body: "{}", signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") return;
    throw error;
  } finally {
    clearTimeout(timer);
  }
  throw new Error("timeout scenario produced a response before cancellation");
}
