import type { ProcessingMethod } from '@idp/shared';
import { METHOD_INFO } from '@idp/shared';

export function calculateCost(method: ProcessingMethod, pageCount: number): number {
  const info = METHOD_INFO[method];
  return Math.round(info.estimatedCostPerPage * pageCount * 1000) / 1000;
}

export function estimateMonthlyCost(
  method: ProcessingMethod,
  docsPerMonth: number,
  avgPagesPerDoc: number,
): number {
  const totalPages = docsPerMonth * avgPagesPerDoc;
  return calculateCost(method, totalPages);
}
