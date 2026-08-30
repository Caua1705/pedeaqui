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
      options?: { locale?: string; advancedFraudPrevention?: boolean; trackingDisabled?: boolean }
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
    // Sem `?`: a tela do cartão valida o CPF do titular por aqui, e um módulo
    // ausente tem de quebrar em vez de deixar passar documento inválido.
    PedeAquiValidators: {
      onlyDigits(value: unknown): string;
      isValidPhone(value: unknown): boolean;
      isValidName(value: unknown): boolean;
      isValidCpf(digits: string): boolean;
    };
    PedeAquiPaymentConfigService?: PaymentConfigService;
    PedeAquiCustomerCardService?: CustomerCardService;
    PedeAquiMercadoPago?: MercadoPagoService;
    PedeAquiCardFlow?: PaymentCardFlow;
    // Sem `?`: o rotulo da bandeira e o que o cliente le para saber QUAL cartao
    // ele escolheu, e um modulo ausente tem de quebrar aqui em vez de virar
    // "Crédito -  •••• 1234" na linha de pagamento. Carrega em
    // entry-restaurant.js antes desta tela.
    PedeAquiCardFormat: {
      cardBrandLabel(value: string | null | undefined): string;
    };
    PedeAquiRestaurantUi?: {
      openModal(id: string): void;
      closeModalId(id: string): void;
      closeModalImmediately(id: string): void;
    };
    // A porta única de fechar modal: o closeModalId DECORADO de
    // restaurant-page.js. Opcional porque este arquivo carrega depois dele e a
    // ordem é o que garante a presença — ver closeAppModal() em
    // payment-card-flow.js.
    closeModalId?: (id: string) => void;
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

  /**
   * `ready` resolve quando o iframe do campo terminou de carregar. Ele é
   * separado da montagem de propósito: a tela abre assim que os iframes
   * existem, e só sai de "carregando" quando esta promessa resolve.
   */
  type MercadoPagoMountedFields = { ready: Promise<void> };

  type MercadoPagoService = {
    SDK_URL: string;
    preloadSdk(): Promise<boolean>;
    ensureSdk(): Promise<void>;
    mountCardFields(publicKey: string, containers: {
      cardNumber: string;
      expirationDate: string;
      securityCode: string;
    }, callbacks?: MercadoPagoFieldCallbacks): Promise<MercadoPagoMountedFields>;
    mountSavedCardSecurityCode(publicKey: string, container: string, callbacks?: MercadoPagoFieldCallbacks): Promise<MercadoPagoMountedFields>;
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
