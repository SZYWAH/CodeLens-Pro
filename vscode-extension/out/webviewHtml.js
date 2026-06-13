"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveFrontendDistDir = resolveFrontendDistDir;
exports.renderCodeLensHtml = renderCodeLensHtml;
exports.getWebviewResourceRoots = getWebviewResourceRoots;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
function resolveFrontendDistDir(extensionUri) {
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
function renderCodeLensHtml(webview, extensionUri, apiBase) {
    const frontendDistDir = resolveFrontendDistDir(extensionUri);
    const indexPath = path.join(frontendDistDir, "index.html");
    if (!fs.existsSync(indexPath)) {
        return renderMissingBuildHtml(frontendDistDir);
    }
    const nonce = createNonce();
    const cspSource = webview.cspSource;
    let html = fs.readFileSync(indexPath, "utf8");
    html = html.replace(/(src|href)="\/([^"]+)"/g, (_match, attr, assetPath) => {
        const uri = webview.asWebviewUri(vscode.Uri.file(path.join(frontendDistDir, assetPath)));
        return `${attr}="${uri}"`;
    });
    html = html.replace(/<script /g, `<script nonce="${nonce}" `);
    html = html.replace(/<style /g, `<style nonce="${nonce}" `);
    html = html.replace("<head>", `<head>
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data: https:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${cspSource}; connect-src http://127.0.0.1:* http://localhost:*;">
      <script nonce="${nonce}">window.CODELENS_API_BASE = "${apiBase}";</script>`);
    return html;
}
function getWebviewResourceRoots(extensionUri) {
    return [vscode.Uri.file(resolveFrontendDistDir(extensionUri))];
}
function renderMissingBuildHtml(frontendDistDir) {
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
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
//# sourceMappingURL=webviewHtml.js.map