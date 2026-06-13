/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "SF Pro Text",
          "Segoe UI",
          "Noto Sans SC",
          "Microsoft YaHei",
          "sans-serif"
        ],
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"]
      },
      colors: {
        ink: "#EAF2FF",
        mist: "#070B14",
        line: "#1E2A44",
        pine: "#60A5FA",
        teal: "#38BDF8",
        coral: "#FF8A63",
        plum: "#B9A6FF"
      }
    }
  },
  plugins: []
};
