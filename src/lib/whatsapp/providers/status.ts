import type { MessageStatus } from '@/types';

const STATUS_RANK: Record<Exclude<MessageStatus, 'failed'>, number> = {
  sending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

/** Returns true only when an incoming provider status advances the local row. */
export function shouldApplyMessageStatus(
  current: MessageStatus | null | undefined,
  incoming: MessageStatus,
): boolean {
  if (!current) return true;
  if (incoming === 'failed') return current !== 'read' && current !== 'failed';
  if (current === 'failed') return false;
  return STATUS_RANK[incoming] > STATUS_RANK[current];
}
