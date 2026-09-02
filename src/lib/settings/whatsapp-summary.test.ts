import { describe, it, expect } from 'vitest';

import { deriveWhatsappSummary } from './whatsapp-summary';

describe('deriveWhatsappSummary', () => {
  it('reports unconfigured when there is no row', () => {
    expect(deriveWhatsappSummary(null, { connected: true })).toEqual({
      configured: false,
      connected: false,
    });
  });

  it('treats a Meta row as configured when phone_number_id is present', () => {
    const summary = deriveWhatsappSummary(
      { provider: 'meta', phone_number_id: '123' },
      { connected: true }
    );
    expect(summary).toEqual({ configured: true, connected: true });
  });

  it('reports a Meta row without phone_number_id as unconfigured', () => {
    expect(
      deriveWhatsappSummary({ provider: 'meta', phone_number_id: null }, null)
    ).toEqual({ configured: false, connected: false });
  });

  it('treats a legacy row (provider NULL) as Meta', () => {
    expect(deriveWhatsappSummary({ phone_number_id: '123' }, null)).toEqual({
      configured: true,
      connected: false,
    });
  });

  it('treats an Evolution row as configured even though phone_number_id is null', () => {
    const summary = deriveWhatsappSummary(
      {
        provider: 'evolution',
        phone_number_id: null,
        evolution_instance_name: 'main',
      },
      { connected: true }
    );
    expect(summary).toEqual({ configured: true, connected: true });
  });

  it('reports a disconnected Evolution instance as configured but not connected', () => {
    const summary = deriveWhatsappSummary(
      {
        provider: 'evolution',
        phone_number_id: null,
        evolution_instance_name: 'main',
        evolution_base_url: 'https://evo.example.com',
      },
      { connected: false }
    );
    expect(summary).toEqual({ configured: true, connected: false });
  });

  it('reports an Evolution row with no instance fields as unconfigured', () => {
    expect(
      deriveWhatsappSummary(
        { provider: 'evolution', phone_number_id: null },
        { connected: true }
      )
    ).toEqual({ configured: false, connected: false });
  });

  it('does not claim connected when the health payload is missing', () => {
    expect(
      deriveWhatsappSummary({ provider: 'meta', phone_number_id: '123' }, null)
    ).toEqual({ configured: true, connected: false });
  });
});
