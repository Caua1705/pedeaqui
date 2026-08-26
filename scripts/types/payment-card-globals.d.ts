export {};

declare global {
  type MercadoPagoCardToken = {
    id: string;
    luhn_validation?: boolean;
    payment_method_id?: string;
    issuer_id?: string | number;
  };

  type MercadoPagoField = {
    mount(containerId: string): MercadoPagoField;
    on?(event: 'ready' | 'change' | 'blur' | 'validityChange' | 'error' | 'binChange', callback: (event?: MercadoPagoFieldEvent) => void): MercadoPagoField;
    update?(properties: Record<string, unknown>): MercadoPagoField;
    unmount?(): void;
  };

  type MercadoPagoFieldEvent = {
    field?: string;
    error?: string;
    bin?: string | null;
    errorMessages?: Array<{ message?: string; cause?: string }>;
  };

  type MercadoPagoFieldCallbacks = {
    onReady?(field: string, event?: MercadoPagoFieldEvent): void;
    onChange?(field: string, event?: MercadoPagoFieldEvent): void;
    onBlur?(field: string, event?: MercadoPagoFieldEvent): void;
    onValidityChange?(field: string, event?: MercadoPagoFieldEvent): void;
    onError?(field: string, event?: MercadoPagoFieldEvent): void;
  };

  type MercadoPagoInstance = {
    getPaymentMethods?(data: { bin: string }): Promise<{
      results?: Array<{
        settings?: Array<{
          card_number?: Record<string, unknown>;
          security_code?: Record<string, unknown>;
        }>;
      }>;
    }>;
    fields: {
      create(
        type: 'cardNumber' | 'expirationDate' | 'securityCode',
        options?: Record<string, unknown>
      ): MercadoPagoField;
      createCardToken(data: {
        cardId?: string;
        cardholderName?: string;
        identificationType?: string;
        identificationNumber?: string;
      }): Promise<MercadoPagoCardToken>;
    };
  };

  interface Window {
    APP_CONFIG?: Record<string, unknown>;
    MercadoPago?: new (
      publicKey: string,
      options?: { locale?: string; advancedFraudPrevention?: boolean }
    ) => MercadoPagoInstance;
    PedeAquiApiClient: {
      request(path: string, options?: RequestInit & { timeout?: number }): Promise<unknown>;
    };
    PedeAquiApiRoutes: Record<string, (...args: Array<string | number>) => string>;
    PedeAquiCustomerAuth?: {
      authHeaders?(): Record<string, string>;
      getToken?(): string | null;
    };
    PedeAquiAddressService?: {
      readSelectedAddress?(): Record<string, unknown> | null;
    };
    PedeAquiPaymentConfigService?: PaymentConfigService;
    PedeAquiCustomerCardService?: CustomerCardService;
    PedeAquiMercadoPago?: MercadoPagoService;
    PedeAquiCardFlow?: PaymentCardFlow;
    PedeAquiRestaurantUi?: {
      openModal(id: string): void;
      closeModalId(id: string): void;
      closeModalImmediately(id: string): void;
    };
    RapidexTenant?: { resolveSlug?(): string };
    RapidexActions?: {
      register(actions: Record<string, (...args: any[]) => unknown>): unknown;
      resolve(name: string): ((...args: any[]) => any) | null;
    };
  }

  type PaymentConfigService = {
    CACHE_TTL_MS: number;
    getPaymentConfig(slug: string, options?: { force?: boolean }): Promise<import('./api').components['schemas']['PaymentConfigResponse']>;
    invalidate(slug?: string): void;
    cardIsAvailable(config: import('./api').components['schemas']['PaymentConfigResponse'] | null): boolean;
  };

  type CustomerCardService = {
    listCards(slug: string): Promise<import('./api').components['schemas']['SavedCardResponse'][]>;
    saveCard(slug: string, token: string): Promise<import('./api').components['schemas']['SavedCardResponse']>;
    deleteCard(cardId: string): Promise<unknown>;
  };

  type MercadoPagoService = {
    SDK_URL: string;
    mountCardFields(publicKey: string, containers: {
      cardNumber: string;
      expirationDate: string;
      securityCode: string;
    }, callbacks?: MercadoPagoFieldCallbacks): Promise<void>;
    mountSavedCardSecurityCode(publicKey: string, container: string, callbacks?: MercadoPagoFieldCallbacks): Promise<void>;
    createCardToken(data: {
      cardId?: string;
      cardholderName?: string;
      identificationType?: string;
      identificationNumber?: string;
    }): Promise<MercadoPagoCardToken>;
    unmountCardFields(): void;
  };

  type PaymentCardFlow = {
    refreshPaymentMethods(): Promise<void>;
    refreshProfilePaymentMethods(): Promise<void>;
    openAddCardTypeScreen(): Promise<void>;
    requestSavedCardToken(card: import('./api').components['schemas']['SavedCardResponse']): Promise<string | null>;
  };
}
