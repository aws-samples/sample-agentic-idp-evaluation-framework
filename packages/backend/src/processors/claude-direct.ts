import type { ProcessingMethod } from '@idp/shared';
import { ProcessorBase } from './processor-base.js';
import { TokenStreamAdapter } from '../adapters/token-stream-adapter.js';

export class ClaudeSonnetProcessor extends ProcessorBase {
  readonly method: ProcessingMethod = 'claude-sonnet';
  readonly adapter = new TokenStreamAdapter('claude-sonnet');
}

export class ClaudeHaikuProcessor extends ProcessorBase {
  readonly method: ProcessingMethod = 'claude-haiku';
  readonly adapter = new TokenStreamAdapter('claude-haiku');
}

export class ClaudeOpusProcessor extends ProcessorBase {
  readonly method: ProcessingMethod = 'claude-opus';
  readonly adapter = new TokenStreamAdapter('claude-opus');
}

export class ClaudeOpus48Processor extends ProcessorBase {
  readonly method: ProcessingMethod = 'claude-opus-4-8';
  readonly adapter = new TokenStreamAdapter('claude-opus-4-8');
}

export class ClaudeOpus47Processor extends ProcessorBase {
  readonly method: ProcessingMethod = 'claude-opus-4-7';
  readonly adapter = new TokenStreamAdapter('claude-opus-4-7');
}

export class ClaudeSonnet5Processor extends ProcessorBase {
  readonly method: ProcessingMethod = 'claude-sonnet-5';
  readonly adapter = new TokenStreamAdapter('claude-sonnet-5');
}
