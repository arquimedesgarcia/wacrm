import type { WhatsAppProviderKind } from './types'

export type ProviderErrorCode =
  | 'CONFIGURATION_MISSING'
  | 'CONFIGURATION_INVALID'
  | 'PROVIDER_NOT_SUPPORTED'
  | 'CAPABILITY_NOT_SUPPORTED'
  | 'PROVIDER_API_ERROR'
  | 'WEBHOOK_UNAUTHORIZED'
  | 'WEBHOOK_INVALID_PAYLOAD'

export class ProviderError extends Error {
  readonly code: ProviderErrorCode
  readonly provider?: WhatsAppProviderKind | undefined
  readonly status?: number | undefined

  constructor(
    code: ProviderErrorCode,
    message: string,
    options?: {
      provider?: WhatsAppProviderKind
      status?: number
      cause?: unknown
    },
  ) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    this.provider = options?.provider
    this.status = options?.status
    if (options?.cause) {
      this.cause = options.cause
    }
  }
}

export class CapabilityNotSupportedError extends ProviderError {
  constructor(capability: string, provider: WhatsAppProviderKind) {
    super(
      'CAPABILITY_NOT_SUPPORTED',
      `${capability} is not supported by provider ${provider}`,
      { provider },
    )
    this.name = 'CapabilityNotSupportedError'
  }
}
