/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: {
          DEFAULT: '#0b0e14',
          900: '#070910',
          800: '#0b0e14',
          700: '#11151d',
          600: '#161b26',
          500: '#1d2330',
        },
        snake: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },
      },
      fontFamily: {
        display: ['"Bebas Neue"', '"Oswald"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { textShadow: '0 0 30px rgba(74,222,128,0.45), 0 0 60px rgba(34,197,94,0.25)' },
          '50%': { textShadow: '0 0 45px rgba(74,222,128,0.65), 0 0 90px rgba(34,197,94,0.4)' },
        },
        'scan-line': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        'grid-drift': {
          '0%': { backgroundPosition: '0 0' },
          '100%': { backgroundPosition: '40px 40px' },
        },
        'shimmer': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'pulse-glow': 'pulse-glow 4s ease-in-out infinite',
        'scan-line': 'scan-line 6s linear infinite',
        'grid-drift': 'grid-drift 8s linear infinite',
        'shimmer': 'shimmer 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
