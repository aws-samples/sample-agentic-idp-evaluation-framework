import type { ProcessingMethod, ComparisonResult } from '@idp/shared';
import { METHOD_INFO } from '@idp/shared';
import { estimateMonthlyCost } from '../../services/pricing.js';

export interface ArchitecturePlan {
  recommendedMethod: ProcessingMethod;
  rationale: string;
  services: string[];
  costProjections: {
    scale: string;
    docsPerMonth: number;
    monthlyCost: number;
  }[];
}

export function generateArchitecture(
  comparison: ComparisonResult,
  capabilities: string[],
): ArchitecturePlan {
  // Pick the best overall method
  const best = comparison.methods[0];
  if (!best) {
    return {
      recommendedMethod: 'claude-sonnet',
      rationale: 'No comparison data available. Claude Sonnet is recommended as a versatile default.',
      services: ['Amazon Bedrock', 'Amazon S3', 'AWS Lambda'],
      costProjections: [],
    };
  }

  const method = best.method;
  const info = METHOD_INFO[method];

  const services: string[] = ['Amazon S3'];
  switch (method) {
    case 'bda-standard':
    case 'bda-custom':
      services.push('Amazon Bedrock Data Automation', 'Amazon Bedrock');
      break;
    case 'claude-sonnet':
    case 'claude-haiku':
    case 'claude-opus':
    case 'nova-pro':
    case 'nova-lite':
      services.push('Amazon Bedrock');
      break;
    case 'textract-claude-sonnet':
    case 'textract-claude-haiku':
    case 'textract-nova-lite':
    case 'textract-nova-pro':
      services.push('Amazon Textract', 'Amazon Bedrock');
      break;
  }
  services.push('AWS Lambda', 'Amazon API Gateway', 'Amazon DynamoDB', 'Amazon CloudWatch');

  const avgPages = 5;
  const scales = [
    { scale: 'small', docsPerMonth: 1_000 },
    { scale: 'medium', docsPerMonth: 10_000 },
    { scale: 'large', docsPerMonth: 100_000 },
  ];

  const costProjections = scales.map(({ scale, docsPerMonth }) => ({
    scale,
    docsPerMonth,
    monthlyCost: estimateMonthlyCost(method, docsPerMonth, avgPages),
  }));

  return {
    recommendedMethod: method,
    rationale: `${info.name} ranked #1 overall with ${best.metrics.latencyMs}ms latency, $${best.metrics.cost.toFixed(3)} cost, and ${(best.metrics.confidence * 100).toFixed(0)}% confidence. It provides the best balance for your ${capabilities.length} selected capabilities.`,
    services,
    costProjections,
  };
}
