#!/bin/bash
# Throwaway server: local database only, fake keys, no outside providers.
cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign/backend"
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" >/dev/null
env -i HOME="$HOME" PATH="$PATH" NODE_ENV=production PORT=5055 \
  MONGODB_URI="mongodb://127.0.0.1:27055/attack_test" JWT_SECRET="attack-test-secret-not-real" \
  ADMIN_EMAIL="admin@attack.test" ADMIN_PASSWORD="attack-admin-pass" \
  SIGNUPS_PER_DAY=0 \
  node server.js
