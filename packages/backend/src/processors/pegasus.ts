import type { ProcessingMethod } from '@idp/shared';
import { ProcessorBase } from './processor-base.js';
import { PegasusAdapter } from '../adapters/pegasus-adapter.js';

/** TwelveLabs Pegasus — video understanding via InvokeModel, not Converse. */
export class TwelveLabsPegasusProcessor extends ProcessorBase {
  readonly method: ProcessingMethod = 'twelvelabs-pegasus';
  readonly adapter = new PegasusAdapter('twelvelabs-pegasus');
}
