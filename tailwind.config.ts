import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0b1220",
          900: "#0f172a",
          800: "#1e293b",
          700: "#334155",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Inter",
          "system-ui",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        sheet: "0 -8px 24px rgba(0,0,0,0.18)",
      },
    },
  },
  plugins: [],
} satisfies Config;
