/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          bg: 'rgb(var(--color-bg) / <alpha-value>)',
          card: 'rgb(var(--color-card) / <alpha-value>)',
          border: 'rgb(var(--color-border) / <alpha-value>)',
          text: 'rgb(var(--color-text) / <alpha-value>)',
          muted: 'rgb(var(--color-muted) / <alpha-value>)',
        },
        brand: {
          primary: '#1E293B',  // Dark Slate/Charcoal for pill buttons (Zentra style)
          success: '#10B981',  // Emerald Green
          warning: '#F59E0B',  // Amber
          danger: '#EF4444',   // Rose Red
          info: '#2563EB',     // Zentra Cobalt Blue
        },
        guard: {
          orange: '#FF5A21',       // GT GUARD primary accent
          orangeLight: 'rgb(var(--color-orange-light) / <alpha-value>)',
          panel: '#11131A',        // Login page dark brand panel
          panelBorder: '#292C33',
        }
      },
      fontFamily: {
        sans: ['Outfit', 'Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'glow-brand': '0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03)', // Soft Zentra shadow
        'glow-danger': '0 4px 6px -1px rgba(239, 68, 68, 0.05)',
        'glow-success': '0 4px 6px -1px rgba(16, 185, 129, 0.05)',
      }
    },
  },
  plugins: [],
}
