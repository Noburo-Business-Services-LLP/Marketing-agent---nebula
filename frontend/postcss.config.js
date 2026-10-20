// PostCSS for Vite: Tailwind (tailwind.config.js) and vendor prefixes. Runs inside `vite build` and the dev server,
// so the Docker build stage needs the dev dependencies (Dockerfile.frontend runs `npm ci`, which installs them).
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
