import Editor from "@monaco-editor/react";

export function EditorPanel({
  value,
  language,
  onChange,
  height = "100%"
}: {
  value: string;
  language: string;
  onChange: (value: string) => void;
  height?: string;
}) {
  return (
    <div className="editor-frame">
      <Editor
        height={height}
        language={language === "cpp" ? "cpp" : language}
        theme="vs-dark"
        value={value}
        onChange={(next) => onChange(next ?? "")}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          lineHeight: 22,
          fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: "on",
          padding: { top: 12, bottom: 12 }
        }}
      />
    </div>
  );
}
