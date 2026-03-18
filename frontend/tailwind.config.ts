import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#0d1117',
        foreground: '#f4f7fb',
        card: '#131b25',
        border: '#253142',
        accent: '#45b5ff',
        emerald: '#54d2a6',
        amber: '#f6b85d',
        danger: '#f87171',
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.5rem',
        '3xl': '1.75rem',
      },
      fontFamily: {
        sans: ['"Trebuchet MS"', '"Avenir Next"', '"Segoe UI"', 'sans-serif'],
        display: ['Georgia', '"Palatino Linotype"', 'serif'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(69, 181, 255, 0.15), 0 20px 60px rgba(0, 0, 0, 0.35)',
      },
      backgroundImage: {
        'board-gradient':
          'radial-gradient(circle at top, rgba(69, 181, 255, 0.14), transparent 30%), radial-gradient(circle at bottom right, rgba(84, 210, 166, 0.12), transparent 28%)',
      },
    },
  },
  plugins: [],
};

export default config;
