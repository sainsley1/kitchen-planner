import type { PoolClient } from "pg";

export type NormalizedUnitResult = {
  unitPrice: number | null;
  unitMeasure: string | null;
};

export type DealGrade = "A+" | "A" | "B" | "C" | "D" | "F";

export type DealScoringResult = {
  normalizedUnitPrice: number | null;
  normalizedUnitMeasure: string | null;
  estimatedRegularPrice: number | null;
  dealGrade: DealGrade;
};

/**
 * Normalizes package size and sale price into a standard unit rate (e.g., $/lb, $/oz, $/kg, $/each).
 */
export function normalizeUnitPrice(
  price: number,
  packageSize: string | null,
  pricingUnit: string | null,
  multiBuyQuantity: number | null = 1,
): NormalizedUnitResult {
  const effectivePrice = price / Math.max(1, multiBuyQuantity ?? 1);
  if (effectivePrice <= 0) return { unitPrice: null, unitMeasure: null };

  const input = `${packageSize ?? ""} ${pricingUnit ?? ""}`.toLowerCase().trim();
  if (!input) return { unitPrice: Number(effectivePrice.toFixed(2)), unitMeasure: "each" };

  // Pounds (lb / lbs)
  const lbMatch = input.match(/(\d+(?:\.\d+)?)\s*(?:lb|lbs|pound|pounds)\b/);
  if (lbMatch) {
    const lbs = parseFloat(lbMatch[1]);
    if (lbs > 0)
      return {
        unitPrice: Number((effectivePrice / lbs).toFixed(2)),
        unitMeasure: "lb",
      };
  }

  // Ounces (oz)
  const ozMatch = input.match(/(\d+(?:\.\d+)?)\s*(?:oz|ounce|ounces)\b/);
  if (ozMatch) {
    const oz = parseFloat(ozMatch[1]);
    if (oz > 0) {
      const perLb = (effectivePrice / oz) * 16;
      return {
        unitPrice: Number(perLb.toFixed(2)),
        unitMeasure: "lb",
      };
    }
  }

  // Grams (g)
  const gMatch = input.match(/(\d+(?:\.\d+)?)\s*(?:g|gram|grams)\b/);
  if (gMatch && !/kg|kilogram/.test(input)) {
    const grams = parseFloat(gMatch[1]);
    if (grams > 0) {
      const perKg = (effectivePrice / grams) * 1000;
      return {
        unitPrice: Number(perKg.toFixed(2)),
        unitMeasure: "kg",
      };
    }
  }

  // Kilograms (kg)
  const kgMatch = input.match(/(\d+(?:\.\d+)?)\s*(?:kg|kilogram|kilograms)\b/);
  if (kgMatch) {
    const kg = parseFloat(kgMatch[1]);
    if (kg > 0)
      return {
        unitPrice: Number((effectivePrice / kg).toFixed(2)),
        unitMeasure: "kg",
      };
  }

  // Fluid Ounces (fl oz)
  const flOzMatch = input.match(/(\d+(?:\.\d+)?)\s*(?:fl\s*oz|fluid\s*ounce)\b/);
  if (flOzMatch) {
    const flOz = parseFloat(flOzMatch[1]);
    if (flOz > 0)
      return {
        unitPrice: Number((effectivePrice / flOz).toFixed(2)),
        unitMeasure: "fl_oz",
      };
  }

  // Count / Pack (pcs, count, pack)
  const countMatch = input.match(/(\d+)\s*(?:ct|count|pack|pk|pcs|pieces)\b/);
  if (countMatch) {
    const count = parseInt(countMatch[1], 10);
    if (count > 0)
      return {
        unitPrice: Number((effectivePrice / count).toFixed(2)),
        unitMeasure: "each",
      };
  }

  return { unitPrice: Number(effectivePrice.toFixed(2)), unitMeasure: "each" };
}

/**
 * Calculates a historical deal grade (A+ to F) and estimates regular price based on printed values and 90-day store history.
 */
export function calculateDealGrade(
  salePrice: number,
  regularPrice: number | null,
  historicalAveragePrice: number | null,
  multiBuyQuantity: number | null = 1,
): { dealGrade: DealGrade; estimatedRegularPrice: number | null } {
  const perUnitSalePrice = Number((salePrice / Math.max(1, multiBuyQuantity ?? 1)).toFixed(2));
  const effectiveBaseline = regularPrice ?? historicalAveragePrice;

  if (effectiveBaseline == null || effectiveBaseline <= 0) {
    return { dealGrade: "C", estimatedRegularPrice: null };
  }

  // Check for artificial inflation (printed regular price is > 30% higher than historical 90-day average)
  if (
    regularPrice != null &&
    historicalAveragePrice != null &&
    historicalAveragePrice > 0 &&
    regularPrice >= historicalAveragePrice * 1.3
  ) {
    return {
      dealGrade: "F",
      estimatedRegularPrice: Number(historicalAveragePrice.toFixed(2)),
    };
  }

  const savingsRatio = (effectiveBaseline - perUnitSalePrice) / effectiveBaseline;

  if (savingsRatio >= 0.35)
    return {
      dealGrade: "A+",
      estimatedRegularPrice: Number(effectiveBaseline.toFixed(2)),
    };
  if (savingsRatio >= 0.25)
    return {
      dealGrade: "A",
      estimatedRegularPrice: Number(effectiveBaseline.toFixed(2)),
    };
  if (savingsRatio >= 0.15)
    return {
      dealGrade: "B",
      estimatedRegularPrice: Number(effectiveBaseline.toFixed(2)),
    };
  if (savingsRatio > 0)
    return {
      dealGrade: "C",
      estimatedRegularPrice: Number(effectiveBaseline.toFixed(2)),
    };

  return {
    dealGrade: "D",
    estimatedRegularPrice: Number(effectiveBaseline.toFixed(2)),
  };
}

/**
 * Queries 90-day historical average price for an ingredient at a specific store.
 */
export async function getHistoricalAveragePrice(
  client: PoolClient,
  householdId: string,
  storeName: string,
  normalizedIngredient: string,
): Promise<number | null> {
  const result = await client.query<{ avg_price: string }>(
    `SELECT AVG(sale_price)::numeric(10,2) AS avg_price
     FROM flyer_item_price_history
     WHERE household_id = $1
       AND lower(store_name) = lower($2)
       AND lower(normalized_ingredient) = lower($3)
       AND valid_from >= (now() - interval '90 days')::date`,
    [householdId, storeName, normalizedIngredient],
  );

  const raw = result.rows[0]?.avg_price;
  return raw != null ? Number(raw) : null;
}
