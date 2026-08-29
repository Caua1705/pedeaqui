import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../scripts/services/api-routes.js';

// ============================================================================
//  O contrato da API, conferido sem rede e sem o backend ao lado.
//
//  O incidente que trouxe este arquivo: em 28/08/2026 o backend trocou
//  `GET /restaurants/{slug}/coupons/available` por `GET .../coupons`. O front
//  continuou chamando a rota antiga, que passou a responder 404, e a tela do
//  Clube ficou em "Não foi possível carregar seus cupons" para todo cliente.
//  Nada quebrou: o lint passou, os 253 unitários passaram, os 243 e2e passaram
//  — porque o mock do e2e devolve 200 para qualquer rota que o app invente
//  (tests/e2e/helpers.js) e porque `api.d.ts` estava congelado num commit
//  anterior à mudança.
//
//  Os três testes abaixo fecham os três buracos, nesta ordem de força:
//
//   1. `api.d.ts` é REALMENTE o que sai do spec versionado (o que foi pedido:
//      regenerar e falhar se divergir).
//   2. Toda rota que o front chama EXISTE no spec — é este que teria pegado o
//      /coupons/available no minuto em que o spec foi atualizado.
//   3. O spec versionado é o do backend — só onde o backend está disponível.
//
//  Os dois primeiros rodam sempre, inclusive num CI que só tem este repo.
// ============================================================================

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VENDORED_SPEC = resolve(ROOT, 'scripts', 'types', 'openapi.json');
const TYPES = resolve(ROOT, 'scripts', 'types', 'api.d.ts');
const BACKEND_SPEC = resolve(ROOT, '..', 'pedeaqui_back', 'openapi.json');

const REGENERATE = 'Rode `npm run api:generate` e commite os dois arquivos.';

describe('api.d.ts é gerado do spec versionado', () => {
  it('regenerar não muda o arquivo commitado', () => {
    const outDir = mkdtempSync(resolve(tmpdir(), 'rapidex-api-'));
    const out = resolve(outDir, 'api.d.ts');
    try {
      // Caminhos relativos e cwd em ROOT: caminho absoluto com acento chega
      // percent-encoded no openapi-typescript (ver tools/sync-api-contract.mjs).
      execFileSync(
        process.execPath,
        ['node_modules/openapi-typescript/bin/cli.js', 'scripts/types/openapi.json', '-o', out],
        { cwd: ROOT, stdio: 'pipe' }
      );
      const commited = readFileSync(TYPES, 'utf8');
      const fresh = readFileSync(out, 'utf8');
      // Comparar o TEXTO inteiro, não um resumo: o que interessa é que ninguém
      // tenha editado api.d.ts à mão para "consertar" um erro de tipo — o
      // conserto de um tipo errado é no backend, nunca aqui.
      expect(
        fresh === commited,
        `scripts/types/api.d.ts não corresponde a scripts/types/openapi.json. ${REGENERATE}`
      ).toBe(true);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('toda rota que o front chama existe na API', () => {
  // As rotas do front são funções que montam a URL. Chamadas com marcadores,
  // elas devolvem o caminho concreto; daí voltamos ao formato do OpenAPI
  // ({restaurant_slug}) para poder comparar. Query string fora: o spec
  // declara path, e parâmetro de busca não é rota.
  const MARKERS = {
    restaurantSlug: '__SLUG__',
    branchId: '__BRANCH__',
    trackingToken: '__TOKEN__',
    orderId: '__ID__',
    addressId: '__ID__',
    cardId: '__ID__',
    categorySlug: '__CATEGORY__',
    productSlug: '__PRODUCT__',
    sessionId: '__SESSION__'
  };

  function frontRoutes() {
    const routes = window.PedeAquiApiRoutes;
    return Object.entries(routes).map(([name, value]) => {
      const raw =
        typeof value === 'function' ? value(MARKERS.restaurantSlug, MARKERS.branchId) : value;
      const path = String(raw).split('?')[0];
      return { name, path };
    });
  }

  // `__SLUG__` etc. voltam a ser {placeholder}; os segmentos que sobrarem sem
  // marcador (ids literais que a função montou) viram {param} pela posição.
  function toSpecShape(path, specPaths) {
    const generic = path
      .replace(/__SLUG__/g, '{restaurant_slug}')
      .replace(/__BRANCH__/g, '{branch_id}')
      .replace(/__TOKEN__/g, '{tracking_token}')
      .replace(/__CATEGORY__/g, '{category_slug}')
      .replace(/__PRODUCT__/g, '{product_slug}')
      .replace(/__SESSION__/g, '{session_id}')
      .replace(/__ID__/g, '{id}');
    if (specPaths.has(generic)) return generic;
    // Os nomes dos parâmetros do spec não são os nossos. Comparar por FORMA:
    // mesmo número de segmentos, e cada segmento ou é igual ou é um {param}
    // dos dois lados.
    const ours = generic.split('/');
    for (const candidate of specPaths) {
      const theirs = candidate.split('/');
      if (theirs.length !== ours.length) continue;
      const matches = ours.every((segment, index) => {
        const other = theirs[index];
        const bothParams = segment.startsWith('{') && other.startsWith('{');
        return bothParams || segment === other;
      });
      if (matches) return candidate;
    }
    return generic;
  }

  /**
   * Rotas que EXISTEM na API mas não aparecem no spec.
   *
   * O router de voz é montado condicionalmente no backend (quando a voz está
   * desligada na plataforma as quatro somem, e é por isso que api-routes.js diz
   * que elas "deixam de existir"). O dump de openapi.json saiu com a voz
   * desligada, então o spec não as descreve — mas em produção elas respondem:
   * `POST /voice/session` devolve 401 (falta token) e `POST /voice/search`
   * devolve 422 (falta corpo), e as duas coisas só acontecem em rota
   * registrada. Verificado em 29/08/2026.
   *
   * Ficam aqui NOMEADAS, e não silenciadas por um filtro genérico: uma lista
   * curta que alguém precisa editar de propósito é a única forma de exceção que
   * não vira desculpa para a próxima rota morta passar batida.
   */
  const ABSENT_FROM_SPEC = new Set([
    'voiceSession',
    'voiceSessionConnected',
    'voiceSessionEnded',
    'voiceSearch'
  ]);

  it('nenhuma rota do front aponta para caminho inexistente no spec', () => {
    const spec = JSON.parse(readFileSync(VENDORED_SPEC, 'utf8'));
    const specPaths = new Set(Object.keys(spec.paths));

    const missing = frontRoutes()
      .filter(({ name }) => !ABSENT_FROM_SPEC.has(name))
      .filter(({ path }) => !specPaths.has(toSpecShape(path, specPaths)))
      .map(({ name, path }) => `${name} -> ${path}`);

    // Foi ESTA lista que ficou com `availableCoupons -> /restaurants/__SLUG__/
    // coupons/available` durante o incidente.
    expect(
      missing,
      `Rotas em scripts/services/api-routes.js que a API não tem:\n  ${missing.join('\n  ')}\n\n` +
        `Se a API mudou, ${REGENERATE} Se o front está errado, corrija a rota.`
    ).toEqual([]);
  });

  it('a lista de exceções não apodrece: nenhuma delas entrou no spec', () => {
    // O dia em que o backend documentar a voz, esta lista precisa encolher —
    // senão ela vira um buraco permanente com cara de decisão.
    const spec = JSON.parse(readFileSync(VENDORED_SPEC, 'utf8'));
    const specPaths = new Set(Object.keys(spec.paths));

    const nowDocumented = frontRoutes()
      .filter(({ name }) => ABSENT_FROM_SPEC.has(name))
      .filter(({ path }) => specPaths.has(toSpecShape(path, specPaths)))
      .map(({ name }) => name);

    expect(
      nowDocumented,
      `Estas rotas já estão no spec e devem sair de ABSENT_FROM_SPEC: ${nowDocumented.join(', ')}`
    ).toEqual([]);
  });

  it('a rota de cupons do cliente é a nova, e a antiga não voltou', () => {
    // Regressão nominal do incidente: barata, e diz o nome do que não pode voltar.
    const routes = window.PedeAquiApiRoutes;
    expect(routes.customerCoupons('junior-da-picanha')).toBe(
      '/restaurants/junior-da-picanha/coupons'
    );
    expect(routes.availableCoupons, '/coupons/available foi removida da API').toBeUndefined();
  });
});

describe('o spec versionado é o do backend', () => {
  const hasBackend = existsSync(BACKEND_SPEC);

  it.skipIf(!hasBackend)('scripts/types/openapi.json está igual ao ../pedeaqui_back', () => {
    // Só roda em máquina com o backend ao lado — no CI deste repo o arquivo não
    // existe. Os dois testes acima é que carregam a garantia no CI; este é o
    // que avisa o desenvolvedor, ANTES do push, que o contrato andou.
    expect(
      readFileSync(VENDORED_SPEC, 'utf8') === readFileSync(BACKEND_SPEC, 'utf8'),
      `O backend mudou o contrato desde a última sincronização. ${REGENERATE}`
    ).toBe(true);
  });
});
