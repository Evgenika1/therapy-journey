/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        orange: {
          50:  '#FFF0EB',
          500: '#F07040',
          600: '#E84820',
        },
        yellow: {
          50:  '#FFFAE8',
          400: '#F5C842',
          500: '#E8A820',
        },
      },
      fontFamily: {
        serif:  ['"DM Serif Display"', 'Georgia', 'serif'],
        sans:   ['"DM Sans"', 'sans-serif'],
        mono:   ['"Courier Prime"', 'monospace'],
      },
    },
  },
  plugins: [],
};
