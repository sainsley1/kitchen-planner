import Link from "next/link";
import { MetricCard } from "@/components/metric-card";
import { QuickUpdate } from "@/components/quick-update";
import { SectionCard } from "@/components/section-card";
import { requirePageSession } from "@/lib/auth/session";
import { getDashboard } from "@/lib/db/queries";
import { formatQuantity } from "@/lib/format";
import { appConfig } from "@/lib/config";

const label = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default async function DashboardPage() {
  const session = await requirePageSession();
  const data = await getDashboard(session.householdId);
  const meals = (type: string) => {
    const entries = data.meals.filter((entry) => entry.mealType === type);
    if (!entries.length) return <span className="today-meal-line">Open</span>;
    return (
      <span className="today-meal-lines">
        {entries.map((entry, index) => (
          <span
            className="today-meal-line"
            key={`${entry.assignedName ?? "household"}-${entry.dish}-${index}`}
          >
            {entry.assignedName && <b>{entry.assignedName}: </b>}
            {entry.dish}
          </span>
        ))}
      </span>
    );
  };

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Today · {session.displayName}</span>
          <h1>Everything for today</h1>
          <p>Live meals, stock and the next useful household action.</p>
        </div>
        <span className="demo-banner">Database-backed · staging data</span>
      </div>
      <div className="metric-grid">
        <MetricCard label="Inventory" value={data.metrics.inventoryCount} detail="active records" />
        <MetricCard
          label="Use now"
          value={data.metrics.useNowCount}
          detail="needs attention"
          tone="coral"
        />
        <MetricCard
          label="Shopping"
          value={data.metrics.shoppingOpenCount}
          detail="still to buy"
          tone="amber"
        />
        <MetricCard label="Data mode" value="Safe" detail="audited writes" tone="blue" />
      </div>
      <div className="dashboard-grid">
        <SectionCard title="Today's meals" action={<Link href="/meal-plan">Full plan →</Link>}>
          <div className="meal-timeline">
            <div>
              <span>Breakfast</span>
              <strong>{meals("breakfast")}</strong>
            </div>
            <div>
              <span>Lunch</span>
              <strong>{meals("lunch")}</strong>
            </div>
            <div>
              <span>Dinner</span>
              <strong>{meals("dinner")}</strong>
            </div>
          </div>
        </SectionCard>
        <SectionCard title="Use first" action={<Link href="/inventory">Inventory →</Link>}>
          <div className="use-first">
            {data.useFirst.map((item) => (
              <div key={item.id}>
                <span className={`priority priority-${item.priority.replaceAll("_", "-")}`}>
                  {label(item.priority)}
                </span>
                <p>
                  <strong>{item.ingredient}</strong>
                  <small>
                    {item.quantity == null ? "?" : formatQuantity(item.quantity)} {item.unit ?? ""}{" "}
                    · {item.locationName ?? "Unknown"}
                  </small>
                </p>
              </div>
            ))}
            {!data.useFirst.length && <p className="muted">Nothing is currently flagged.</p>}
          </div>
        </SectionCard>
        <SectionCard title="Quick update" className="wide-card">
          <QuickUpdate aiConfigured={appConfig.aiConfigured} />
        </SectionCard>
        <SectionCard title="Shopping snapshot" action={<Link href="/shopping">Open list →</Link>}>
          <ul className="simple-list">
            {data.shopping.map((item) => (
              <li key={item.id}>
                <span>{item.item}</span>
                <strong>
                  {formatQuantity(item.quantity)} {item.unit ?? ""}
                </strong>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}
