// server.js — thin entrypoint that:
//   1. loads local .env (dev)
//   2. pulls secrets from AWS Secrets Manager (Fargate prod) if configured
//   3. hands off to server-main.js, which contains the actual server code
//
// Doing it in this order matters: server-main.js require()s dozens of route/
// service modules, and some of them read process.env at import time. So the
// bootstrap MUST finish before we require server-main.
//
// Local dev: AWS_SECRET_IDS is unset → bootstrap becomes a no-op, only .env is used.
// Fargate:   task-def sets AWS_SECRET_IDS → secrets get fetched and merged into env.

require('dotenv').config();

(async () => {
  try {
    await require('./bootstrap').loadSecrets();
    require('./server-main');
  } catch (err) {
    console.error('[server] Fatal startup error:', err);
    // Non-zero exit → Fargate restarts the task. Better to fail loud than run
    // half-configured.
    process.exit(1);
  }
})();
