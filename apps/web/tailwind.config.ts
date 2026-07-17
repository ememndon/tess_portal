import type { Config } from "tailwindcss";
import containerQueries from "@tailwindcss/container-queries";

/**
 * Graphite and Jade, dense. Every color, font, radius, and density value
 * reads from the CSS variables defined once in globals.css, so no
 * component ever hardcodes a token.
 */
const config: Config = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      bg: "var(--bg)",
      surface: "var(--surface)",
      raised: "var(--raised)",
      line: "var(--line)",
      track: "var(--track)",
      fg: "var(--text)",
      muted: "var(--muted)",
      faint: "var(--faint)",
      jade: {
        DEFAULT: "var(--jade)",
        dim: "var(--jade-dim)",
        line: "var(--jade-line)",
        fill: "var(--jade-fill)",
        ink: "var(--jade-ink)",
      },
      violet: "var(--violet)",
      blue: "var(--blue)",
      amber: "var(--amber)",
      gold: "var(--gold)",
      red: { DEFAULT: "var(--red)", dim: "var(--red-dim)" },
    },
    fontFamily: {
      disp: ["var(--font-disp)", "system-ui", "sans-serif"],
      body: ["var(--font-body)", "system-ui", "sans-serif"],
      mono: ["var(--font-mono)", "ui-monospace", "monospace"],
    },
    extend: {
      borderRadius: {
        card: "var(--radius-card)",
        btn: "var(--radius-btn)",
        input: "var(--radius-input)",
        pill: "99px",
      },
      spacing: {
        pad: "var(--pad)",
        gap: "var(--gap)",
        cardpad: "var(--cardpad)",
        rowpad: "var(--rowpad)",
      },
      transitionDuration: {
        DEFAULT: "140ms",
      },
    },
  },
  plugins: [containerQueries],
};

export default config;
