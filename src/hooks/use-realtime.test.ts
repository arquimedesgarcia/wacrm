import { describe, expect, it } from 'vitest';
import { isRealtimeConnected } from './use-realtime';

describe('isRealtimeConnected', () => {
  it('returns true for SUBSCRIBED', () => {
    expect(isRealtimeConnected('SUBSCRIBED')).toBe(true);
  });

  it('returns false for CHANNEL_ERROR', () => {
    // The previous implementation only ever set the connected flag to
    // true on SUBSCRIBED and never reset to false on error. That meant
    // a silently dead WS kept the inbox thinking it was receiving
    // events. This is the regression we are guarding against.
    expect(isRealtimeConnected('CHANNEL_ERROR')).toBe(false);
  });

  it('returns false for TIMED_OUT', () => {
    expect(isRealtimeConnected('TIMED_OUT')).toBe(false);
  });

  it('returns false for CLOSED', () => {
    expect(isRealtimeConnected('CLOSED')).toBe(false);
  });

  it('treats unknown statuses as disconnected (defense in depth)', () => {
    // Any future status Supabase may introduce should default to
    // "not delivering events", so a missing mapping cannot leave the
    // hook believing the channel is healthy.
    expect(isRealtimeConnected('SOMETHING_NEW')).toBe(false);
    expect(isRealtimeConnected('')).toBe(false);
  });
});