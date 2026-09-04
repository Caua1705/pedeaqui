// ============================================================================
//  A ORDEM DE CARGA DA TELA DO ENTREGADOR.
//
//  Irmã de entry-restaurant.js, e propositalmente CURTA: são cinco arquivos
//  contra os vinte e sete de lá. O que esta tela compartilha com o app do
//  cliente é só a base de infraestrutura — configuração, leitura de erro da
//  API, cliente HTTP, as strings de rota e o formatador de dinheiro. Nada de
//  cardápio, sacola, conta, cashback, tema do lojista ou assistente.
//
//  Por que cada um, e nesta ordem:
//
//   1. app-config      publica window.APP_CONFIG (API_BASE_URL). Sem ele o
//                      api-client lança "API_BASE_URL is not configured".
//   2. api-error       o api-client lê `window.PedeAquiApiError?.detailText`
//                      para transformar `detail` (string, array de 422 ou
//                      objeto) em texto. Com `?.`, a ausência dele não quebra
//                      — ela só apaga a mensagem do backend, calada. Carregar
//                      antes é o que faz o 401 ter frase.
//   3. api-client      window.PedeAquiApiClient.
//   4. api-routes      window.API_ROUTES, onde as cinco rotas de /courier são
//                      declaradas. É o ÚNICO arquivo que o guarda de contrato
//                      lê, e por isso elas moram lá e não aqui.
//   5. currency        window.PedeAquiCurrency.formatCurrency, SEM `?.` no
//                      chamador de propósito: se este arquivo sair da ordem, a
//                      tela quebra na primeira renderização em vez de calar e
//                      divergir (ver o cabeçalho de utils/currency.js).
//   6. contact-link    telefone -> tel:/wa.me. UM dono para a regra, que ja
//                      esteve escrita em seis lugares com tres respostas — e
//                      duas delas montavam link para o numero de outra pessoa.
//   7. courier-service a porta das cinco rotas, com o X-Courier-Code.
//   8. courier-page    define e publica; não executa nada no import.
//
//  A folha entra por import para o Vite hasheá-la e injetá-la no HTML — o mesmo
//  caminho das folhas do app do cliente.
// ============================================================================
import '../styles/courier.css';

import './config/app-config.js';
import './utils/api-error.js';
import './services/api-client.js';
import './services/api-routes.js';
import './utils/currency.js';
import './utils/contact-link.js';
import './services/courier-service.js';
import './pages/courier-page.js';

// O ÚNICO ponto que executa. `boot()` fica fora do corpo do módulo da tela de
// propósito (§2.1 da skill): instrução de topo roda no import, antes de a ordem
// de carga terminar, e é assim que se derruba a página com os três portões
// rápidos verdes.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.RapidexCourierPage.boot(), { once: true });
} else {
  window.RapidexCourierPage.boot();
}
