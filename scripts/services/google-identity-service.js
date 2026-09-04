// ============================================================================
//  O BOTÃO DO GOOGLE — só o Google. Quem fala com a NOSSA API é o auth-flow.
//
//  Este arquivo faz três coisas e nenhuma delas é decisão de produto: baixa o
//  Google Identity Services, pede o par de nonce ao nosso backend, e entrega o
//  `credential` (o `id_token`) para quem chamou. O que fazer com os três
//  desfechos de `POST /auth/google` é do `restaurant-auth-flow.js`.
//
//  DUAS DECISÕES QUE VALE ESCREVER:
//
//  1. SEM CLIENT ID, O BOTÃO NÃO NASCE. `isEnabled()` responde falso e quem
//     chama não desenha nada. Um "Entrar com Google" que não pode funcionar é
//     pior que nenhum: o cliente toca, nada acontece, e ele conclui que o app
//     está quebrado em vez de usar o caminho que funciona logo ao lado.
//
//  2. O NONCE É PEDIDO A CADA ARMADA, não uma vez por sessão. O par vale 10
//     minutos, e uma folha de login aberta atrás de uma aba passa disso sem
//     esforço; `POST /auth/google` responderia 400 e não há o que consertar do
//     lado do app além de pedir outro par. Rearmar é barato — a rota não
//     autentica, não toca no banco e não diz nada sobre ninguém: é um sorteio e
//     uma assinatura.
//
//  E O QUE ESTE ARQUIVO NÃO FAZ: não guarda o `id_token` em lugar nenhum. Ele
//  atravessa daqui para `POST /auth/google` e acaba ali — o backend confere a
//  assinatura contra as chaves públicas do Google, o `aud`, o `iss` e o nonce,
//  e o descarta.
//
//  ARMADILHA HERDADA DO MERCADO PAGO (§4 da skill): um teste que define
//  `window.google` antes do boot NUNCA exercita o download. `ensureSdk()`
//  começa por `if (window.google?.accounts?.id) return` — de propósito, porque
//  o SDK pode já estar na página —, e é exatamente essa linha que faz o E2E
//  passar sem nunca ter baixado nada. Quem guarda a URL e o carregamento é
//  `tests/unit/google-identity.test.js`; quem guarda a CSP é `csp.spec.js`.
// ============================================================================
(function () {
  const SDK_URL = 'https://accounts.google.com/gsi/client';

  let _sdkPromise = null;

  const clientId = () => String(window.APP_CONFIG?.GOOGLE_CLIENT_ID || '').trim();

  /** Há client id cadastrado neste ambiente? Sem ele, nada é desenhado. */
  function isEnabled() {
    return Boolean(clientId());
  }

  /**
   * Baixa o `gsi/client` uma vez só.
   *
   * A promessa fica guardada: duas telas pedindo o botão ao mesmo tempo (a
   * folha de login e o Perfil) não podem virar duas tags `<script>`. Em caso de
   * falha ela é DESCARTADA, para que a tentativa seguinte volte a baixar —
   * guardar uma promessa rejeitada transformaria uma queda de rede momentânea
   * em "o botão não funciona mais nesta aba".
   */
  function ensureSdk() {
    if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
    if (_sdkPromise) return _sdkPromise;
    _sdkPromise = new Promise((resolve, reject) => {
      const existente = document.querySelector(`script[src="${SDK_URL}"]`);
      const tag = existente || document.createElement('script');
      const pronto = () => {
        if (window.google?.accounts?.id) resolve(window.google.accounts.id);
        else reject(new Error('O Google Identity Services carregou sem a API esperada.'));
      };
      tag.addEventListener('load', pronto, { once: true });
      tag.addEventListener('error', () => {
        // A TAG MORTA SAI DO DOM. Sem isto a tentativa seguinte a REENCONTRA por
        // `querySelector` e pendura os ouvintes nela — e um <script> que já
        // falhou não dispara `load` nunca mais: o botão ficaria carregando para
        // sempre, sem erro. Foi o unitário desta rodada que pegou.
        tag.remove?.();
        reject(new Error('Não foi possível carregar o Google.'));
      }, { once: true });
      if (!existente) {
        tag.src = SDK_URL;
        tag.async = true;
        tag.defer = true;
        document.head.appendChild(tag);
      }
    });
    _sdkPromise = _sdkPromise.catch(erro => {
      _sdkPromise = null;
      throw erro;
    });
    return _sdkPromise;
  }

  /**
   * Arma o botão dentro de `container` e chama `onCredential({id_token,
   * nonce_token})` quando a pessoa entra pelo Google.
   *
   * O `nonce_token` volta junto do `id_token` porque quem chama precisa dos
   * DOIS para `POST /auth/google` — separá-los obrigaria o chamador a guardar
   * metade do par, que é justamente o estado que este arquivo existe para não
   * espalhar.
   *
   * O botão desenhado é o do Google, num iframe, e é assim de propósito: as
   * regras de marca do Google não admitem um botão nosso pintado de "Google", e
   * um iframe é o que a `frame-src` da CSP libera para `accounts.google.com`.
   */
  async function armarBotao(container, { onCredential, onError, width } = {}) {
    if (!container || !isEnabled()) return false;
    try {
      const id = await ensureSdk();
      // O par é pedido AGORA, e não no boot: ele vale 10 minutos.
      const par = await window.PedeAquiCustomerAuth.createGoogleNonce();
      id.initialize({
        client_id: clientId(),
        nonce: par?.nonce || '',
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: resposta => {
          const credencial = resposta?.credential;
          if (!credencial) {
            onError?.(new Error('O Google não devolveu uma credencial.'));
            return;
          }
          onCredential?.({ id_token: credencial, nonce_token: par?.nonce_token || '' });
        }
      });
      container.innerHTML = '';
      id.renderButton(container, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'pill',
        logo_alignment: 'center',
        locale: 'pt-BR',
        width: width || container.clientWidth || undefined
      });
      return true;
    } catch (erro) {
      onError?.(erro);
      return false;
    }
  }

  window.PedeAquiGoogleIdentity = { SDK_URL, isEnabled, ensureSdk, armarBotao };
})();
