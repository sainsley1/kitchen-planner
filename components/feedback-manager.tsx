"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { FeedbackRecord, HouseholdUserRecord, RecipeRecord } from "@/lib/db/queries";
import { householdDateKey } from "@/lib/datetime";
import { FEEDBACK_RATINGS, REPEAT_DECISIONS } from "@/lib/options";

export function FeedbackManager({
  items,
  users,
  recipes,
  timeZone,
}: {
  items: FeedbackRecord[];
  users: HouseholdUserRecord[];
  recipes: RecipeRecord[];
  timeZone: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [recipeId, setRecipeId] = useState("");
  const [dish, setDish] = useState("");
  const [rating, setRating] = useState("Like");
  const [feedback, setFeedback] = useState("");
  const [changes, setChanges] = useState("");
  const [decision, setDecision] = useState("Repeat");
  const [error, setError] = useState("");
  async function add(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/v1/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        feedbackDate: householdDateKey(new Date(), timeZone),
        userId,
        recipeId: recipeId || null,
        dish,
        rating,
        feedback,
        nextTimeChanges: changes,
        repeatDecision: decision,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return setError(body.error || "Could not record feedback.");
    setDish("");
    setRecipeId("");
    setFeedback("");
    setChanges("");
    setAdding(false);
    router.refresh();
  }
  async function remove(id: string) {
    if (!window.confirm("Delete this feedback entry?")) return;
    await fetch(`/api/v1/feedback/${id}`, { method: "DELETE" });
    router.refresh();
  }
  return (
    <>
      {adding ? (
        <form className="entity-form" onSubmit={add}>
          <div className="form-grid">
            <label>
              Person
              <select value={userId} onChange={(e) => setUserId(e.target.value)}>
                {users.map((user) => (
                  <option value={user.id} key={user.id}>
                    {user.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Rating
              <select value={rating} onChange={(e) => setRating(e.target.value)}>
                {FEEDBACK_RATINGS.map((value) => (
                  <option value={value} key={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="span-two">
              Saved recipe (optional)
              <select
                value={recipeId}
                onChange={(event) => {
                  setRecipeId(event.target.value);
                  const recipe = recipes.find((entry) => entry.id === event.target.value);
                  if (recipe) setDish(recipe.title);
                }}
              >
                <option value="">Not linked to a saved recipe</option>
                {recipes.map((recipe) => (
                  <option key={recipe.id} value={recipe.id}>
                    {recipe.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="span-two">
              Dish
              <input required value={dish} onChange={(e) => setDish(e.target.value)} />
            </label>
            <label className="span-two">
              Feedback
              <textarea required value={feedback} onChange={(e) => setFeedback(e.target.value)} />
            </label>
            <label className="span-two">
              Next-time changes
              <textarea value={changes} onChange={(e) => setChanges(e.target.value)} />
            </label>
            <label>
              Repeat decision
              <select value={decision} onChange={(e) => setDecision(e.target.value)}>
                {REPEAT_DECISIONS.map((value) => (
                  <option value={value} key={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="primary-button">Save feedback</button>
          </div>
        </form>
      ) : (
        <button className="primary-button add-inline" onClick={() => setAdding(true)}>
          Record feedback
        </button>
      )}
      <div className="feedback-grid">
        {items.map((entry) => (
          <article className="feedback-card" key={entry.id}>
            <header>
              <div>
                <span>
                  {entry.displayName ?? "Household"} · {entry.feedbackDate}
                </span>
                <h2>{entry.dish}</h2>
                {entry.recipeTitle && <small>Saved recipe · {entry.recipeTitle}</small>}
              </div>
              <strong>{entry.rating}</strong>
            </header>
            <p>“{entry.feedback}”</p>
            {entry.nextTimeChanges && (
              <p>
                <strong>Next time:</strong> {entry.nextTimeChanges}
              </p>
            )}
            <footer>
              <span>{entry.repeatDecision}</span>
              <button className="danger-link" onClick={() => remove(entry.id)}>
                Delete
              </button>
            </footer>
          </article>
        ))}
      </div>
    </>
  );
}
