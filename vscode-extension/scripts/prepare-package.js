const fs = require("fs");
const path = require("path");

const extensionRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(extensionRoot, "..");

const entries = [
  ["vscode-extension/webview-mini/dist", "webview-mini-dist"],
  ["backend", "backend"],
  ["alembic.ini", "alembic.ini"],
  ["requirements.txt", "requirements.txt"],
  [".env.example", ".env.example"],
];

function copyRecursive(source, target) {
  if (!fs.existsSync(source)) {
    throw new Error(`Missing required package source: ${source}`);
  }

  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    for (const child of fs.readdirSync(source)) {
      if (child === "__pycache__" || child.endsWith(".pyc")) continue;
      copyRecursive(path.join(source, child), path.join(target, child));
    }
    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

for (const [from, to] of entries) {
  copyRecursive(path.join(projectRoot, from), path.join(extensionRoot, to));
}

console.log("CodeLens Pro VS Code package assets prepared.");
