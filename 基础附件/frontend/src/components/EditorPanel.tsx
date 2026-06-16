import Editor from "@monaco-editor/react";

let pyCharmThemeRegistered = false;

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
        theme="codelens-pycharm-dark"
        value={value}
        beforeMount={(monaco) => {
          if (pyCharmThemeRegistered) return;
          monaco.editor.defineTheme("codelens-pycharm-dark", {
            base: "vs-dark",
            inherit: true,
            rules: [
              { token: "", foreground: "A9B7C6", background: "2B2B2B" },
              { token: "keyword", foreground: "CC7832", fontStyle: "bold" },
              { token: "string", foreground: "6A8759" },
              { token: "number", foreground: "6897BB" },
              { token: "comment", foreground: "808080", fontStyle: "italic" },
              { token: "type", foreground: "FFC66D" },
              { token: "function", foreground: "FFC66D" },
              { token: "delimiter", foreground: "D6D6D6" },
              { token: "operator", foreground: "D6D6D6" }
            ],
            colors: {
              "editor.background": "#2B2B2B",
              "editor.foreground": "#A9B7C6",
              "editorLineNumber.foreground": "#606366",
              "editorLineNumber.activeForeground": "#A9B7C6",
              "editorCursor.foreground": "#BBBBBB",
              "editor.selectionBackground": "#214283",
              "editor.inactiveSelectionBackground": "#3A3D41",
              "editor.lineHighlightBackground": "#323232",
              "editorIndentGuide.background1": "#3C3F41",
              "editorIndentGuide.activeBackground1": "#606366"
            }
          });
          pyCharmThemeRegistered = true;
        }}
        onChange={(next) => onChange(next ?? "")}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          lineHeight: 22,
          fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: "on",
          maxTokenizationLineLength: 40000,
          padding: { top: 12, bottom: 12 }
        }}
      />
    </div>
  );
}
