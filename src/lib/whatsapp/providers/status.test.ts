import { describe, expect, it } from 'vitest';
import { shouldApplyMessageStatus } from './status';

describe('shouldApplyMessageStatus', () => {
  it('allows forward lifecycle transitions', () => {
    expect(shouldApplyMessageStatus('sent', 'delivered')).toBe(true);
    expect(shouldApplyMessageStatus('delivered', 'read')).toBe(true);
  });

  it('rejects stale status updates that would downgrade a message', () => {
    expect(shouldApplyMessageStatus('read', 'delivered')).toBe(false);
    expect(shouldApplyMessageStatus('delivered', 'sent')).toBe(false);
  });

  it('allows failed status unless the message is already read', () => {
    expect(shouldApplyMessageStatus('sent', 'failed')).toBe(true);
    expect(shouldApplyMessageStatus('read', 'failed')).toBe(false);
  });

  it('does not replace an equal status unnecessarily', () => {
    expect(shouldApplyMessageStatus('delivered', 'delivered')).toBe(false);
  });
});
