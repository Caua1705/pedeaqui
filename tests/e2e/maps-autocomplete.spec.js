import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL } from './helpers.js';

// ============================================================================
//  Autocomplete de endereço: o caminho NOVO (AutocompleteSuggestion) é o
//  padrão, e o AutocompleteService legado é fallback AUTOMÁTICO de sessão.
//
//  O SDK aqui é FALSO de propósito: a chave do Maps não libera localhost,
//  então o Google real não é alcançável em dev — o caminho novo contra o
//  serviço de verdade precisa ser conferido EM PREVIEW (ver scratchpad da
//  rodada). O que este spec prova é a MECÂNICA da troca: novo por padrão,
//  403 de permissão cai para o legado na mesma digitação, e a sessão não
//  insiste no caminho que já falhou.
// ============================================================================

async function comSdkFalso(page, { novoFalha = false } = {}) {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPickupSession(page);
  await mockApi(page);
  await page.addInitScript(([falha]) => {
    window.__mapsCalls = { novo: 0, legado: 0 };
    const AutocompleteSessionToken = class {};
    const AutocompleteSuggestion = {
      async fetchAutocompleteSuggestions() {
        window.__mapsCalls.novo += 1;
        if (falha) throw new Error('PERMISSION_DENIED: The caller does not have permission');
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
        cb([{
          place_id: 'legado-1',
          description: 'Rua Legada, 9',
          structured_formatting: { main_text: 'Rua Legada, 9', secondary_text: 'Fortaleza - CE' }
        }], 'OK');
      }
    }
    window.google = {
      maps: {
        importLibrary: async () => ({ AutocompleteSuggestion, AutocompleteSessionToken }),
        places: { AutocompleteService, AutocompleteSuggestion, PlacesServiceStatus: { OK: 'OK', ZERO_RESULTS: 'ZERO_RESULTS' } },
        LatLngBounds: class { constructor() {} }
      }
    };
  }, [novoFalha]);
  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await page.evaluate(() => window.RapidexActions.resolve('openAddrSearch')());
  await expect(page.locator('#addrSearchModal')).toHaveClass(/active/);
}

async function digitar(page, texto) {
  await page.locator('#addrSearchInput').fill(texto);
  await expect(page.locator('.addr-sug-item').first()).toBeVisible({ timeout: 5000 });
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
  await comSdkFalso(page, { novoFalha: true });
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
