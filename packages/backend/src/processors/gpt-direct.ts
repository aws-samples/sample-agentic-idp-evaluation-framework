import type { ProcessingMethod } from '@idp/shared';
import { ProcessorBase } from './processor-base.js';
import { MantleResponsesAdapter } from '../adapters/mantle-responses-adapter.js';

export class Gpt56SolProcessor extends ProcessorBase {
  readonly method: ProcessingMethod = 'gpt-5-6-sol';
  readonly adapter = new MantleResponsesAdapter('gpt-5-6-sol');
}

export class Gpt56TerraProcessor extends ProcessorBase {
  readonly method: ProcessingMethod = 'gpt-5-6-terra';
  readonly adapter = new MantleResponsesAdapter('gpt-5-6-terra');
}

export class Gpt56LunaProcessor extends ProcessorBase {
  readonly method: ProcessingMethod = 'gpt-5-6-luna';
  readonly adapter = new MantleResponsesAdapter('gpt-5-6-luna');
}

export class Gpt55Processor extends ProcessorBase {
  readonly method: ProcessingMethod = 'gpt-5-5';
  readonly adapter = new MantleResponsesAdapter('gpt-5-5');
}
