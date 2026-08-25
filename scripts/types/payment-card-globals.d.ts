export {};

declare global {
  type MercadoPagoCardToken = {
    id: string;
    payment_method_id?: string;
    issuer_id?: string | number;
  };

  type MercadoPagoField = {
    mount(containerId: string): MercadoPagoField;
    unmount?(): void;
  };

  type MercadoPagoInstance = {
    fields: {
      create(
        type: 'cardNumber' | 'expirationDate' | 'securityCode',
        options?: Record<string, unknown>
      ): MercadoPagoField;
      createCardToken(data: {
        cardholderName: string;
        identificationType: string;
        identificationNumber: string;
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
    }): Promise<void>;
    createCardToken(data: {
      cardholderName: string;
      identificationType: string;
      identificationNumber: string;
    }): Promise<MercadoPagoCardToken>;
    unmountCardFields(): void;
  };

  type PaymentCardFlow = {
    refreshPaymentMethods(): Promise<void>;
    refreshProfilePaymentMethods(): Promise<void>;
    openAddCardTypeScreen(): Promise<void>;
  };
}
