/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: '#0B1F3A',
          foreground: '#FFFFFF',
          hover: '#071A33',
        },
        secondary: {
          DEFAULT: '#EAF2FB',
          foreground: '#0B1F3A',
          hover: '#D8E8F8',
        },
        destructive: {
          DEFAULT: '#C53030',
          foreground: '#FFFFFF',
        },
        muted: {
          DEFAULT: '#F6F8FB',
          foreground: '#64748B',
        },
        accent: {
          DEFAULT: '#EAF2FB',
          foreground: '#0B1F3A',
        },
        popover: {
          DEFAULT: '#FFFFFF',
          foreground: '#172B4D',
        },
        card: {
          DEFAULT: '#FFFFFF',
          foreground: '#172B4D',
        },
        // ENCRIX Design System Color Tokens
        navy: {
          deep: '#0B1F3A',
          dark: '#071A33',
          DEFAULT: '#0B1F3A',
        },
        blue: {
          secondary: '#1E4D8F',
          soft: '#EAF2FB',
          accent: '#1E4D8F',
        },
        page: '#F6F8FB',
        surface: '#FFFFFF',
        encrix: {
          border: '#DCE4EE',
          primary: '#0B1F3A',
          text: '#172B4D',
          secondary: '#64748B',
          muted: '#94A3B8',
          success: '#16845B',
          warning: '#B7791F',
          error: '#C53030',
          softBlue: '#EAF2FB',
          actionBlue: '#1E4D8F',
        },
      },
      borderRadius: {
        card: '12px',
        btn: '10px',
        input: '10px',
        lg: '12px',
        md: '10px',
        sm: '8px',
      },
      boxShadow: {
        subtle: '0 2px 8px rgba(11, 31, 58, 0.05)',
        card: '0 2px 8px rgba(11, 31, 58, 0.05)',
        elevated: '0 4px 16px rgba(11, 31, 58, 0.08)',
        dropdown: '0 8px 24px rgba(11, 31, 58, 0.10)',
      },
      transitionDuration: {
        DEFAULT: '200ms',
        smooth: '200ms',
      },
    },
  },
  plugins: [],
}
