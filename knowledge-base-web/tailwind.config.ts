import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#181715',
        canvas: '#f5efe4',
        sand: '#e8dcc8',
        clay: '#b16946',
        pine: '#294b42',
        gold: '#c8952d',
      },
      boxShadow: {
        panel: '0 24px 60px rgba(24, 23, 21, 0.12)',
      },
      fontFamily: {
        sans: ['"Avenir Next"', '"Trebuchet MS"', '"Segoe UI"', 'sans-serif'],
        serif: ['"Iowan Old Style"', '"Palatino Linotype"', '"Book Antiqua"', 'serif'],
      },
    },
  },
  plugins: [],
};

export default config;
