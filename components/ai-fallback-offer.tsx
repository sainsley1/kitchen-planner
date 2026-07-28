"use client";

export type FallbackOffer = { recommended: true; sourceJobId: string; reason: string };

export function AiFallbackOffer({
  offer,
  busy,
  onRetry,
}: {
  offer: FallbackOffer;
  busy: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="ai-fallback-offer">
      <div>
        <span className="eyebrow">Optional advanced retry</span>
        <strong>The initial result needs extra judgment.</strong>
        <p>{offer.reason}</p>
        <small>
          You can keep and approve the current proposal when one is shown, or explicitly spend a
          fallback call on the configured advanced model.
        </small>
      </div>
      <button type="button" className="secondary-button" disabled={busy} onClick={onRetry}>
        {busy ? "Retrying…" : "Retry with advanced model"}
      </button>
    </div>
  );
}
