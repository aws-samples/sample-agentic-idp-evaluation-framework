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
