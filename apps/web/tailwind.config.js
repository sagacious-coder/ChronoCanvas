/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: {
          50: '#FDFBF7',
          100: '#F7F4EB',
          200: '#EFEAD9',
          300: '#E5DEC8',
          border: '#E6E2D8',
          borderDark: '#D8D2C4',
        },
        charcoal: {
          900: '#1F2328',
          800: '#2D3139',
          700: '#4B515D',
          600: '#656D76',
          500: '#8C959F',
        },
        revertGreen: {
          bg: '#E6F4EA',
          border: '#CEEAD6',
          text: '#137333',
        },
      },
      boxShadow: {
        'apple-sm': '0 1px 3px rgba(45, 35, 20, 0.04), 0 1px 2px rgba(45, 35, 20, 0.02)',
        'apple-md': '0 4px 16px -2px rgba(45, 35, 20, 0.06), 0 2px 6px -1px rgba(45, 35, 20, 0.03)',
        'apple-lg': '0 10px 30px -4px rgba(45, 35, 20, 0.08), 0 4px 10px -2px rgba(45, 35, 20, 0.04)',
      },
      borderRadius: {
        'ios': '14px',
      }
    },
  },
  plugins: [],
}
