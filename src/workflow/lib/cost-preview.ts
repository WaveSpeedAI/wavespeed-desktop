import { applyDiscount, getModelDiscountRate } from "@/lib/pricing";
import type { PriceDisplay } from "@/lib/pricing";
import type { Model } from "@/types/model";

export interface WorkflowCostPreview extends PriceDisplay {
  runCount: number;
}

function readRunCount(params?: Record<string, unknown>): number {
  const raw = Number(params?.__runCount ?? 1);
  if (!Number.isFinite(raw)) return 1;
  return Math.max(1, Math.floor(raw));
}

export function getWorkflowNodeCostPreview({
  nodeType,
  params,
  model,
}: {
  nodeType?: string;
  params?: Record<string, unknown>;
  model?: Model;
}): WorkflowCostPreview | null {
  if (nodeType !== "ai-task/run" || !model) return null;

  const basePrice = Number(model.base_price ?? 0);
  if (!Number.isFinite(basePrice) || basePrice <= 0) return null;

  const runCount = readRunCount(params);
  const display = applyDiscount(
    basePrice * runCount,
    getModelDiscountRate(model),
  );
  return { ...display, runCount };
}

export function aggregateWorkflowCostPreviews(
  previews: Array<WorkflowCostPreview | null | undefined>,
): PriceDisplay | null {
  const valid = previews.filter(
    (preview): preview is WorkflowCostPreview => !!preview,
  );
  if (valid.length === 0) return null;
  return valid.reduce<PriceDisplay>(
    (sum, preview) => ({
      price: sum.price + preview.price,
      discountedPrice: sum.discountedPrice + preview.discountedPrice,
    }),
    { price: 0, discountedPrice: 0 },
  );
}

export function hasWorkflowCostDiscount(price: PriceDisplay): boolean {
  return price.discountedPrice > 0 && price.discountedPrice < price.price;
}

export function formatWorkflowCost(value: number): string {
  if (!Number.isFinite(value)) return "0.0000";
  const normalized = Math.max(0, value);
  if (normalized >= 1) return normalized.toFixed(2);
  if (normalized >= 0.01) return normalized.toFixed(3);
  return normalized.toFixed(4);
}
