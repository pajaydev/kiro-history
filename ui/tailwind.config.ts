import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: '#0A0A0B',
          card: '#18181B',
          hover: '#27272A',
        },
        foreground: {
          DEFAULT: '#FFFFFF',
          muted: '#A1A1AA',
        },
        success: '#22C55E',
        failure: '#EF4444',
        border: '#E4E4E7',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config
