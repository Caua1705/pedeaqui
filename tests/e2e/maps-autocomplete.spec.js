import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL, esperarAppPronto } from './helpers.js';

// ============================================================================
//  Autocomplete de endereço: o caminho NOVO (AutocompleteSuggestion) é o
//  padrão, e o AutocompleteService legado é fallback AUTOMÁTICO de sessão.
//
//  O SDK aqui é FALSO de propósito: a chave do Maps não libera localhost,
//  então o Google real não é alcançável em dev — o caminho novo contra o
//  serviço de verdade precisa ser conferido EM PREVIEW (ver scratchpad da
//  rodada). O que este spec prova é a MECÂNICA da troca.
//
//  A REGRA QUE ESTES TESTES SUSTENTAM: o caminho novo é a OTIMIZAÇÃO, o
//  legado é a REDE. QUALQUER falha do novo cai para o legado — permissão,
//  cota, timeout, biblioteca, erro desconhecido. Só quando o LEGADO também
//  falha é que o cliente vê mensagem de erro.
//
//  Isto já foi estreito: a regra antiga só caía para o legado se o erro
//  casasse um regex de permissão (403/PERMISSION_DENIED/...). Qualquer outra
//  falha era RELANÇADA e virava mensagem de erro na busca de endereço — no
//  caminho do pedido, onde o legado teria respondido normalmente.
// ============================================================================

// Teto de espera do caminho novo no app (NEW_PLACES_TIMEOUT_MS em
// restaurant-address-flow.js). O teste do timeout precisa esperar mais.
const TETO_NOVO_MS = 3000;

async function comSdkFalso(page, {
  modoNovo = 'ok',
  legadoFalha = false,
  bibliotecaFalha = false
} = {}) {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPickupSession(page);
  await mockApi(page);
  await page.addInitScript(([modo, legFalha, bibFalha]) => {
    window.__mapsCalls = { novo: 0, legado: 0 };
    const AutocompleteSessionToken = class {};
    const AutocompleteSuggestion = {
      async fetchAutocompleteSuggestions() {
        window.__mapsCalls.novo += 1;
        if (modo === 'permissao') throw new Error('PERMISSION_DENIED: The caller does not have permission');
        if (modo === 'cota') throw new Error('OVER_QUERY_LIMIT: quota exceeded for this project');
        if (modo === 'desconhecido') throw new Error('Algo completamente inesperado aconteceu');
        // Pendura para sempre: é assim que um timeout se parece de verdade —
        // o SDK do Google não tem teto próprio.
        if (modo === 'timeout') return new Promise(() => {});
        return {
          suggestions: [{
            placePrediction: {
              placeId: 'novo-1',
              mainText: { text: 'Rua Nova, 123' },
              secondaryText: { text: 'Fortaleza - CE' },
              text: { text: 'Rua Nova, 123 - Fortaleza' }
            }
          }]
        };
      }
    };
    class AutocompleteService {
      getPlacePredictions(req, cb) {
        window.__mapsCalls.legado += 1;
        if (legFalha) { cb(null, 'REQUEST_DENIED'); return; }
        cb([{
          place_id: 'legado-1',
          description: 'Rua Legada, 9',
          structured_formatting: { main_text: 'Rua Legada, 9', secondary_text: 'Fortaleza - CE' }
        }], 'OK');
      }
    }
    window.google = {
      maps: {
        importLibrary: async () => {
          if (bibFalha) throw new Error('importLibrary explodiu');
          return { AutocompleteSuggestion, AutocompleteSessionToken };
        },
        places: { AutocompleteService, AutocompleteSuggestion, PlacesServiceStatus: { OK: 'OK', ZERO_RESULTS: 'ZERO_RESULTS' } },
        LatLngBounds: class { constructor() {} }
      }
    };
  }, [modoNovo, legadoFalha, bibliotecaFalha]);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await page.evaluate(() => window.RapidexActions.resolve('openAddrSearch')());
  await expect(page.locator('#addrSearchModal')).toHaveClass(/active/);
}

async function digitar(page, texto, { timeout = 8000 } = {}) {
  await page.locator('#addrSearchInput').fill(texto);
  await expect(page.locator('.addr-sug-item').first()).toBeVisible({ timeout });
}

test('o caminho novo responde a busca — e o legado nem é chamado', async ({ page }) => {
  await comSdkFalso(page);
  await digitar(page, 'Rua Silva');
  await expect(page.locator('.addr-sug-item').first()).toContainText('Rua Nova, 123');
  const calls = await page.evaluate(() => window.__mapsCalls);
  expect(calls.novo).toBeGreaterThanOrEqual(1);
  expect(calls.legado).toBe(0);
});

test('403 no caminho novo cai para o legado NA MESMA digitação, e a sessão não insiste', async ({ page }) => {
  await comSdkFalso(page, { modoNovo: 'permissao' });
  await digitar(page, 'Rua Silva');
  // A mesma digitação já respondeu pelo legado — sem mensagem de erro no meio.
  await expect(page.locator('.addr-sug-item').first()).toContainText('Rua Legada, 9');
  let calls = await page.evaluate(() => window.__mapsCalls);
  expect(calls.novo).toBe(1);
  expect(calls.legado).toBe(1);

  // A próxima digitação vai DIRETO ao legado: o 403 é da chave, não da frase.
  await page.locator('#addrSearchInput').fill('');
  await digitar(page, 'Avenida Beira');
  calls = await page.evaluate(() => window.__mapsCalls);
  expect(calls.novo).toBe(1);
  expect(calls.legado).toBe(2);
});

// --- os quatro casos que a regra estreita deixava virar erro na tela --------

test('COTA estourada no caminho novo cai para o legado, sem erro na tela', async ({ page }) => {
  await comSdkFalso(page, { modoNovo: 'cota' });
  await digitar(page, 'Rua Silva');
  await expect(page.locator('.addr-sug-item').first()).toContainText('Rua Legada, 9');
  // A mensagem de erro NÃO pode ter aparecido: o legado respondeu.
  await expect(page.locator('.addr-no-results')).toHaveCount(0);
  const calls = await page.evaluate(() => window.__mapsCalls);
  expect(calls.novo).toBe(1);
  expect(calls.legado).toBe(1);
});

test('erro DESCONHECIDO no caminho novo cai para o legado, sem erro na tela', async ({ page }) => {
  await comSdkFalso(page, { modoNovo: 'desconhecido' });
  await digitar(page, 'Rua Silva');
  await expect(page.locator('.addr-sug-item').first()).toContainText('Rua Legada, 9');
  await expect(page.locator('.addr-no-results')).toHaveCount(0);
  const calls = await page.evaluate(() => window.__mapsCalls);
  expect(calls.novo).toBe(1);
  expect(calls.legado).toBe(1);
});

test('caminho novo PENDURADO cai para o legado pelo teto de tempo, e a sessão não insiste', async ({ page }) => {
  await comSdkFalso(page, { modoNovo: 'timeout' });
  const t0 = Date.now();
  await digitar(page, 'Rua Silva', { timeout: TETO_NOVO_MS + 6000 });
  await expect(page.locator('.addr-sug-item').first()).toContainText('Rua Legada, 9');
  await expect(page.locator('.addr-no-results')).toHaveCount(0);
  // Esperou o teto — e não para sempre.
  expect(Date.now() - t0).toBeGreaterThanOrEqual(TETO_NOVO_MS);

  // E a digitação seguinte NÃO paga o teto de novo: a sessão está no legado.
  //
  // A PROVA É O MECANISMO, NÃO O CRONÔMETRO. Aqui havia
  // `expect(Date.now() - t1).toBeLessThan(TETO_NOVO_MS)`, e essa é a direção
  // INSEGURA de uma medição de tempo de parede: máquina ocupada faz o teste
  // falhar sem que exista defeito — o mesmo vício de `tenant-theme:188`, que
  // media parede e caía até em série. Medido pelos dois braços, com a resposta
  // do legado atrasada em 3,5 s (o que a carga faria): o braço antigo falha com
  // `Received: 4033`, o novo passa.
  //
  // E não se perde nada: `calls.novo === 1` abaixo diz a MESMA coisa, e melhor
  // — se o caminho novo não foi chamado de novo, não há teto a pagar. É
  // exatamente como o teste irmão do 403 (`:102`) prova a mesma propriedade,
  // sem cronômetro nenhum.
  await page.locator('#addrSearchInput').fill('');
  await digitar(page, 'Avenida Beira');
  const calls = await page.evaluate(() => window.__mapsCalls);
  expect(calls.novo).toBe(1);
  expect(calls.legado).toBe(2);
});

test('biblioteca que não carrega: o legado é TENTADO, e o erro só aparece porque ele também falha', async ({ page }) => {
  await comSdkFalso(page, { bibliotecaFalha: true });
  await page.locator('#addrSearchInput').fill('Rua Silva');
  // Os dois caminhos dependem da MESMA biblioteca. O legado é tentado assim
  // mesmo (regra uniforme), falha igual, e aí sim o cliente vê a mensagem.
  await expect(page.locator('.addr-no-results')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.addr-sug-item')).toHaveCount(0);
});

test('quando o LEGADO também falha, aí sim o cliente vê erro', async ({ page }) => {
  await comSdkFalso(page, { modoNovo: 'cota', legadoFalha: true });
  await page.locator('#addrSearchInput').fill('Rua Silva');
  await expect(page.locator('.addr-no-results')).toBeVisible({ timeout: 8000 });
  const calls = await page.evaluate(() => window.__mapsCalls);
  // Os DOIS foram tentados antes de desistir.
  expect(calls.novo).toBe(1);
  expect(calls.legado).toBe(1);
});
