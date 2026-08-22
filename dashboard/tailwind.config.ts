import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#151817',
        canvas: '#F7F7F4',
        line: '#E6E7E1',
        signal: '#27786A',
        'signal-soft': '#E6F2EE',
      },
      boxShadow: {
        panel: '0 12px 34px rgba(25, 31, 29, 0.08)',
      },
    },
  },
  plugins: [],
} satisfies Config;

