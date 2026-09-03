'use client';

// ============================================================
// /join/[token] — invitation redemption landing page.
//
// Four UI states driven by:
//   - the peek result (server-validated invite payload), and
//   - whether the visitor is currently authenticated.
//
//   ┌──────────────────────┬───────────────┬─────────────────────────┐
//   │ peek                 │ auth          │ render                   │
//   ├──────────────────────┼───────────────┼─────────────────────────┤
//   │ loading              │ —             │ spinner                  │
//   │ ok:false (any reason)│ —             │ friendly error + signup  │
//   │ ok:true              │ signed out    │ "Sign up" + "Sign in"    │
//   │ ok:true              │ signed in     │ "Accept" button → redeem │
//   └──────────────────────┴───────────────┴─────────────────────────┘
//
// We deliberately do NOT redeem automatically on page load — the
// invitee should confirm what account/role they're accepting.
// Auto-redeem would also race with the signup flow returning to
// this page after email verification.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  MailX,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createClient } from '@/lib/supabase/client';
import { useApiError } from '@/features/i18n/use-api-error';

interface PeekOk {
  ok: true;
  account_name: string;
  role: 'admin' | 'agent' | 'viewer';
  expires_at: string;
}
interface PeekFail {
  ok: false;
  reason: 'not_found' | 'used' | 'expired' | 'server_error';
}
type PeekResult = PeekOk | PeekFail;

/** Wire error envelope: `{ error: { code, message? } }`. */
function errorCodeOf(data: unknown): string | undefined {
  const err =
    data && typeof data === 'object'
      ? (data as { error?: unknown }).error
      : undefined;
  const code =
    err && typeof err === 'object'
      ? (err as { code?: unknown }).code
      : undefined;
  return typeof code === 'string' ? code : undefined;
}

export default function JoinPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const t = useTranslations('Join');
  const tRole = useTranslations('Settings.roles');
  const tError = useApiError();

  const [peek, setPeek] = useState<PeekResult | null>(null);
  // Local auth probe — the AuthProvider lives inside the (dashboard)
  // route group, so it doesn't reach this page. We hit Supabase
  // directly the same way `/login` and `/signup` do.
  const [authedUserId, setAuthedUserId] = useState<string | null | undefined>(
    undefined, // undefined = unknown / still loading; null = signed out
  );
  const [accepting, setAccepting] = useState(false);
  // `redeem_invitation` returns 409 when the caller's current account
  // has domain data, or they're already a member of a shared account.
  // A transient toast wasn't enough — the user has no actionable next
  // step. Surface a blocking modal that walks them through it.
  const [conflictOpen, setConflictOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Extracted so the "Try again" button on the server_error card
  // can re-run the same logic without remounting the component.
  const loadPeekAndAuth = useCallback(async () => {
    if (!token) return;
    setPeek(null);
    setAuthedUserId(undefined);
    try {
      const [peekRes, authRes] = await Promise.all([
        fetch(`/api/invitations/${encodeURIComponent(token)}/peek`, {
          cache: 'no-store',
        }),
        createClient().auth.getUser(),
      ]);
      const peekBody = (await peekRes.json()) as PeekResult;
      setPeek(peekBody);
      setAuthedUserId(authRes.data.user?.id ?? null);
    } catch (err) {
      console.error('[join] peek error:', err);
      setPeek({ ok: false, reason: 'server_error' });
      setAuthedUserId(null);
    }
  }, [token]);

  // Fetch peek + auth state on mount. The peek endpoint is
  // rate-limited per-IP (30/min) so double-mounting in React 19
  // strict mode dev is harmless. We also use the `cancelled` flag
  // to drop setState calls if the component unmounts mid-fetch.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const [peekRes, authRes] = await Promise.all([
          fetch(`/api/invitations/${encodeURIComponent(token)}/peek`, {
            cache: 'no-store',
          }),
          createClient().auth.getUser(),
        ]);
        const peekBody = (await peekRes.json()) as PeekResult;
        if (cancelled) return;
        setPeek(peekBody);
        setAuthedUserId(authRes.data.user?.id ?? null);
      } catch (err) {
        console.error('[join] peek error:', err);
        if (cancelled) return;
        setPeek({ ok: false, reason: 'server_error' });
        setAuthedUserId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleAccept = useCallback(async () => {
    if (!token) return;
    setAccepting(true);
    try {
      const res = await fetch(
        `/api/invitations/${encodeURIComponent(token)}/redeem`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        const code = errorCodeOf(payload);
        // 409 = caller already has data / is in another shared
        // account. Instead of the server's English message we open a
        // localized modal so the user has a clear next-action (sign
        // out → use different email) rather than a 3-second toast.
        if (res.status === 409) {
          setConflictOpen(true);
        } else {
          toast.error(tError(code ?? 'invitation_redeem_failed'));
        }
        setAccepting(false);
        return;
      }
      toast.success(t('welcome'));
      // Full reload (not router.push) so AuthProvider re-fetches
      // the profile with the new account_id and account_role.
      window.location.href = '/dashboard';
    } catch (err) {
      console.error('[join] redeem error:', err);
      toast.error(tError('network_error'));
      setAccepting(false);
    }
  }, [token, t, tError]);

  const handleSignOutAndRetry = useCallback(async () => {
    setSigningOut(true);
    try {
      await createClient().auth.signOut();
      // Hard reload so the new auth state propagates everywhere
      // (middleware, AuthProvider). Preserves the invite token in
      // the URL so the rebuilt page renders the signed-out CTA path.
      window.location.reload();
    } catch (err) {
      console.error('[join] sign-out error:', err);
      toast.error(tError('sign_out_failed'));
      setSigningOut(false);
    }
  }, [tError]);

  // ----- Loading state (peek pending OR auth not yet resolved) -----
  if (peek === null || authedUserId === undefined) {
    return (
      <Card className="w-full max-w-md border-border bg-card">
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t('loading')}</p>
        </CardContent>
      </Card>
    );
  }

  // ----- Peek failed -----
  if (!peek.ok) {
    const copy = {
      not_found: { title: t('failNotFoundTitle'), body: t('failNotFoundBody') },
      used: { title: t('failUsedTitle'), body: t('failUsedBody') },
      expired: { title: t('failExpiredTitle'), body: t('failExpiredBody') },
      server_error: {
        title: t('failServerTitle'),
        body: t('failServerBody'),
      },
    }[peek.reason];
    return (
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10">
            <MailX className="h-6 w-6 text-red-400" />
          </div>
          <CardTitle className="text-xl text-foreground">{copy.title}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {copy.body}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {/* For server_error the failure is transient — the network
              flapped or the peek endpoint hiccupped. Try-again is
              the right primary action; the "create account" /
              "sign in" links stay as secondary options. Other
              failure reasons (not_found / used / expired) are
              terminal for this token, so no retry — just the
              signup/sign-in escape hatches. */}
          {peek.reason === 'server_error' ? (
            <>
              <Button
                onClick={loadPeekAndAuth}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {t('tryAgain')}
              </Button>
              <Link href="/signup">
                <Button
                  variant="outline"
                  className="w-full border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {t('createAccountInstead')}
                </Button>
              </Link>
            </>
          ) : (
            <>
              <Link href="/signup">
                <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
                  {t('createAccountInstead')}
                </Button>
              </Link>
              <Link href="/login">
                <Button
                  variant="outline"
                  className="w-full border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {t('signIn')}
                </Button>
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  // ----- Peek OK -----
  const inviteHeader = (
    <CardHeader className="items-center text-center">
      <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
        <UsersRound className="h-6 w-6 text-primary" />
      </div>
      <CardTitle className="text-xl text-foreground">
        {t.rich('invitedTitle', {
          account: (chunks) => (
            <span className="text-primary">{chunks}</span>
          ),
        })}
      </CardTitle>
      <CardDescription className="text-muted-foreground">
        {t.rich('joinAsRole', {
          role: () => (
            <span className="inline-flex items-center gap-1 text-foreground">
              <ShieldCheck className="size-3.5 text-primary" />
              {tRole(peek.role)}
            </span>
          ),
        })}{' '}
        {t('linkValidUntil', {
          date: new Date(peek.expires_at).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          }),
        })}
      </CardDescription>
    </CardHeader>
  );

  // ----- Authed: show Accept button -----
  if (authedUserId) {
    return (
      <>
        <Card className="w-full max-w-md border-border bg-card">
          {inviteHeader}
          <CardContent className="flex flex-col gap-3">
            <Button
              onClick={handleAccept}
              disabled={accepting}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {accepting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('accepting')}
                </>
              ) : (
                <>
                  <CheckCircle className="size-4" />
                  {t('acceptInvitation')}
                </>
              )}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              {t.rich('acceptNote', {
                account: (chunks) => (
                  <span className="text-muted-foreground">{chunks}</span>
                ),
              })}
            </p>
          </CardContent>
        </Card>

        {/* Conflict modal — opens when the redeem endpoint returns 409
            (caller already in a shared account or has domain data).
            Blocks the flow until the user picks a recovery action so
            they aren't stuck retrying an inevitable failure. */}
        <Dialog
          open={conflictOpen}
          onOpenChange={(open) => {
            if (!open) setConflictOpen(false);
          }}
        >
          <DialogContent className="bg-popover border-border sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-popover-foreground">
                <AlertTriangle className="size-4 text-amber-400" />
                {t.rich('conflictTitle', {
                  account: (chunks) => (
                    <span className="text-popover-foreground">{chunks}</span>
                  ),
                })}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t.rich('conflictDesc', {
                  account: (chunks) => (
                    <span className="text-popover-foreground">{chunks}</span>
                  ),
                })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="bg-popover border-border">
              <Button
                variant="outline"
                onClick={() => setConflictOpen(false)}
                className="border-border text-popover-foreground hover:bg-muted"
              >
                {t('staySignedIn')}
              </Button>
              <Button
                onClick={handleSignOutAndRetry}
                disabled={signingOut}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {signingOut ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('signingOut')}
                  </>
                ) : (
                  t('signOutDifferent')
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // ----- Not authed: prompt to sign up or sign in -----
  return (
    <Card className="w-full max-w-md border-border bg-card">
      {inviteHeader}
      <CardContent className="flex flex-col gap-2">
        <Link href={`/signup?invite=${encodeURIComponent(token!)}`}>
          <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
            {t('createAccountJoin')}
          </Button>
        </Link>
        <Link href={`/login?invite=${encodeURIComponent(token!)}`}>
          <Button
            variant="outline"
            className="w-full border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {t('alreadyHaveAccount')}
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
