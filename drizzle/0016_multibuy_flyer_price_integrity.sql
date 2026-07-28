ALTER TABLE flyer_sale_items
  DROP CONSTRAINT IF EXISTS flyer_sale_regular_price_check;

ALTER TABLE flyer_sale_items
  ADD CONSTRAINT flyer_sale_regular_price_check
    CHECK (
      regular_price IS NULL
      OR regular_price >= round(
        price / CASE WHEN COALESCE(multi_buy_quantity,1)>1 THEN multi_buy_quantity ELSE 1 END,
        2
      )
    );
