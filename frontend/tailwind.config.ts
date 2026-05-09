import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0b0d",
        panel: "#111317",
        "panel-2": "#15181d",
        line: "#20242b",
        "line-2": "#2a2f37",
        text: "#e8e6e1",
        muted: "#7a7f88",
        dim: "#4a4e56",
        safe: "#8fb88a",
        warn: "#d4a857",
        threat: "#c2604f",
        accent: "#d4a857",
      },
      fontFamily: {
        sans: ["var(--font-inter-tight)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "monospace"],
        serif: ["var(--font-instrument-serif)", "serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
