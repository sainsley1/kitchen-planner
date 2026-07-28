export const consumeInventorySql = `
  UPDATE inventory_entries
  SET quantity=$3::numeric,
    archived_at=CASE WHEN $3::numeric=0 THEN now() ELSE archived_at END,
    notes=CASE WHEN $3::numeric=0 THEN concat_ws(' ', notes, '[Consumed]') ELSE notes END,
    updated_at=now()
  WHERE id=$1 AND household_id=$2
  RETURNING *
`;
