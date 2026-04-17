/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        colony: {
          auto: '#60a5fa',
          confirmed: '#34d399',
          rejected: '#f87171',
        },
      },
    },
  },
  plugins: [],
}
