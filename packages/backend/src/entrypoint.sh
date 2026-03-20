#!/bin/sh
# Entry point for IDP container
# SERVER_MODE=main  → HTTP API server (App Runner)
# SERVER_MODE=agent → Strands agent server (AgentCore)

if [ "$SERVER_MODE" = "agent" ]; then
  echo "Starting Agent Server (mode: agent)"
  exec node packages/backend/dist/agent-server.js
else
  echo "Starting Main Backend (mode: main)"
  exec node packages/backend/dist/index.js
fi
