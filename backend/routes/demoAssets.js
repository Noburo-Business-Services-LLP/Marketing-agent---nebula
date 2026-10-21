'use strict';
/**
 * Pictures of the demo account (scripts/seed-demo-brand.js), made locally and kept in the git-ignored folder
 * backend/demo-assets. Served at /demo-assets by a development server ONLY: never when NODE_ENV is production,
 * so nothing demo is ever reachable from the production app (decision D112).
 */
const path = require('path');
const express = require('express');

const DEMO_ASSETS_DIR = path.join(__dirname, '..', 'demo-assets');
const DEMO_ASSETS_ROUTE = '/demo-assets';

/** Mounts the folder on `app` unless this is production. Returns true when it was mounted. */
function mountDemoAssets(app, { env = process.env, dir = DEMO_ASSETS_DIR } = {}) {
  if (String((env && env.NODE_ENV) || '').toLowerCase() === 'production') return false;
  app.use(DEMO_ASSETS_ROUTE, express.static(dir, { fallthrough: false, index: false, dotfiles: 'deny', maxAge: '1h' }));
  return true;
}

module.exports = { DEMO_ASSETS_DIR, DEMO_ASSETS_ROUTE, mountDemoAssets };
