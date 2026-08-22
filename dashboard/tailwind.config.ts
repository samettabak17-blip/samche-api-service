import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#F7F4EF',
        canvas: '#111113',
        line: '#302F33',
        signal: '#D42129',
        'signal-soft': '#321719',
        gold: '#C89B45',
        stone: {
          50: '#1A1A1C', 100: '#222225', 200: '#302F33', 300: '#D6D2D0',
          400: '#AAA6A7', 500: '#8A8587', 600: '#BBB6B7', 700: '#E5E1DF', 800: '#EFEBE8',
        },
      },
      boxShadow: {
        panel: '0 12px 34px rgba(25, 31, 29, 0.08)',
      },
    },
  },
  plugins: [],
} satisfies Config;

