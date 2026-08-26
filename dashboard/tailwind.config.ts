import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#F4F7FB',
        canvas: '#070B12',
        shell: '#090F18',
        panel: '#0D1521',
        elevated: '#111C2B',
        line: '#1D2939',
        signal: '#D42129',
        'signal-soft': '#32151B',
        gold: '#E0A94F',
        stone: {
          50: '#0D1521', 100: '#111C2B', 200: '#1D2939', 300: '#B7C1D1',
          400: '#8391A7', 500: '#66758D', 600: '#C7D1DF', 700: '#DEE6F1', 800: '#EFF4FA',
        },
      },
      boxShadow: {
        panel: '0 18px 44px rgba(0, 0, 0, 0.24)',
      },
    },
  },
  plugins: [],
} satisfies Config;
