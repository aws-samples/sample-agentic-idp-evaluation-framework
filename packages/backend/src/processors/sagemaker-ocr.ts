import type { ProcessingMethod } from '@idp/shared';
import { ProcessorBase } from './processor-base.js';
import { SageMakerOcrAdapter } from '../adapters/sagemaker-ocr-adapter.js';

/**
 * Specialist OCR models on self-hosted SageMaker endpoints.
 *
 * One adapter serves all six; only the endpoint name and response format differ, and
 * both are keyed off the method id inside the adapter. Each still needs its own
 * processor class because the three route registries key on method id.
 */
export class SageMakerInfinityParser2Processor extends ProcessorBase {
  readonly method: ProcessingMethod = 'sagemaker-infinity-parser2';
  readonly adapter = new SageMakerOcrAdapter('sagemaker-infinity-parser2');
}

export class SageMakerBaiduOcrProcessor extends ProcessorBase {
  readonly method: ProcessingMethod = 'sagemaker-baidu-ocr';
  readonly adapter = new SageMakerOcrAdapter('sagemaker-baidu-ocr');
}

export class SageMakerSuryaOcrProcessor extends ProcessorBase {
  readonly method: ProcessingMethod = 'sagemaker-surya-ocr';
  readonly adapter = new SageMakerOcrAdapter('sagemaker-surya-ocr');
}

export class SageMakerChandraOcrProcessor extends ProcessorBase {
  readonly method: ProcessingMethod = 'sagemaker-chandra-ocr';
  readonly adapter = new SageMakerOcrAdapter('sagemaker-chandra-ocr');
}

export class SageMakerDotsOcrProcessor extends ProcessorBase {
  readonly method: ProcessingMethod = 'sagemaker-dots-ocr';
  readonly adapter = new SageMakerOcrAdapter('sagemaker-dots-ocr');
}

export class SageMakerQwen3VlProcessor extends ProcessorBase {
  readonly method: ProcessingMethod = 'sagemaker-qwen3-vl';
  readonly adapter = new SageMakerOcrAdapter('sagemaker-qwen3-vl');
}
