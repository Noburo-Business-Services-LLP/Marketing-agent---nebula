#!/bin/sh
# Container entry point (hardening E6). Sets the V8 heap from NODE_HEAP_MB (megabytes, default 1536) and runs the
# API server as PID 1 via exec, so SIGTERM from ECS reaches node directly (graceful drain).
#   no arguments or "server"  -> node --max-old-space-size=$NODE_HEAP_MB server.js
#   anything else             -> run it as given (smoke tests, one-off scripts) with the same heap via NODE_OPTIONS
set -eu
HEAP="${NODE_HEAP_MB:-1536}"
case "$HEAP" in
  ''|*[!0-9]*) echo "NODE_HEAP_MB must be a whole number of megabytes (got '$HEAP')" >&2; exit 64 ;;
esac
if [ "$#" -eq 0 ] || [ "$1" = "server" ]; then
  exec node --max-old-space-size="$HEAP" server.js
fi
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=$HEAP"
exec "$@"
