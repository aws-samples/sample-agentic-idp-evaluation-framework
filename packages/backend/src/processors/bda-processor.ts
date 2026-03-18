import type { ProcessingMethod } from '@idp/shared';
import { ProcessorBase } from './processor-base.js';
import { SyncPollAdapter } from '../adapters/sync-poll-adapter.js';

export class BdaStandardProcessor extends ProcessorBase {
  readonly method: ProcessingMethod = 'bda-standard';
  readonly adapter = new SyncPollAdapter('bda-standard');
}

export class BdaCustomProcessor extends ProcessorBase {
  readonly method: ProcessingMethod = 'bda-custom';
  readonly adapter = new SyncPollAdapter('bda-custom');
}
