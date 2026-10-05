-- CC-007: migration 002 shipped the strict append-only trigger with the note
-- "Swap to the is_posted_to_gl-exception version only when Phase 3's GL auto-posting
-- job ships". Phase 3 (glPosting.service.ts) shipped and sets is_posted_to_gl=true after
-- posting, but the swap never happened, so every cost->GL posting rolled back.
-- This is that exception version: the ONLY permitted UPDATE flips is_posted_to_gl from
-- false to true with every other column unchanged. DELETE remains forbidden.
CREATE OR REPLACE FUNCTION prevent_cost_transactions_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD.is_posted_to_gl = false
       AND NEW.is_posted_to_gl = true
       AND (to_jsonb(NEW) - 'is_posted_to_gl') = (to_jsonb(OLD) - 'is_posted_to_gl') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION
        'cost_transactions is an append-only ledger — % is not permitted on row id %. Post a correction via cost_adjustment_requests instead.',
        TG_OP, COALESCE(OLD.id, NEW.id);
END;
$$ LANGUAGE plpgsql;
