import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export function resolveFrontendDistDir(extensionUri: vscode.Uri) {
  const devMiniDist = path.resolve(extensionUri.fsPath, "webview-mini", "dist");
  if (fs.existsSync(path.join(devMiniDist, "index.html"))) {
    return devMiniDist;
  }

  const packagedMiniDist = path.resolve(extensionUri.fsPath, "webview-mini-dist");
  if (fs.existsSync(path.join(packagedMiniDist, "index.html"))) {
    return packagedMiniDist;
  }

  const devDist = path.resolve(extensionUri.fsPath, "..", "frontend", "dist");
  if (fs.existsSync(path.join(devDist, "index.html"))) {
    return devDist;
  }
  return path.resolve(extensionUri.fsPath, "webview-dist");
}

export function renderCodeLensHtml(webview: vscode.Webview, extensionUri: vscode.Uri, apiBase: string) {
  const frontendDistDir = resolveFrontendDistDir(extensionUri);
  const indexPath = path.join(frontendDistDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    return renderMissingBuildHtml(frontendDistDir);
  }

  const nonce = createNonce();
  const cspSource = webview.cspSource;
  let html = fs.readFileSync(indexPath, "utf8");

  html = html.replace(/(src|href)="\/([^"]+)"/g, (_match, attr: string, assetPath: string) => {
    const uri = webview.asWebviewUri(vscode.Uri.file(path.join(frontendDistDir, assetPath)));
    return `${attr}="${uri}"`;
  });

  html = html.replace(/<script /g, `<script nonce="${nonce}" `);
  html = html.replace(/<style /g, `<style nonce="${nonce}" `);
  html = html.replace(
    "<head>",
    `<head>
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data: https:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${cspSource}; connect-src http://127.0.0.1:* http://localhost:*;">
      <script nonce="${nonce}">window.CODELENS_API_BASE = "${apiBase}";</script>`
  );

  return html;
}

export function getWebviewResourceRoots(extensionUri: vscode.Uri) {
  return [vscode.Uri.file(resolveFrontendDistDir(extensionUri))];
}

function renderMissingBuildHtml(frontendDistDir: string) {
  const escapedPath = escapeHtml(frontendDistDir);
  return `<!doctype html>
    <html lang="zh-CN">
      <body style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; padding: 24px;">
        <h2>CodeLens Pro 前端未构建</h2>
        <p>请先在插件目录执行：</p>
        <pre>cd vscode-extension/webview-mini
npm install
npm run build</pre>
        <p>期望目录：${escapedPath}</p>
      </body>
    </html>`;
}

function createNonce() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
