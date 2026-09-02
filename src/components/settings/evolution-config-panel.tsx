'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Eye, EyeOff, CheckCircle2, XCircle, Loader2, Copy, RotateCcw, AlertTriangle, Info, History } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useApiError } from '@/features/i18n/use-api-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { WhatsAppConfig as WhatsAppConfigType } from '@/types';

const MASKED_SECRET = '••••••••••••••••';

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';

interface EvolutionConfigPanelProps {
  initialConfig: WhatsAppConfigType | null;
  onConfigChange?: (config: WhatsAppConfigType | null) => void;
  /**
   * Live connection state obtained by the parent from
   * GET /api/whatsapp/evolution/config. The stored `status` column can
   * lag behind the real instance state (webhook sync is asynchronous),
   * so the panel adopts this value whenever it is provided. 'unknown'
   * (or absent) means "no live probe yet" and must NOT be rendered as
   * connected.
   */
  liveStatus?: ConnectionStatus;
  liveStatusMessage?: string;
}

export function EvolutionConfigPanel({
  initialConfig,
  onConfigChange,
  liveStatus,
  liveStatusMessage,
}: EvolutionConfigPanelProps) {
  const t = useTranslations('Settings.evolution');
  const tError = useApiError();
  const [config, setConfig] = useState<WhatsAppConfigType | null>(initialConfig);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    initialConfig?.status === 'connected' ? 'connected' : 'disconnected'
  );
  const [statusMessage, setStatusMessage] = useState('');

  const [baseUrl, setBaseUrl] = useState(initialConfig?.evolution_base_url || '');
  const [apiKey, setApiKey] = useState(MASKED_SECRET);
  const [apiKeyEdited, setApiKeyEdited] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [instanceName, setInstanceName] = useState(initialConfig?.evolution_instance_name || '');
  const [webhookSecret, setWebhookSecret] = useState(MASKED_SECRET);
  const [webhookSecretEdited, setWebhookSecretEdited] = useState(false);
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);
  const [createInstance, setCreateInstance] = useState(true);

  const [qrCode, setQrCode] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  // Adopt the parent's live health result when it arrives. The equality
  // guard keeps React from re-rendering when nothing changed, and the
  // 'unknown' skip ensures a missing probe is never displayed as a
  // definitive state. Presentation state only — form inputs are untouched.
  useEffect(() => {
    if (!liveStatus || liveStatus === 'unknown') return;
    setConnectionStatus((prev) => (prev === liveStatus ? prev : liveStatus));
    setStatusMessage(liveStatusMessage ?? '');
  }, [liveStatus, liveStatusMessage]);

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/evolution/webhook`
      : '';

  async function handleSave() {
    if (!baseUrl.trim() || !instanceName.trim()) {
      toast.error(t('validationBaseUrlRequired'));
      return;
    }
    if (!config && (!apiKey.trim() || !apiKeyEdited || apiKey === MASKED_SECRET)) {
      toast.error(t('validationApiKeyRequired'));
      return;
    }
    if (!config && (!webhookSecret.trim() || webhookSecret === MASKED_SECRET)) {
      toast.error(t('validationWebhookSecretRequired'));
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        base_url: baseUrl.trim(),
        instance_name: instanceName.trim(),
        create_instance: createInstance,
      };

      if (apiKeyEdited && apiKey !== MASKED_SECRET && apiKey.trim()) {
        payload.api_key = apiKey.trim();
      } else if (config) {
        toast.error(t('validationApiKeyReenter'));
        setSaving(false);
        return;
      }

      if (webhookSecretEdited && webhookSecret !== MASKED_SECRET && webhookSecret.trim()) {
        payload.webhook_secret = webhookSecret.trim();
      } else if (config && webhookSecret !== MASKED_SECRET && webhookSecret.trim()) {
        payload.webhook_secret = webhookSecret.trim();
      } else if (!config) {
        toast.error(t('validationWebhookSecretRequiredShort'));
        setSaving(false);
        return;
      }

      const res = await fetch('/api/whatsapp/evolution/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        const code = (data && typeof data === 'object' && 'error' in data && data.error && typeof data.error === 'object' && 'code' in data.error && typeof data.error.code === 'string')
          ? data.error.code
          : null;
        const params = (data && typeof data === 'object' && 'error' in data && data.error && typeof data.error === 'object' && 'params' in data.error && data.error.params && typeof data.error.params === 'object')
          ? data.error.params as Record<string, string | number>
          : undefined;
        toast.error(code ? tError(code, params) : t('saveFailed'));
        setSaving(false);
        return;
      }

      if (data.qr?.dataUrl) {
        setQrCode(data.qr.dataUrl);
        toast.success(t('saveSuccessWithQr'));
      } else if (data.connected) {
        toast.success(t('saveSuccessConnected'));
      } else {
        toast.success(t('saveSuccessNotConnected'));
      }

      if (data.history_import_started) {
        setImportMessage(t('importStartedInline'));
        toast.info(t('importStartedToast'));
      }

      setConnectionStatus(data.connected ? 'connected' : 'disconnected');
      setStatusMessage(
        data.connected ? '' : data.error?.code ? tError(data.error.code, data.error.params) : data.message || t('statusNotConnectedFallback')
      );

      // Refresh config state from server.
      const refresh = await fetch('/api/whatsapp/evolution/config', { method: 'GET' });
      const refreshed = await refresh.json();
      if (refresh.ok && refreshed.instance_name) {
        const updated: WhatsAppConfigType = {
          ...(config ?? {}),
          id: config?.id ?? '',
          user_id: config?.user_id ?? '',
          provider: 'evolution',
          evolution_base_url: refreshed.base_url,
          evolution_instance_name: refreshed.instance_name,
          status: refreshed.connected ? 'connected' : 'disconnected',
        } as WhatsAppConfigType;
        setConfig(updated);
        onConfigChange?.(updated);
      }

      setApiKey(MASKED_SECRET);
      setApiKeyEdited(false);
      setWebhookSecret(MASKED_SECRET);
      setWebhookSecretEdited(false);
    } catch (err) {
      console.error('Save error:', err);
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    try {
      const res = await fetch('/api/whatsapp/evolution/config', { method: 'GET' });
      const payload = await res.json();

      if (payload.connected) {
        setConnectionStatus('connected');
        setStatusMessage('');
        toast.success(t('saveSuccessConnected'));
      } else {
        setConnectionStatus('disconnected');
        setStatusMessage(
          payload.error?.code
            ? tError(payload.error.code, payload.error.params)
            : payload.message || t('statusNotConnectedFallback')
        );
        toast.error(
          payload.error?.code
            ? tError(payload.error.code, payload.error.params)
            : payload.message || t('testFailed')
        );
      }
    } catch (err) {
      console.error('Test connection error:', err);
      setConnectionStatus('disconnected');
      toast.error(t('testFailed'));
    } finally {
      setTesting(false);
    }
  }

  async function handleImportHistory() {
    if (!config || connectionStatus !== 'connected') return;
    setImporting(true);
    setImportMessage(null);
    try {
      const res = await fetch('/api/whatsapp/evolution/import', { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        const code = (data && typeof data === 'object' && 'error' in data && data.error && typeof data.error === 'object' && 'code' in data.error && typeof data.error.code === 'string')
          ? data.error.code
          : null;
        toast.error(code ? tError(code) : t('importStartFailed'));
        return;
      }

      setImportMessage(t('importStartedInline'));
      toast.info(t('importStartedToast'));
    } catch (err) {
      console.error('Import history error:', err);
      toast.error(t('importStartFailed'));
    } finally {
      setImporting(false);
    }
  }

  async function handleReset() {
    if (!confirm(t('resetConfirm'))) return;
    setResetting(true);
    try {
      const res = await fetch('/api/whatsapp/evolution/config', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        const code = (data && typeof data === 'object' && 'error' in data && data.error && typeof data.error === 'object' && 'code' in data.error && typeof data.error.code === 'string')
          ? data.error.code
          : null;
        toast.error(code ? tError(code) : t('resetFailed'));
        return;
      }
      toast.success(t('resetSuccess'));
      setConfig(null);
      setBaseUrl('');
      setApiKey('');
      setApiKeyEdited(false);
      setInstanceName('');
      setWebhookSecret('');
      setWebhookSecretEdited(false);
      setCreateInstance(true);
      setConnectionStatus('disconnected');
      setStatusMessage('');
      setQrCode(null);
      onConfigChange?.(null);
    } catch (err) {
      console.error('Reset error:', err);
      toast.error(t('resetFailed'));
    } finally {
      setResetting(false);
    }
  }

  function handleCopyWebhookUrl() {
    navigator.clipboard.writeText(webhookUrl);
    toast.success(t('copyWebhookSuccess'));
  }

  return (
    <div className="space-y-6">
      <Alert className="bg-amber-950/30 border-amber-700/50">
        <AlertTriangle className="size-5 text-amber-400 mt-0.5 shrink-0" />
        <div className="flex-1">
          <AlertTitle className="text-amber-200 mb-1">
            {t('experimentalTitle')}
          </AlertTitle>
          <AlertDescription className="text-amber-100/80 text-sm">
            {t('experimentalDesc')}
          </AlertDescription>
        </div>
      </Alert>

      <Alert className="bg-blue-950/30 border-blue-700/50">
        <Info className="size-5 text-blue-400 mt-0.5 shrink-0" />
        <div className="flex-1">
          <AlertTitle className="text-blue-200 mb-1">
            {t('noticeTitle')}
          </AlertTitle>
          <AlertDescription className="text-blue-100/80 text-sm">
            {t('noticeDesc')}
          </AlertDescription>
        </div>
      </Alert>

      <Alert className="bg-card border-border">
        <div className="flex items-center gap-2">
          {connectionStatus === 'connected' ? (
            <CheckCircle2 className="size-4 text-primary" />
          ) : (
            <XCircle className="size-4 text-red-500" />
          )}
          <AlertTitle className="text-foreground mb-0">
            {connectionStatus === 'connected' ? t('statusConnected') : t('statusNotConnected')}
          </AlertTitle>
        </div>
        <AlertDescription className="text-muted-foreground">
          {connectionStatus === 'connected'
            ? t('statusConnectedDesc')
            : statusMessage || t('statusNotConnectedDesc')}
        </AlertDescription>
      </Alert>

      {qrCode && (
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">{t('qrTitle')}</CardTitle>
            <CardDescription className="text-muted-foreground">
              {t('qrDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrCode} alt={t('qrAlt')} className="mx-auto max-w-[260px]" />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">{t('credentialsTitle')}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('credentialsDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('labelBaseUrl')}</Label>
            <Input
              placeholder={t('placeholderBaseUrl')}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('labelInstanceName')}</Label>
            <Input
              placeholder={t('placeholderInstanceName')}
              value={instanceName}
              onChange={(e) => setInstanceName(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('labelApiKey')}</Label>
            <div className="relative">
              <Input
                type={showApiKey ? 'text' : 'password'}
                placeholder={config ? '••••••••••••••••' : t('placeholderApiKeyNew')}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setApiKeyEdited(true);
                }}
                onFocus={() => {
                  if (apiKey === MASKED_SECRET) {
                    setApiKey('');
                    setApiKeyEdited(true);
                  }
                }}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('labelWebhookSecret')}</Label>
            <div className="relative">
              <Input
                type={showWebhookSecret ? 'text' : 'password'}
                placeholder={config ? '••••••••••••••••' : t('placeholderWebhookSecretNew')}
                value={webhookSecret}
                onChange={(e) => {
                  setWebhookSecret(e.target.value);
                  setWebhookSecretEdited(true);
                }}
                onFocus={() => {
                  if (webhookSecret === MASKED_SECRET) {
                    setWebhookSecret('');
                    setWebhookSecretEdited(true);
                  }
                }}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10"
              />
              <button
                type="button"
                onClick={() => setShowWebhookSecret(!showWebhookSecret)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showWebhookSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t.rich('webhookSecretHint', {
                code: (chunks) => <code className="text-foreground">{chunks}</code>,
              })}
            </p>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Checkbox
              id="create-instance"
              checked={createInstance}
              onCheckedChange={(checked) => setCreateInstance(checked === true)}
            />
            <Label htmlFor="create-instance" className="text-muted-foreground text-sm cursor-pointer">
              {t('createInstanceLabel')}
            </Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">{t('webhookTitle')}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('webhookDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('webhookUrlLabel')}</Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={webhookUrl}
                className="bg-muted border-border text-muted-foreground font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopyWebhookUrl}
                className="shrink-0 border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <Copy className="size-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button onClick={handleSave} disabled={saving} className="bg-primary hover:bg-primary/90 text-primary-foreground">
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {t('saving')}
            </>
          ) : (
            t('saveConfig')
          )}
        </Button>
        <Button
          variant="outline"
          onClick={handleTestConnection}
          disabled={testing || !config}
          className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
        >
          {testing ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {t('testing')}
            </>
          ) : (
            <>
              <CheckCircle2 className="size-4" />
              {t('testConnection')}
            </>
          )}
        </Button>
        {config && connectionStatus === 'connected' && (
          <Button
            variant="outline"
            onClick={handleImportHistory}
            disabled={importing}
            className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            {importing ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t('importing')}
              </>
            ) : (
              <>
                <History className="size-4" />
                {t('importHistory')}
              </>
            )}
          </Button>
        )}
        {config && (
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={resetting}
            className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
          >
            {resetting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t('resetting')}
              </>
            ) : (
              <>
                <RotateCcw className="size-4" />
                {t('resetConfig')}
              </>
            )}
          </Button>
        )}
      </div>

      {importMessage && (
        <div className="rounded-md border border-blue-700/50 bg-blue-950/30 px-4 py-3 text-sm text-blue-100/80">
          {importMessage}
        </div>
      )}
    </div>
  );
}
