import { describe, it, expect } from "vitest";
import {
  matchesContactFilters,
  normalizeConversation,
  isActiveConversation,
  matchesInboxFilters,
  conversationSortKey,
} from "./conversations";
import type { Conversation } from "@/types";

function makeMessage(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    conversation_id: "c1",
    sender_type: "customer",
    content_type: "text",
    status: "delivered",
    created_at: "2026-09-01T12:00:00Z",
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _messageHelper() {
  return makeMessage("unused");
}

describe("matchesContactFilters", () => {
  it("matches everything when no filters are set", () => {
    const conv = makeConversation("open", { company: "Acme", tags: [tag("t1")] });
    expect(matchesContactFilters(conv, { tagIds: [], company: null })).toBe(
      true,
    );
    expect(makeConversation("open", null)).toBeDefined();
    expect(
      matchesContactFilters(makeConversation("open", null), {
        tagIds: [],
        company: null,
      }),
    ).toBe(true);
  });

  it("uses OR logic across tags", () => {
    const conv = makeConversation("open", { tags: [tag("t1"), tag("t2")] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t2", "t9"], company: null }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: ["t9"], company: null }),
    ).toBe(false);
  });

  it("excludes conversations whose contact has no tags when a tag filter is active", () => {
    const conv = makeConversation("open", { tags: [] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: null }),
    ).toBe(false);
    expect(
      matchesContactFilters(makeConversation("open", null), {
        tagIds: ["t1"],
        company: null,
      }),
    ).toBe(false);
  });

  it("matches company exactly, trimming whitespace", () => {
    const conv = makeConversation("open", { company: "  Acme  " });
    expect(
      matchesContactFilters(conv, { tagIds: [], company: "Acme" }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: [], company: "Other" }),
    ).toBe(false);
  });

  it("requires both tag and company to match when both are set (AND across facets)", () => {
    const conv = makeConversation("open", { company: "Acme", tags: [tag("t1")] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: "Acme" }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: "Other" }),
    ).toBe(false);
    expect(
      matchesContactFilters(conv, { tagIds: ["tX"], company: "Acme" }),
    ).toBe(false);
  });
});

function makeConversation(
  status: Conversation["status"],
  contact: Partial<Conversation["contact"]> | null,
  overrides: Partial<Conversation> = {},
): Conversation {
  return {
    id: "c1",
    user_id: "u1",
    contact_id: "ct1",
    status,
    unread_count: 0,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    contact: contact
      ? {
          id: "ct1",
          user_id: "u1",
          account_id: "a1",
          phone: "123",
          created_at: "",
          updated_at: "",
          ...contact,
        }
      : undefined,
    ...overrides,
  };
}

const tag = (id: string, name = id) => ({
  id,
  user_id: "u1",
  name,
  color: "#fff",
  created_at: "",
});

describe("normalizeConversation", () => {
  it("flattens embedded contact_tags into contact.tags", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: {
        id: "ct1",
        user_id: "u1",
        account_id: "a1",
        phone: "123",
        created_at: "",
        updated_at: "",
        contact_tags: [{ tags: tag("t1", "VIP") }, { tags: null }],
      },
    };
    const normalized = normalizeConversation(raw);
    expect(normalized.contact?.tags).toEqual([tag("t1", "VIP")]);
    // The raw join key is dropped from the flattened contact.
    expect(
      (normalized.contact as unknown as Record<string, unknown>).contact_tags,
    ).toBeUndefined();
  });

  it("passes through a conversation with no contact", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: null,
    };
    // A contactless row passes through untouched (consumers use `?.`).
    expect(normalizeConversation(raw).contact).toBeNull();
  });
});

describe("isActiveConversation", () => {
  it("considers open and pending as active", () => {
    expect(isActiveConversation(makeConversation("open", null))).toBe(true);
    expect(isActiveConversation(makeConversation("pending", null))).toBe(true);
  });

  it("excludes closed conversations", () => {
    expect(isActiveConversation(makeConversation("closed", null))).toBe(false);
  });
});

describe("matchesInboxFilters", () => {
  it("default view keeps open/pending and excludes empty and closed conversations", () => {
    const open = makeConversation("open", null, {
      last_message_at: "2026-09-01T12:00:00Z",
      last_message_text: "hi",
    });
    const pending = makeConversation("pending", null, {
      last_message_at: "2026-09-01T12:00:00Z",
      last_message_text: "hi",
    });
    const closed = makeConversation("closed", null, {
      last_message_at: "2026-09-01T12:00:00Z",
      last_message_text: "hi",
    });
    const empty = makeConversation("open", null, {
      last_message_at: undefined,
      last_message_text: undefined,
    });

    expect(
      matchesInboxFilters(open, {
        statusFilter: "all",
        tagIds: [],
        company: null,
        search: "",
        requireMessages: true,
        requireActive: true,
      }),
    ).toBe(true);
    expect(
      matchesInboxFilters(pending, {
        statusFilter: "all",
        tagIds: [],
        company: null,
        search: "",
        requireMessages: true,
        requireActive: true,
      }),
    ).toBe(true);
    expect(
      matchesInboxFilters(closed, {
        statusFilter: "all",
        tagIds: [],
        company: null,
        search: "",
        requireMessages: true,
        requireActive: true,
      }),
    ).toBe(false);
    expect(
      matchesInboxFilters(empty, {
        statusFilter: "all",
        tagIds: [],
        company: null,
        search: "",
        requireMessages: true,
        requireActive: true,
      }),
    ).toBe(false);
  });

  it("allows closed conversations when active is not required", () => {
    const closed = makeConversation("closed", null, {
      last_message_at: "2026-09-01T12:00:00Z",
      last_message_text: "hi",
    });
    expect(
      matchesInboxFilters(closed, {
        statusFilter: "closed",
        tagIds: [],
        company: null,
        search: "",
        requireMessages: true,
        requireActive: false,
      }),
    ).toBe(true);
  });

  it("allows empty conversations only when messages are not required", () => {
    const empty = makeConversation("open", null, {
      last_message_at: undefined,
      last_message_text: undefined,
    });
    expect(
      matchesInboxFilters(empty, {
        statusFilter: "all",
        tagIds: [],
        company: null,
        search: "",
        requireMessages: false,
        requireActive: true,
      }),
    ).toBe(true);
  });

  it("applies status filter when explicit", () => {
    const open = makeConversation("open", null, {
      last_message_at: "2026-09-01T12:00:00Z",
      last_message_text: "hi",
    });
    expect(
      matchesInboxFilters(open, {
        statusFilter: "closed",
        tagIds: [],
        company: null,
        search: "",
        requireMessages: true,
        requireActive: false,
      }),
    ).toBe(false);
  });

  it("applies contact and search filters", () => {
    const conv = makeConversation("open", { name: "Alice", phone: "+15551234567" }, {
      last_message_at: "2026-09-01T12:00:00Z",
      last_message_text: "project update",
    });
    expect(
      matchesInboxFilters(conv, {
        statusFilter: "all",
        tagIds: [],
        company: null,
        search: "alice",
        requireMessages: true,
        requireActive: true,
      }),
    ).toBe(true);
    expect(
      matchesInboxFilters(conv, {
        statusFilter: "all",
        tagIds: [],
        company: null,
        search: "update",
        requireMessages: true,
        requireActive: true,
      }),
    ).toBe(true);
    expect(
      matchesInboxFilters(conv, {
        statusFilter: "all",
        tagIds: [],
        company: null,
        search: "bob",
        requireMessages: true,
        requireActive: true,
      }),
    ).toBe(false);
  });
});

describe("conversationSortKey", () => {
  it("prefers last_message_at", () => {
    const a = makeConversation("open", null, { last_message_at: "2026-09-01T12:00:00Z" });
    const b = makeConversation("open", null, { last_message_at: "2026-09-01T13:00:00Z" });
    expect(conversationSortKey(a)).toBe("2026-09-01T12:00:00Z");
    expect(conversationSortKey(b)).toBe("2026-09-01T13:00:00Z");
  });

  it("falls back to created_at when there is no last message", () => {
    const a = makeConversation("open", null, {
      created_at: "2026-09-01T10:00:00Z",
      last_message_at: undefined,
    });
    expect(conversationSortKey(a)).toBe("2026-09-01T10:00:00Z");
  });
});
