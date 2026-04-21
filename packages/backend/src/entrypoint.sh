#!/bin/sh
# Entry point for the ONE IDP container.
#
# A single image powers two runtime tiers; the dispatch happens here
# based on SERVER_MODE:
#
#   SERVER_MODE=main   → Express HTTP API on PORT (web tier, App Runner)
#   SERVER_MODE=agent  → Strands agent server on AGENT_PORT (agent tier,
#                        Bedrock AgentCore Runtime)
#
# See docs/architecture.md for the boundary between tiers.

if [ "$SERVER_MODE" = "agent" ]; then
  echo "Starting Agent Server (mode: agent)"
  exec node packages/backend/dist/agent-server.js
else
  echo "Starting Main Backend (mode: main)"
  exec node packages/backend/dist/index.js
fi
