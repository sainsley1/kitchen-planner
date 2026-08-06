export function parseNumericQuantity(value: number | string | null | undefined): number | null {
  const parsed = value == null ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatQuantity(value: string | number | null | undefined): string {
  if (value == null) return "";

  const text = String(value).trim();
  const numeric = /^([+-]?\d+)(?:\.(\d+))?$/.exec(text);
  if (!numeric) return text;

  const num = Number(text);
  if (!isNaN(num)) {
    const rounded = Math.round((num + Number.EPSILON) * 1000) / 1000;
    const roundedText = String(rounded);
    const roundedNumeric = /^([+-]?\d+)(?:\.(\d+))?$/.exec(roundedText);
    if (roundedNumeric) {
      const fractional = (roundedNumeric[2] ?? "").replace(/0+$/, "");
      return fractional ? `${roundedNumeric[1]}.${fractional}` : roundedNumeric[1];
    }
  }

  const fractional = (numeric[2] ?? "").replace(/0+$/, "");
  return fractional ? `${numeric[1]}.${fractional}` : numeric[1];
}
