import { ProcessorBase } from './processor-base.js';
import { BdaLlmAdapter } from '../adapters/bda-llm-adapter.js';

export class BdaClaudeSonnetProcessor extends ProcessorBase {
  readonly method = 'bda-claude-sonnet' as any;
  readonly adapter = new BdaLlmAdapter('bda-claude-sonnet' as any);
}

export class BdaClaudeHaikuProcessor extends ProcessorBase {
  readonly method = 'bda-claude-haiku' as any;
  readonly adapter = new BdaLlmAdapter('bda-claude-haiku' as any);
}

export class BdaNovaLiteProcessor extends ProcessorBase {
  readonly method = 'bda-nova-lite' as any;
  readonly adapter = new BdaLlmAdapter('bda-nova-lite' as any);
}
