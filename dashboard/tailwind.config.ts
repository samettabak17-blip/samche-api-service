import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#111214',
        canvas: '#F7F4EF',
        line: '#E6DED3',
        signal: '#D42129',
        'signal-soft': '#FBE9EA',
        gold: '#C89B45',
      },
      boxShadow: {
        panel: '0 12px 34px rgba(25, 31, 29, 0.08)',
      },
    },
  },
  plugins: [],
} satisfies Config;