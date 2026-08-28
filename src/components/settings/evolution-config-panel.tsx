'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Eye, EyeOff, CheckCircle2, XCircle, Loader2, Copy, RotateCcw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { WhatsAppConfig as WhatsAppConfigType } from '@/types';

const MASKED_SECRET = '••••••••••••••••';

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';

interface EvolutionConfigPanelProps {
  accountId: string;
  initialConfig: WhatsAppConfigType | null;
  onConfigChange?: (config: WhatsAppConfigType | null) => void;
}

export function EvolutionConfigPanel({
  initialConfig,
  onConfigChange,
}: EvolutionConfigPanelProps) {
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

  const [qrCode, setQrCode] = useState<string | null>(null);

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/evolution/webhook`
      : '';

  async function handleSave() {
    if (!baseUrl.trim() || !instanceName.trim()) {
      toast.error('Base URL and Instance Name are required');
      return;
    }
    if (!config && (!apiKey.trim() || !apiKeyEdited)) {
      toast.error('API Key is required for initial setup');
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        base_url: baseUrl.trim(),
        instance_name: instanceName.trim(),
        create_instance: true,
      };

      if (apiKeyEdited && apiKey !== MASKED_SECRET && apiKey.trim()) {
        payload.api_key = apiKey.trim();
      } else if (config) {
        toast.error('Please re-enter the API Key to save changes');
        setSaving(false);
        return;
      }

      if (webhookSecretEdited && webhookSecret !== MASKED_SECRET && webhookSecret.trim()) {
        payload.webhook_secret = webhookSecret.trim();
      } else if (config && webhookSecret !== MASKED_SECRET) {
        payload.webhook_secret = webhookSecret.trim();
      }

      const res = await fetch('/api/whatsapp/evolution/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Failed to save Evolution configuration');
        setSaving(false);
        return;
      }

      if (data.qr?.dataUrl) {
        setQrCode(data.qr.dataUrl);
        toast.success('Configuration saved. Scan the QR code with WhatsApp.');
      } else if (data.connected) {
        toast.success('Evolution instance connected.');
      } else {
        toast.success('Configuration saved, but instance is not connected yet.');
      }

      setConnectionStatus(data.connected ? 'connected' : 'disconnected');
      setStatusMessage(data.connected ? '' : data.message || 'Instance not connected.');

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
      toast.error('Failed to save Evolution configuration');
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
        toast.success('Evolution instance connected.');
      } else {
        setConnectionStatus('disconnected');
        setStatusMessage(payload.message || 'Connection failed');
        toast.error(payload.message || 'Connection failed');
      }
    } catch (err) {
      console.error('Test connection error:', err);
      setConnectionStatus('disconnected');
      toast.error('Connection test failed.');
    } finally {
      setTesting(false);
    }
  }

  async function handleReset() {
    if (!confirm('This will delete the Evolution configuration. Continue?')) return;
    setResetting(true);
    try {
      const res = await fetch('/api/whatsapp/evolution/config', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to reset configuration');
        return;
      }
      toast.success('Evolution configuration cleared.');
      setConfig(null);
      setBaseUrl('');
      setApiKey('');
      setApiKeyEdited(false);
      setInstanceName('');
      setWebhookSecret('');
      setWebhookSecretEdited(false);
      setConnectionStatus('disconnected');
      setStatusMessage('');
      setQrCode(null);
      onConfigChange?.(null);
    } catch (err) {
      console.error('Reset error:', err);
      toast.error('Failed to reset configuration');
    } finally {
      setResetting(false);
    }
  }

  function handleCopyWebhookUrl() {
    navigator.clipboard.writeText(webhookUrl);
    toast.success('Webhook URL copied to clipboard');
  }

  return (
    <div className="space-y-6">
      <Alert className="bg-amber-950/30 border-amber-700/50">
        <AlertTriangle className="size-5 text-amber-400 mt-0.5 shrink-0" />
        <div className="flex-1">
          <AlertTitle className="text-amber-200 mb-1">
            Experimental provider
          </AlertTitle>
          <AlertDescription className="text-amber-100/80 text-sm">
            Evolution API with Baileys / WhatsApp Web is intended for development and
            testing. It is not equivalent to the official WhatsApp Cloud API and may be
            subject to disconnections or restrictions.
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
            {connectionStatus === 'connected' ? 'Connected' : 'Not connected'}
          </AlertTitle>
        </div>
        <AlertDescription className="text-muted-foreground">
          {connectionStatus === 'connected'
            ? 'Evolution instance is connected.'
            : statusMessage || 'Configure and save to connect.'}
        </AlertDescription>
      </Alert>

      {qrCode && (
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">Pairing QR Code</CardTitle>
            <CardDescription className="text-muted-foreground">
              Open WhatsApp on your phone, go to Linked Devices, and scan this code.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrCode} alt="Evolution pairing QR" className="mx-auto max-w-[260px]" />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Evolution API Credentials</CardTitle>
          <CardDescription className="text-muted-foreground">
            Connect to a self-hosted Evolution API v2.3.7+ instance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-muted-foreground">Base URL</Label>
            <Input
              placeholder="https://evolution.example.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">Instance Name</Label>
            <Input
              placeholder="e.g. wacrm-account-1"
              value={instanceName}
              onChange={(e) => setInstanceName(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">API Key</Label>
            <div className="relative">
              <Input
                type={showApiKey ? 'text' : 'password'}
                placeholder={config ? '••••••••••••••••' : 'Evolution API key'}
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
            <Label className="text-muted-foreground">Webhook Secret</Label>
            <div className="relative">
              <Input
                type={showWebhookSecret ? 'text' : 'password'}
                placeholder={config ? '••••••••••••••••' : 'Secret Evolution sends in webhooks'}
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
              Must match the secret Evolution sends in the <code>apikey</code> header.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Webhook URL</CardTitle>
          <CardDescription className="text-muted-foreground">
            Add this URL to your Evolution instance webhook configuration.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label className="text-muted-foreground">Webhook URL</Label>
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
              Saving…
            </>
          ) : (
            'Save Configuration'
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
              Testing…
            </>
          ) : (
            <>
              <CheckCircle2 className="size-4" />
              Test Connection
            </>
          )}
        </Button>
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
                Resetting…
              </>
            ) : (
              <>
                <RotateCcw className="size-4" />
                Reset
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
