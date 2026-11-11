/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#ecf7f2', 100: '#d3ede2', 200: '#a8dbc5', 500: '#2a9d78', 600: '#1b7a5c', 700: '#17634b', 800: '#0f4c3a', 900: '#0a3a2c' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'Noto Sans Ethiopic', 'sans-serif'] },
    },
  },
  plugins: [],
};
