import type { ProcessingMethod } from '@idp/shared';
import { ProcessorBase } from './processor-base.js';
import { TwoPhaseAdapter } from '../adapters/two-phase-adapter.js';

export class TextractClaudeSonnetProcessor extends ProcessorBase {
  readonly method: ProcessingMethod = 'textract-claude-sonnet';
  readonly adapter = new TwoPhaseAdapter('textract-claude-sonnet');
}

export class TextractClaudeHaikuProcessor extends ProcessorBase {
  readonly method: ProcessingMethod = 'textract-claude-haiku';
  readonly adapter = new TwoPhaseAdapter('textract-claude-haiku');
}

export class TextractNovaLiteProcessor extends ProcessorBase {
  readonly method: ProcessingMethod = 'textract-nova-lite';
  readonly adapter = new TwoPhaseAdapter('textract-nova-lite');
}

export class TextractNovaProProcessor extends ProcessorBase {
  readonly method: ProcessingMethod = 'textract-nova-pro';
  readonly adapter = new TwoPhaseAdapter('textract-nova-pro');
}
