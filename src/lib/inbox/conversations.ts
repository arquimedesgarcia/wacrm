import type { Conversation, Contact, Tag } from "@/types";

/**
 * Conversation select that embeds the contact plus its tags, so the Inbox
 * can filter conversations by contact tag without a second round-trip.
 * `contact_tags(tags(*))` returns the join rows; {@link normalizeConversation}
 * flattens them onto `contact.tags`.
 */
export const CONVERSATION_SELECT =
  "*, contact:contacts(*, contact_tags(tags(*)))";

/** Raw shape returned by {@link CONVERSATION_SELECT} before flattening. */
export type RawContact = Contact & { contact_tags?: { tags: Tag | null }[] };

/** Raw shape returned by the optional Inbox media query. */
export interface RawRecentMessage {
  id: string;
  conversation_id?: string;
  media_url: string | null;
  media_type: string | null;
  content_type: string;
  created_at: string;
}

export type RawConversation = Omit<Conversation, "contact"> & {
  contact?: RawContact | null;
};

/**
 * Pick the most recent image/video attachment to render as the inbox
 * thumbnail. Returns null when no message carries an image/video.
 */
export function pickLastMediaThumbnail(
  rows: RawRecentMessage[] | null | undefined,
): RawRecentMessage | null {
  if (!rows || rows.length === 0) return null;
  return rows.find(
    (row) =>
      Boolean(row.media_url) &&
      (row.content_type === "image" || row.content_type === "video"),
  ) ?? null;
}

/**
 * Flatten the embedded `contact_tags(tags(*))` join into `contact.tags`.
 * Safe to call on rows fetched with {@link CONVERSATION_SELECT}; a row with
 * no contact (e.g. a freshly-inserted conversation) passes through untouched.
 *
 * Also propagates the `recent_messages` array verbatim — the inbox list uses
 * it to render a media thumbnail without a second round-trip.
 */
export function normalizeConversation(raw: RawConversation): Conversation {
  const rawContact = raw.contact;
  if (!rawContact) return raw as Conversation;

  const { contact_tags, ...contact } = rawContact;
  return {
    ...raw,
    contact: {
      ...contact,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tags)
        .filter((t): t is Tag => t != null),
    },
  };
}

export function normalizeConversations(
  rows: RawConversation[],
): Conversation[] {
  return rows.map(normalizeConversation);
}

export interface ContactFilters {
  /** Tag ids; a conversation matches if its contact has ANY of them (OR). */
  tagIds: string[];
  /** Exact company match, or null for no company filter. */
  company: string | null;
}

/**
 * Whether a conversation passes the contact-based Inbox filters (issue #272).
 * Empty `tagIds` and null `company` are no-ops, so the default (no filters)
 * always matches. Tags use OR logic, consistent with Broadcast audiences.
 */
export function matchesContactFilters(
  conversation: Conversation,
  { tagIds, company }: ContactFilters,
): boolean {
  if (tagIds.length > 0) {
    const contactTagIds = conversation.contact?.tags ?? [];
    if (!contactTagIds.some((t) => tagIds.includes(t.id))) return false;
  }

  if (company !== null && conversation.contact?.company?.trim() !== company) {
    return false;
  }

  return true;
}

/**
 * Whether a conversation counts as active for the default Inbox view.
 * Closed conversations are excluded unless the user explicitly asks for them.
 */
export function isActiveConversation(conversation: Conversation): boolean {
  return conversation.status === "open" || conversation.status === "pending";
}

export interface InboxFilters extends ContactFilters {
  statusFilter: Conversation["status"] | "all";
  search: string;
  requireMessages: boolean;
  requireActive: boolean;
}

/**
 * Single predicate used by the Inbox to decide which conversations appear.
 * It combines status, activity, presence of messages, contact filters and
 * free-text search so the list can be filtered on the client without loading
 * contacts that have no messages.
 */
export function matchesInboxFilters(
  conversation: Conversation,
  filters: InboxFilters,
): boolean {
  if (filters.requireActive && !isActiveConversation(conversation)) {
    return false;
  }

  if (filters.statusFilter !== "all" && conversation.status !== filters.statusFilter) {
    return false;
  }

  if (
    filters.requireMessages &&
    (!conversation.last_message_at || !conversation.last_message_text)
  ) {
    return false;
  }

  if (!matchesContactFilters(conversation, filters)) {
    return false;
  }

  const q = filters.search.trim().toLowerCase();
  if (q) {
    const name = conversation.contact?.name?.toLowerCase() ?? "";
    const phone = conversation.contact?.phone?.toLowerCase() ?? "";
    const lastMsg = conversation.last_message_text?.toLowerCase() ?? "";
    if (!name.includes(q) && !phone.includes(q) && !lastMsg.includes(q)) {
      return false;
    }
  }

  return true;
}

/**
 * Sortable timestamp for a conversation. Uses the last message time when
 * available so the list order reflects real activity; falls back to creation
 * time for empty conversations when they are shown.
 */
export function conversationSortKey(conversation: Conversation): string {
  return conversation.last_message_at ?? conversation.created_at;
}
