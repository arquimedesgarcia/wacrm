"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message, Conversation } from "@/types";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface RealtimeEvent<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T;
  old: Partial<T>;
}

interface UseRealtimeOptions {
  channelName: string;
  onMessageEvent?: (event: RealtimeEvent<Message>) => void;
  onConversationEvent?: (event: RealtimeEvent<Conversation>) => void;
  enabled?: boolean;
}

/**
 * Whether the realtime channel is currently delivering events. Only
 * `SUBSCRIBED` counts as connected — every other status reported by
 * Supabase (`CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`, or anything else)
 * means the WebSocket is no longer a reliable event source, so we
 * surface it to the consumer and let the consumer trigger a resync
 * (.hermes/plans/2026-09-04_1100-inbox-realtime-resilience.md).
 */
export function isRealtimeConnected(status: string): boolean {
  return status === "SUBSCRIBED";
}

export function useRealtime({
  channelName,
  onMessageEvent,
  onConversationEvent,
  enabled = true,
}: UseRealtimeOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Store latest callbacks in refs to avoid re-subscribing when the
  // parent re-renders with fresh closures. Assigned inside an effect
  // so the mutation doesn't happen during render (React 19's refs
  // rule) — subscribers only read `.current` inside async Realtime
  // callbacks, which always run after the render that updates it.
  const onMessageRef = useRef(onMessageEvent);
  const onConversationRef = useRef(onConversationEvent);
  useEffect(() => {
    onMessageRef.current = onMessageEvent;
    onConversationRef.current = onConversationEvent;
  });

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        (payload) => {
          onMessageRef.current?.({
            eventType: payload.eventType as RealtimeEvent<Message>["eventType"],
            new: payload.new as Message,
            old: payload.old as Partial<Message>,
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) => {
          onConversationRef.current?.({
            eventType: payload.eventType as RealtimeEvent<Conversation>["eventType"],
            new: payload.new as Conversation,
            old: payload.old as Partial<Conversation>,
          });
        }
      )
      .subscribe((status) => {
        // Map every status Supabase delivers — not just SUBSCRIBED — to
        // the connected flag. Previously we only set true on SUBSCRIBED
        // and never reset to false on error, which left callers believing
        // they were receiving events while the channel was silently dead
        // (.hermes/plans/2026-09-04_1100-inbox-realtime-resilience.md).
        setIsConnected(isRealtimeConnected(status));
        if (!isRealtimeConnected(status)) {
          // Detach so a later reconnect resubscribes cleanly instead of
          // relying on Supabase to transparently re-handshake a half-broken
          // channel. The next render of the effect recreates the channel.
          channelRef.current = null;
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current === channel) {
        supabase.removeChannel(channel);
        channelRef.current = null;
      }
      setIsConnected(false);
    };
  }, [channelName, enabled]);

  const unsubscribe = useCallback(() => {
    if (channelRef.current) {
      const supabase = createClient();
      const ch = channelRef.current;
      channelRef.current = null;
      supabase.removeChannel(ch);
      setIsConnected(false);
    }
  }, []);

  return { isConnected, unsubscribe };
}
