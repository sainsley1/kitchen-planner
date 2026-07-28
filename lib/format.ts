export function formatQuantity(value: string | number | null | undefined): string {
  if (value == null) return "";

  const text = String(value).trim();
  const numeric = /^([+-]?\d+)(?:\.(\d+))?$/.exec(text);
  if (!numeric) return text;

  const fractional = (numeric[2] ?? "").replace(/0+$/, "");
  return fractional ? `${numeric[1]}.${fractional}` : numeric[1];
}
