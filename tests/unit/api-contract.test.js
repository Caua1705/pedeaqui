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
   * NÃO HÁ MAIS EXCEÇÃO, e isso é o estado desejado.
   *
   * Existia aqui um `ABSENT_FROM_SPEC` com as quatro rotas `/voice/*`: o router
   * de voz era montado condicionalmente no backend, o dump de `openapi.json`
   * saiu com a voz desligada, e por isso o spec não as descrevia embora elas
   * respondessem em produção. Era uma lista curta, nomeada de propósito, para
   * que a exceção precisasse ser editada à mão em vez de silenciada por filtro.
   *
   * A voz saiu do produto em 06/09/2026 e o backend removeu as rotas. A lista
   * ficou VAZIA — e uma lista vazia com um teste que a percorre é um teste que
   * passa sem afirmar nada. Por isso as duas saíram juntas, e não só o conteúdo:
   * hoje TODA rota do front é conferida contra o spec, sem exceção. Se um dia
   * outra capacidade condicional aparecer, o mecanismo está no histórico —
   * ressuscitá-lo é deliberado, que era o ponto dele.
   */

  it('nenhuma rota do front aponta para caminho inexistente no spec', () => {
    const spec = JSON.parse(readFileSync(VENDORED_SPEC, 'utf8'));
    const specPaths = new Set(Object.keys(spec.paths));

    const missing = frontRoutes()
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

  it('nenhuma rota de voz sobrou no front', () => {
    // O backend removeu `/voice/*`. Uma sobra aqui não quebraria nenhum teste
    // acima — ela apareceria como rota ausente do spec, com a mesma cara de
    // "spec desatualizado" que a exceção antiga tinha. Esta afirmação diz o
    // nome do que não pode voltar, como a do `/coupons/available` abaixo.
    const routes = window.PedeAquiApiRoutes;
    for (const nome of ['voiceSession', 'voiceSessionConnected', 'voiceSessionEnded', 'voiceSearch']) {
      expect(routes[nome], `${nome} voltou: a voz saiu do produto em 06/09/2026`).toBeUndefined();
    }
  });

  it('a rota de cupons do cliente é a nova, e a antiga não voltou', () => {
    // Regressão nominal do incidente: barata, e diz o nome do que não pode voltar.
    const routes = window.PedeAquiApiRoutes;
    expect(routes.customerCoupons('junior-da-picanha')).toBe(
      '/restaurants/junior-da-picanha/coupons'
    );
    expect(routes.availableCoupons, '/coupons/available foi removida da API').toBeUndefined();
  });

  // ============================================================================
  //  O SENTIDO INVERSO: rota que a API OFERECE e o front não chama.
  //
  //  Os testes acima conferem um sentido só — "toda rota que o front chama existe
  //  no spec". Ele pega rota MORTA (o `/coupons/available` do incidente). Não
  //  pega o contrário: capacidade que o backend publicou e o front ignora.
  //
  //  E o contrário custou caro. `POST .../orders/track/{token}/cancel` — o
  //  cliente cancelando o próprio pedido, com estorno do pagamento online,
  //  devolução do cupom e do cashback — entrou no contrato e ficou invisível,
  //  enquanto o `docs/order-contract.md` seguia listando "não há rota de cliente
  //  para cancelar o pedido" como a pendência mais cara do repositório. Ela foi
  //  achada em 02/09/2026 por acaso, varrendo outra coisa.
  //
  //  ## POR QUE É AVISO, E NÃO FALHA
  //
  //  A maioria das rotas do spec NÃO é do app do cliente: `/admin/*` é o painel
  //  do lojista, `/payments/webhooks/*` é o gateway falando com o backend,
  //  `/health` é infraestrutura. Um teste que exigisse consumo de todas seria
  //  vermelho permanente — e portão que nasce vermelho é portão que se aprende a
  //  ignorar, que é pior do que não ter.
  //
  //  O que ele faz é IMPRIMIR, em toda execução, as rotas de cliente que o front
  //  não usa. É barato de ler e, se a lista tivesse existido, o cancelamento
  //  teria aparecido nela no dia em que o backend o publicou.
  //
  //  A separação entre "é do cliente" e "não é" está em PREFIXOS_FORA — uma
  //  lista curta que alguém precisa editar de propósito, e não um filtro
  //  esperto que silencia sozinho.
  //
  //  ## O PRIMEIRO FALSO POSITIVO JÁ RENDEU UM CONSERTO
  //
  //  Na estreia, em 02/09/2026, a lista tinha QUATRO linhas e duas eram falso
  //  positivo: `/chat` e `/chat/feedback` apareciam como não usadas, e o app
  //  usava as duas — elas estavam escritas LITERALMENTE dentro do
  //  `restaurant-assistant.js`, fora do ponto único de rotas.
  //
  //  O falso positivo era informação: rota literal não passa pelo teste que
  //  confere as rotas do front contra o spec, então um renome no backend a
  //  quebraria em silêncio — que é o incidente do `/coupons/available`. As duas
  //  foram para `api-routes.js` e sumiram desta lista sozinhas, que é o
  //  comportamento certo. **Não silencie um falso positivo daqui**: ele é o
  //  sintoma de uma rota que escapou.
  //
  //  As outras duas eram reais e continuam na lista: `GET /customers/me/export`
  //  (o pacote da LGPD) e `PUT .../orders/track/{token}/review` (avaliar o
  //  pedido) — capacidades publicadas que o app do cliente não oferece.
  // ============================================================================
  describe('rotas que a API oferece e o front não usa (AVISO, não falha)', () => {
    const PREFIXOS_FORA = [
      '/admin/',          // painel do lojista, outro app
      '/payments/webhooks/', // o gateway falando com o backend, não com o app
      '/health'           // infraestrutura
    ];

    it('lista as rotas de cliente não consumidas', () => {
      const spec = JSON.parse(readFileSync(VENDORED_SPEC, 'utf8'));
      const specPaths = new Set(Object.keys(spec.paths));
      const usadas = new Set(
        frontRoutes()
          .map(({ path }) => toSpecShape(path, specPaths))
          .filter((path) => specPaths.has(path))
      );

      const naoUsadas = [...specPaths]
        .filter((path) => !usadas.has(path))
        .filter((path) => !PREFIXOS_FORA.some((prefixo) => path.startsWith(prefixo)))
        .sort();

      // Sonda contra vacuidade: se `frontRoutes()`/`toSpecShape()` pararem de
      // casar, `usadas` fica vazia, a lista abaixo vira o spec inteiro e o aviso
      // deixa de significar qualquer coisa. Estas duas o front comprovadamente
      // chama.
      expect(usadas.has('/restaurants/{restaurant_slug}/menu'), 'a varredura parou de casar').toBe(true);
      expect(usadas.has('/restaurants/{restaurant_slug}/coupons'), 'a varredura parou de casar').toBe(true);

      if (naoUsadas.length) {
        const metodos = (caminho) => Object.keys(spec.paths[caminho])
          .filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m))
          .map((m) => m.toUpperCase())
          .join('/');
        // process.stdout.write, e nao console.warn: o vitest INTERCEPTA o console
      // e nao imprime a saida de teste que passa. Um aviso que nao aparece e o
      // mesmo que nenhum aviso — foi exatamente assim que a primeira versao
      // deste teste ficou verde sem mostrar as quatro rotas que ela achou.
      process.stdout.write(
          `\n[contrato] ${naoUsadas.length} rota(s) de cliente que a API oferece e o front NÃO usa:\n` +
          naoUsadas.map((caminho) => `  ${metodos(caminho).padEnd(6)} ${caminho}`).join('\n') +
          '\n  (aviso, não falha — mas foi aqui que o cancelamento de pedido ficou meses invisível)\n'
        );
      }

      // Nada a afirmar: o valor deste teste é a lista impressa. A afirmação
      // existe só para que ele não passe por vacuidade se o spec sumir.
      expect(specPaths.size).toBeGreaterThan(20);
    });
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
