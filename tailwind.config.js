/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Noto Sans SC', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [
    // 触屏设备（无 hover）专用变体：touch-device:opacity-100 等
    function ({ addVariant }) {
      addVariant('touch-device', '@media (hover: none) and (pointer: coarse)');
    },
  ],
}
