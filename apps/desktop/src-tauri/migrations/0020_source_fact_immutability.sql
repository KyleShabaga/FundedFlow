-- Build 10.5: captured source facts cannot be rewritten under historical claims.
-- Verification/reviewer metadata remains independent; corrections capture a new source.
CREATE TRIGGER trg_catalogue_source_facts_immutable
BEFORE UPDATE OF id, source_type, url, descriptor, publisher, captured_at, published_at,
                 effective_from, effective_to, content_hash ON catalogue_sources
WHEN NEW.id IS NOT OLD.id OR NEW.source_type IS NOT OLD.source_type
  OR NEW.url IS NOT OLD.url OR NEW.descriptor IS NOT OLD.descriptor
  OR NEW.publisher IS NOT OLD.publisher OR NEW.captured_at IS NOT OLD.captured_at
  OR NEW.published_at IS NOT OLD.published_at OR NEW.effective_from IS NOT OLD.effective_from
  OR NEW.effective_to IS NOT OLD.effective_to OR NEW.content_hash IS NOT OLD.content_hash
BEGIN SELECT RAISE(ABORT, 'captured source facts are immutable; capture a new source'); END;
