import type { ProcessingMethod } from '@idp/shared';
import { ProcessorBase } from './processor-base.js';
import { GuardrailsAdapter } from '../adapters/guardrails-adapter.js';

export class BedrockGuardrailsProcessor extends ProcessorBase {
  readonly method: ProcessingMethod = 'bedrock-guardrails';
  readonly adapter = new GuardrailsAdapter('bedrock-guardrails');
}
