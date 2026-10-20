// Tailwind first, so every component's own .css (imported through App) comes after the utilities: the order the
// Play CDN produced (see index.css).
import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { enableFontStylesheet } from './utils/fontStyles';

enableFontStylesheet();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);