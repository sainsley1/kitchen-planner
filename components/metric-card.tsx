export function MetricCard({
  label,
  value,
  detail,
  tone = "green",
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: "green" | "amber" | "coral" | "blue";
}) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
