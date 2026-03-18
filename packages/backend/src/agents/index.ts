/**
 * Agent router - feature-flagged between legacy (raw ConverseStream) and Strands SDK.
 * Set USE_STRANDS_AGENT=true to use Strands-based agents.
 */
export { runSocraticAgent, type SocraticAgentOptions } from './socratic-agent.js';
export { runSocraticAgentStrands } from './socratic-agent-strands.js';

export function useStrandsAgent(): boolean {
  return process.env.USE_STRANDS_AGENT === 'true';
}
