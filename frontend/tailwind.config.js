/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--bg-main) / <alpha-value>)",
        surface: "hsl(var(--bg-surface) / <alpha-value>)",
        border: "hsl(var(--border-subtle) / <alpha-value>)",
        primary: {
          50: "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981", // Emerald accent
          600: "#059669",
          700: "#047857",
          800: "#065f46",
          900: "#064e3b",
        },
        neutral: {
          950: "#07080b",
          900: "#0b0c10",
          850: "#11131a",
          800: "#161821",
          750: "#1d202d",
          700: "#242838",
          600: "#3e445b",
          500: "#64748b",
          400: "#94a3b8",
          300: "#cbd5e1",
          200: "#e2e8f0",
          100: "#f1f5f9",
          50: "#f8fafc",
        },
      },
      fontFamily: {
        sans: ["'Plus Jakarta Sans'", "system-ui", "-apple-system", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      boxShadow: {
        card: "0 10px 30px -10px rgba(0, 0, 0, 0.6)",
        glow: "0 0 24px -4px rgba(16, 185, 129, 0.35)",
        surface: "0 4px 20px -2px rgba(0, 0, 0, 0.4)",
      },
      keyframes: {
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        slideLeft: { from: { transform: "translateX(100%)" }, to: { transform: "translateX(0)" } },
        slideUp: { from: { transform: "translateY(16px)", opacity: "0" }, to: { transform: "translateY(0)", opacity: "1" } },
        bump: { "0%, 100%": { transform: "scale(1)" }, "50%": { transform: "scale(1.15)" } },
        pulseSoft: { "0%, 100%": { opacity: "1" }, "50%": { opacity: "0.5" } },
      },
      animation: {
        fadeIn: "fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        slideLeft: "slideLeft 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
        slideUp: "slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        bump: "bump 0.25s ease-out",
        pulseSoft: "pulseSoft 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};
