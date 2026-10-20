// Tailwind CSS, built at build time (PostCSS inside `vite build` and the dev server).
// Same major and version as the Play CDN script that index.html used to load (cdn.tailwindcss.com served 3.4.17),
// and the same config that index.html set in the browser (`tailwind.config = {...}`): darkMode, colours, fonts, no plugins.
// See docs/superpowers/ops/frontend-performance.md ("Tailwind at build time").
//
// content: every file that can carry a class name. The Play CDN read the classes from the live page, so a class built
// from pieces at run time (`bg-${colour}-500`) worked there and would be lost here: there are none today (checked
// with a grep for template literals and string concatenation that build class names, 2026-10-20); write full class
// names, or add the pattern to `safelist` below.
/** @type {import('tailwindcss').Config} */
export default {
  content: {
    relative: true,
    files: [
      './index.html',
      './*.{ts,tsx}',
      './{components,pages,context,hooks,utils,services,constants}/**/*.{ts,tsx,js,jsx}',
      // Not here on purpose: scripts/ and tests/. The audit server (scripts/visual-audit/vite.audit.config.mjs) adds
      // its static fixture pages for itself, so the production build carries no audit-only classes.
    ],
  },
  // Classes the source builds from pieces (`hover:${...}`), so the content scan cannot see them whole. Found by grepping
  // for a variant prefix followed by ${ and by comparing every class in the DOM of every audit route with the build.
  safelist: [
    // components/NotificationBell.tsx: hover:${isDarkMode ? 'bg-[#ededed]/5' : 'bg-gray-50'}
    'hover:bg-[#ededed]/5',
    'hover:bg-gray-50',
    // pages/Dashboard.tsx: hover:${isDarkMode ? 'bg-[#161b22]' : 'bg-[#f5f5f5]'} and hover:${theme.text}
    // (context/ThemeContext.tsx getThemeClasses: text-[#ededed] / text-[#070A12])
    'hover:bg-[#161b22]',
    'hover:bg-[#f5f5f5]',
    'hover:text-[#ededed]',
    'hover:text-[#070A12]',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        nebula: {
          dark: '#070A12',
          gold: '#ffcc29',
          silver: '#ededed',
        },
        // Gravity design system (v2 redesign)
        gravity: {
          bg: '#0A0A0A', // app background, deep warm black
          sidebar: '#111111', // slightly lifted sidebar
          surface: '#151515', // card / panel surface
          surface2: '#1A1A1A', // elevated card
          border: 'rgba(255,255,255,0.06)',
          borderStrong: 'rgba(255,255,255,0.10)',
          gold: '#F5A623', // primary accent
          goldSoft: 'rgba(245,166,35,0.15)',
          text: '#F5F4F1', // warm off-white
          textMuted: 'rgba(255,255,255,0.55)',
          textDim: 'rgba(255,255,255,0.35)',
          success: '#4ADE80',
          info: '#60A5FA',
        },
      },
      fontFamily: {
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['"Plus Jakarta Sans"', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
