-- ============================================================
-- 047_evolution_outbound_conversation_bump
--
-- Evolution delivers messages written on the linked phone itself as
-- MESSAGES_UPSERT events with key.fromMe === true. Those are outbound
-- from the account's perspective: they must update the conversation's
-- last-message preview but MUST NOT increment unread_count (otherwise a
-- reply the agent sent from their own phone shows up as an unread
-- customer message in WaCRM).
--
-- The inbound path already has bump_conversation_on_inbound (migration
-- 037), which atomically increments unread_count. This adds the outbound
-- twin: same summary refresh, no unread bump. Keeping it in the DB (rather
-- than a read-modify-write in the webhook) preserves the same concurrency
-- guarantee as migration 037.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.bump_conversation_on_outbound(
  p_conversation_id UUID,
  p_last_message_text TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE conversations
  SET last_message_text = p_last_message_text,
      last_message_at   = NOW(),
      updated_at        = NOW()
  WHERE id = p_conversation_id;
$$;

-- Only the service role (webhook) calls this. Lock everyone else out so an
-- authenticated user can't rewrite another account's conversation summary.
REVOKE ALL ON FUNCTION public.bump_conversation_on_outbound(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bump_conversation_on_outbound(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.bump_conversation_on_outbound(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.bump_conversation_on_outbound(UUID, TEXT) TO service_role;
