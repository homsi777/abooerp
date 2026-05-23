/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'primary': '#1e40af',
        'primary-dark': '#1e3a8a',
        'secondary': '#64748b',
        'accent': '#0ea5e9',
        'success': '#22c55e',
        'warning': '#f59e0b',
        'danger': '#ef4444',
        'info': '#3b82f6',
      },
      fontFamily: {
        'arabic': ['Tahoma', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
