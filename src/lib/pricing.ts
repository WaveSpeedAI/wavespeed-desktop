import type { Model } from "@/types/model";

const PRICE_SCALE = 1_000_000;

export interface PriceDisplay {
  price: number;
  discountedPrice: number;
  discountRate?: number;
}

export function getModelDiscountRate(model?: Model | null): number | undefined {
  if (!model) return undefined;

  const promotionalRate = model.promotion_discount_rate ?? model.discount_rate;
  if (typeof promotionalRate === "number" && promotionalRate > 0) {
    if (promotionalRate < 100) return promotionalRate;
  }

  return undefined;
}

export function applyDiscount(
  price: number,
  discountRate?: number,
): PriceDisplay {
  const normalizedPrice = normalizeDisplayPrice(price);

  if (
    typeof discountRate === "number" &&
    discountRate > 0 &&
    discountRate < 100
  ) {
    return {
      price: normalizedPrice,
      discountedPrice: normalizedPrice * (discountRate / 100),
      discountRate,
    };
  }

  return {
    price: normalizedPrice,
    discountedPrice: normalizedPrice,
  };
}

function normalizeDisplayPrice(price: number): number {
  return Math.abs(price) >= PRICE_SCALE / 100 ? price / PRICE_SCALE : price;
}
