/**
 * Localizable API error catalogue.
 *
 * Wire protocol: every server response is the standard envelope
 *   { data } | { error: { code, message? } }
 *
 * `code` is the only thing the UI branches on. It maps to a key in
 * `Errors.apiErrors.<code>` (see messages/{en,es,ko}.json). The
 * server may still attach a `message` for logs, but client code
 * MUST translate by `code` and never render `message` directly —
 * external providers (Meta, Evolution, Supabase) ship their own
 * locale, and we want one source of truth for user-facing copy.
 *
 * This module is framework-free: it exports the catalogue plus two
 * pure helpers. The two thin wrappers for the next-intl translator
 * live in `use-api-error.ts` and `get-api-error.ts` so that the
 * import graph stays clean (client / server / RSC).
 */

export type ApiErrorCode = string;

/**
 * Curated list of error codes that travel on the wire. Add a new
 * entry here when a new failure mode is introduced server-side, and
 * add the matching translation in `Errors.apiErrors.*` for every
 * locale. `src/i18n/messages.test.ts` enforces parity.
 */
export const API_ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'rate_limited',
  'bad_request',
  'not_found',
  'internal',
  'whatsapp_not_configured',
  'whatsapp_not_connected',
  'instance_not_connected',
  'meta_rate_limit',
  'meta_phone_number_missing',
  'waba_id_missing',
  'waba_no_subscribed_apps',
  'evolution_not_configured',
  'evolution_send_failed',
  'evolution_qr_unavailable',
  'evolution_create_failed',
  'evolution_invalid_url',
  'ai_not_configured',
  'ai_provider_timeout',
  'ai_provider_error',
  'ai_empty_response',
  'template_invalid',
  'template_not_found',
  'template_submit_failed',
  'template_meta_modified',
  'automation_invalid',
  'flow_invalid',
  'flow_not_found',
  'invite_not_found',
  'invite_expired',
  'invite_already_used',
  'api_key_not_found',
  'webhook_not_found',
  'broadcast_not_found',
  'contact_not_found',
  'conversation_not_found',
  'message_not_found',
  'permission_denied',
  'insufficient_role',
  'encryption_failed',
  'signature_invalid',
  'token_mismatch',
  'invalid_request_body',
  'invalid_json',
  'media_download_failed',
  'media_not_found',
  'media_id_required',
  'phone_number_invalid',
  'phone_number_required',
  'broadcast_in_progress',
  'broadcast_no_failed_recipients',
  'broadcast_no_recipients',
  'broadcast_already_resumed',
  'config_not_found',
  'config_save_failed',
  'config_load_failed',
  'config_delete_failed',
  'config_update_failed',
  'config_validate_failed',
  'config_encryption_corrupt',
  'recipients_load_failed',
  'contacts_load_failed',
  'conversations_load_failed',
  'messages_load_failed',
  'members_load_failed',
  'invitations_load_failed',
  'api_keys_load_failed',
  'webhooks_load_failed',
  'usage_load_failed',
  'ai_config_load_failed',
  'ai_config_save_failed',
  'ai_config_delete_failed',
  'knowledge_load_failed',
  'templates_load_failed',
  'templates_submit_failed',
  'templates_delete_failed',
  'templates_edit_failed',
  'templates_sync_failed',
  'documents_load_failed',
  'document_load_failed',
  'document_save_failed',
  'document_delete_failed',
  'document_update_failed',
  'invitation_create_failed',
  'invitation_redeem_failed',
  'invitation_revoke_failed',
  'invitation_accept_failed',
  'role_update_failed',
  'member_remove_failed',
  'ownership_transfer_failed',
  'api_key_create_failed',
  'api_key_revoke_failed',
  'webhook_create_failed',
  'webhook_delete_failed',
  'webhook_update_failed',
  'webhook_test_failed',
  'webhook_test_success',
  'broadcast_create_failed',
  'broadcast_read_failed',
  'broadcast_update_failed',
  'broadcast_resume_failed',
  'contact_create_failed',
  'contact_update_failed',
  'contact_load_failed',
  'conversation_create_failed',
  'conversation_read_failed',
  'conversation_update_failed',
  'automations_load_failed',
  'flows_load_failed',
  'pipelines_load_failed',
  'pipeline_seed_failed',
  'evolution_config_load_failed',
  'evolution_config_save_failed',
  'evolution_config_cleared',
  'evolution_config_clear_failed',
  'evolution_connected',
  'historical_import_started',
  'historical_import_start_failed',
  'webhook_url_copied',
  'quick_reply_create_failed',
  'quick_reply_update_failed',
  'quick_reply_delete_failed',
  'quick_reply_created',
  'quick_reply_updated',
  'quick_reply_deleted',
  'file_uploaded',
  'upload_failed',
  'microphone_denied',
  'voice_too_long',
  'voice_no_message',
  'draft_no_messages',
  'media_send_failed',
  'message_send_failed',
  'interactive_send_failed',
  'template_send_failed',
  'unread_reset_failed',
  'mark_all_read_failed',
  'mark_notification_read_failed',
  'assignment_update_failed',
  'status_update_failed',
  'reactions_fetch_failed',
  'messages_fetch_failed',
  'conversations_fetch_failed',
  'profiles_fetch_failed',
  'contact_tags_fetch_failed',
  'media_retention_update_failed',
  'pipeline_create_failed',
  'pipeline_update_failed',
  'pipeline_delete_failed',
  'account_update_failed',
  'session_load_failed',
  'sign_out_failed',
  'network_error',
] as const;

export type KnownApiErrorCode = (typeof API_ERROR_CODES)[number];

/**
 * Build the i18n key for a code. The split between API code and
 * message template keeps wire data and presentation independent —
 * server can rename codes freely without a dictionary migration, and
 * translators only ever see finished copy.
 */
export function apiErrorKey(code: string): string {
  if ((API_ERROR_CODES as readonly string[]).includes(code)) {
    return `Errors.apiErrors.${code}`;
  }
  return 'Common.unknownError';
}

export function isKnownApiErrorCode(code: string): code is KnownApiErrorCode {
  return (API_ERROR_CODES as readonly string[]).includes(code);
}
