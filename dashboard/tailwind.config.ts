import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#F4F7FB',
        canvas: '#050A10',
        shell: '#07101A',
        panel: '#0B1521',
        elevated: '#101D2B',
        line: '#203247',
        signal: '#D42129',
        'signal-soft': '#32151B',
        gold: '#D9A441',
        whatsapp: { 400: '#22C77A', 500: '#159C5A', 700: '#087445' },
        guide: { 500: '#AD2231', 700: '#5D1720' },
        stone: {
          50: '#0D1521', 100: '#111E2D', 200: '#203247', 300: '#B7C1D1',
          400: '#8391A7', 500: '#66758D', 600: '#C7D1DF', 700: '#DEE6F1', 800: '#EFF4FA',
        },
      },
      boxShadow: {
        panel: '0 18px 44px rgba(0, 0, 0, 0.24)',
        signal: '0 12px 30px rgba(212, 33, 41, 0.20)',
      },
    },
  },
  plugins: [],
} satisfies Config;
