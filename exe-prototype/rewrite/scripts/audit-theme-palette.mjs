import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const cssPath = path.join(repoRoot, "web", "src", "styles.css");
const outputDir = path.resolve(
  repoRoot,
  "..",
  "outputs",
  "codelens-next",
  "audits",
  "v1.1.0-rc2-theme",
);
const strict = process.argv.includes("--strict");

const BASELINE = Object.freeze({
  uniqueHex: 273,
  colorLiteralCount: 1969,
});

const TARGETS = Object.freeze({
  uniqueHexMax: 200,
  colorLiteralCountMax: Math.floor(BASELINE.colorLiteralCount * 0.75),
  ordinaryTokenUsageMin: 0.9,
});

const semanticRoles = [
  "surface-canvas",
  "surface-panel",
  "surface-raised",
  "surface-control",
  "surface-control-hover",
  "surface-reading",
  "text-primary",
  "text-secondary",
  "text-tertiary",
  "text-inverse",
  "border-subtle",
  "border-control",
  "border-strong",
  "border-focus",
  "accent-text",
  "accent-icon",
  "accent-border",
  "accent-fill",
  "accent-fill-hover",
  "success-text",
  "success-border",
  "success-fill",
  "warning-text",
  "warning-border",
  "warning-fill",
  "danger-text",
  "danger-border",
  "danger-fill",
  "knowledge-paper",
  "code-surface",
];

const allowedLiteralScopes = [
  "dependency-space",
  "dependency-graph-canvas",
  "dependency-graph-legend",
  "activity-",
  "project-source-code",
  "project-source-lines",
  "diff-code",
  "diff-line",
  "syntax",
  "hljs",
];

const graphRelationColors = new Set([
  "#6f8796",
  "#60798a",
  "#a8bbc5",
  "#475f70",
  "#b98d60",
  "#9a672f",
  "#e6f6fc",
  "#145e7c",
  "#5eb8ad",
  "#1d827b",
  "#d79a5c",
  "#ac662a",
  "#3f5360",
  "#8b9aa5",
  "#25313a",
  "#c8d0d5",
]);

const css = fs.readFileSync(cssPath, "utf8");
const contractMarker = css.indexOf("/* V12: original CodeLens dual-theme shell");
if (contractMarker < 0) {
  throw new Error("Unable to locate the active dual-theme token contract.");
}
const activeCss = css.slice(contractMarker);

function extractBlock(source, selector, startAt = 0) {
  const index = source.indexOf(selector, startAt);
  if (index < 0) return null;
  const open = source.indexOf("{", index + selector.length);
  if (open < 0) return null;
  let depth = 1;
  for (let cursor = open + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === "{") depth += 1;
    if (source[cursor] === "}") depth -= 1;
    if (depth === 0) return source.slice(open + 1, cursor);
  }
  return null;
}

function declarations(block) {
  const result = new Map();
  for (const match of block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    result.set(`--${match[1]}`, match[2].trim());
  }
  return result;
}

const darkBlock = extractBlock(activeCss, ":root");
const lightBlock = extractBlock(activeCss, ':root[data-theme="light"]');
if (!darkBlock || !lightBlock) {
  throw new Error("Dark or light semantic token block is missing.");
}
const themes = {
  dark: declarations(darkBlock),
  light: declarations(lightBlock),
};

function parseHex(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const raw = match[1];
  return [0, 2, 4].map((offset) => Number.parseInt(raw.slice(offset, offset + 2), 16));
}

function luminance(rgb) {
  return rgb
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

function themeValue(theme, role) {
  return themes[theme].get(`--theme-${role}`);
}

const contractIssues = [];
for (const [themeName, themeTokens] of Object.entries(themes)) {
  for (const role of semanticRoles) {
    if (!themeTokens.has(`--theme-${role}`)) {
      contractIssues.push(`${themeName}: missing --theme-${role}`);
    }
  }
}

const contrastChecks = [];
const textRoles = [
  "text-primary",
  "text-secondary",
  "text-tertiary",
  "accent-text",
  "success-text",
  "warning-text",
  "danger-text",
];
const textSurfaces = ["surface-canvas", "surface-panel", "surface-reading"];
const statePairs = [
  ["success-text", "success-fill"],
  ["warning-text", "warning-fill"],
  ["danger-text", "danger-fill"],
];
const borderRoles = ["border-control", "border-strong", "border-focus"];
const borderSurfaces = ["surface-canvas", "surface-panel", "surface-raised"];

for (const themeName of Object.keys(themes)) {
  for (const role of textRoles) {
    for (const surface of textSurfaces) {
      const foreground = parseHex(themeValue(themeName, role) ?? "");
      const background = parseHex(themeValue(themeName, surface) ?? "");
      const ratio = foreground && background ? contrastRatio(foreground, background) : 0;
      contrastChecks.push({ theme: themeName, role, surface, ratio, threshold: 4.5, passed: ratio >= 4.5 });
    }
  }
  for (const [role, surface] of statePairs) {
    const foreground = parseHex(themeValue(themeName, role) ?? "");
    const background = parseHex(themeValue(themeName, surface) ?? "");
    const ratio = foreground && background ? contrastRatio(foreground, background) : 0;
    contrastChecks.push({ theme: themeName, role, surface, ratio, threshold: 4.5, passed: ratio >= 4.5 });
  }
  for (const role of borderRoles) {
    for (const surface of borderSurfaces) {
      const foreground = parseHex(themeValue(themeName, role) ?? "");
      const background = parseHex(themeValue(themeName, surface) ?? "");
      const ratio = foreground && background ? contrastRatio(foreground, background) : 0;
      contrastChecks.push({ theme: themeName, role, surface, ratio, threshold: 3, passed: ratio >= 3 });
    }
  }
}

const colorLiteralPattern = /#[0-9a-f]{3,8}\b|(?:rgb|rgba|hsl|hsla)\([^)]*\)/gi;
const hexPattern = /#[0-9a-f]{3,8}\b/gi;
const allLiterals = css.match(colorLiteralPattern) ?? [];
const allHex = css.match(hexPattern) ?? [];

function lineAt(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function inspectActiveRules(source) {
  const records = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of source.matchAll(rulePattern)) {
    const selector = match[1].trim();
    const body = match[2];
    if (!selector || selector.startsWith("@") || selector === "from" || selector === "to") continue;
    if (selector.startsWith(":root")) continue;
    const lowerSelector = selector.toLowerCase();
    const excluded = allowedLiteralScopes.some((scope) => lowerSelector.includes(scope));
    const literals = body.match(colorLiteralPattern) ?? [];
    const colorTokenRefs = body.match(/var\(--(?:theme|shell|cl)-[\w-]+/g) ?? [];
    records.push({
      selector,
      body,
      excluded,
      literals,
      colorTokenRefs,
      line: lineAt(css, contractMarker + (match.index ?? 0)),
    });
  }
  return records;
}

const activeRules = inspectActiveRules(activeCss);
const ordinaryRules = activeRules.filter((record) => !record.excluded);
const ordinaryLiteralCount = ordinaryRules.reduce((sum, record) => sum + record.literals.length, 0);
const ordinaryTokenCount = ordinaryRules.reduce((sum, record) => sum + record.colorTokenRefs.length, 0);
const ordinaryTokenUsage = ordinaryTokenCount / Math.max(1, ordinaryTokenCount + ordinaryLiteralCount);

const scopeLeaks = [];
for (const record of ordinaryRules) {
  const loweredBody = record.body.toLowerCase();
  const reasons = [];
  if (loweredBody.includes("var(--shell-cyan")) reasons.push("legacy cyan token");
  if (loweredBody.includes("var(--shell-plum")) reasons.push("legacy plum token");
  for (const literal of record.literals) {
    if (graphRelationColors.has(literal.toLowerCase())) reasons.push(`graph relation color ${literal.toLowerCase()}`);
  }
  if (reasons.length > 0) {
    scopeLeaks.push({ selector: record.selector, line: record.line, reasons: [...new Set(reasons)] });
  }
}

const metrics = {
  uniqueHex: new Set(allHex.map((value) => value.toLowerCase())).size,
  hexLiteralCount: allHex.length,
  colorLiteralCount: allLiterals.length,
  ordinaryLiteralCount,
  ordinaryTokenCount,
  ordinaryTokenUsage,
  literalReductionFromBaseline: 1 - allLiterals.length / BASELINE.colorLiteralCount,
};

const failures = [
  ...contractIssues,
  ...contrastChecks.filter((check) => !check.passed).map(
    (check) => `${check.theme}: ${check.role} on ${check.surface} is ${check.ratio.toFixed(2)}:1`,
  ),
];
if (strict) {
  if (metrics.uniqueHex > TARGETS.uniqueHexMax) failures.push(`unique hex ${metrics.uniqueHex} > ${TARGETS.uniqueHexMax}`);
  if (metrics.colorLiteralCount > TARGETS.colorLiteralCountMax) {
    failures.push(`color literals ${metrics.colorLiteralCount} > ${TARGETS.colorLiteralCountMax}`);
  }
  if (metrics.ordinaryTokenUsage < TARGETS.ordinaryTokenUsageMin) {
    failures.push(`ordinary token usage ${(metrics.ordinaryTokenUsage * 100).toFixed(1)}% < 90%`);
  }
  if (scopeLeaks.length > 0) failures.push(`${scopeLeaks.length} ordinary selector color-scope leak(s)`);
}

const report = {
  generatedAt: new Date().toISOString(),
  source: path.relative(repoRoot, cssPath).replaceAll("\\", "/"),
  mode: strict ? "strict" : "baseline",
  baseline: BASELINE,
  targets: TARGETS,
  metrics,
  contract: {
    roles: semanticRoles,
    issues: contractIssues,
  },
  contrast: {
    passed: contrastChecks.every((check) => check.passed),
    checks: contrastChecks.map((check) => ({ ...check, ratio: Number(check.ratio.toFixed(3)) })),
  },
  scopeLeaks,
  passed: failures.length === 0,
  failures,
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "palette-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

const markdown = [
  "# v1.1.0 RC2 双主题颜色审计",
  "",
  `- 模式：${strict ? "严格验收" : "基线检查"}`,
  `- 结果：${report.passed ? "通过" : "未通过"}`,
  `- 独立十六进制色：${metrics.uniqueHex} / ${TARGETS.uniqueHexMax}`,
  `- 颜色字面量：${metrics.colorLiteralCount} / ${TARGETS.colorLiteralCountMax}`,
  `- 相对既有审计基线降幅：${(metrics.literalReductionFromBaseline * 100).toFixed(1)}%`,
  `- 普通活动选择器颜色 Token 使用率：${(metrics.ordinaryTokenUsage * 100).toFixed(1)}%`,
  `- 普通页面颜色越界：${scopeLeaks.length}`,
  `- 对比度检查：${contrastChecks.filter((check) => check.passed).length}/${contrastChecks.length}`,
  "",
  "## 失败项",
  "",
  ...(failures.length > 0 ? failures.map((failure) => `- ${failure}`) : ["- 无"]),
  "",
  "## 范围说明",
  "",
  "依赖图关系色、代码/语法表面和本批暂缓的活动展示台不计入普通页面 Token 使用率；全局字面量与独立颜色统计仍包含它们。",
  "",
];
fs.writeFileSync(path.join(outputDir, "PALETTE-AUDIT.md"), markdown.join("\n"), "utf8");

console.log(JSON.stringify({ outputDir, passed: report.passed, failures, metrics }, null, 2));
if (failures.length > 0) process.exitCode = 1;
