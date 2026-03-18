import type { ProcessingMethod } from '@idp/shared';
import { ProcessorBase } from './processor-base.js';
import { TokenStreamAdapter } from '../adapters/token-stream-adapter.js';

export class NovaLiteProcessor extends ProcessorBase {
  readonly method: ProcessingMethod = 'nova-lite';
  readonly adapter = new TokenStreamAdapter('nova-lite');
}

export class NovaProProcessor extends ProcessorBase {
  readonly method: ProcessingMethod = 'nova-pro';
  readonly adapter = new TokenStreamAdapter('nova-pro');
}
