import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ============================================================================
//  O buraco que este arquivo fecha.
//
//  Em 29/08/2026, ao mover 1.132 linhas do restaurant-page.js para o módulo de
//  autenticação, UMA linha ficou no lugar errado:
//
//      onTeardown(stopVfyTimer);      // no corpo do módulo, fora de init()
//
//  Dentro do fechamento antigo ela rodava depois de tudo estar definido. Como
//  módulo, o corpo executa quando o arquivo é IMPORTADO — antes de init() — e
//  `onTeardown` ainda vale undefined. O app inteiro morria no boot.
//
//  `npm run lint`, `npm run typecheck:cards` e os 239 unitários passaram, os
//  três. Não é surpresa nem descuido do CI: NENHUM DOS TRÊS EXECUTA O APP. O
//  lint lê a árvore sintática, o tsc confere tipos de quatro arquivos do
//  cartão, e os unitários importavam funções puras — nunca a ordem de boot.
//
//  O E2E pega (medido: 9 de 10 testes de dois arquivos quebram). Mas ele custa
//  minutos, roda por último, e o sintoma é uma parede de falhas onde nenhuma
//  linha diz "o app não subiu" — diagnosticar exigiu build com sourcemap e
//  arqueologia de nome minificado.
//
//  Estes testes custam milissegundos e dizem a frase certa. O que os torna
//  possíveis é o ambiente `node` do vitest, sem DOM: no import, as injeções
//  ainda são `undefined` — que é exatamente a condição do defeito.
// ============================================================================

const here = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(here, '..', '..');
const ler = (rel) => readFileSync(resolve(raiz, rel), 'utf8');

/** Os módulos que saíram do restaurant-page.js, e o global de cada um. */
const MODULOS = [
  { arquivo: 'restaurant-address-flow', global: 'PedeAquiAddressFlow', chamada: 'addressFlow.init({' },
  { arquivo: 'restaurant-pix-flow', global: 'PedeAquiPixFlow', chamada: 'pixFlow.init({' },
  { arquivo: 'restaurant-auth-flow', global: 'PedeAquiAuthFlow', chamada: 'authFlow.init({' }
];

/**
 * As TELAS do contrato mount(ctx) (skill §9). Mesmas duas primeiras
 * verificações dos módulos (importar não executa; corpo só declara). A
 * terceira é diferente: em vez de lista de injeções + init(), o contrato é
 * publicar `mount` e nada mais — quem confere as chaves do ctx em runtime é o
 * próprio mount(), que recusa shell incompleto, e o boot-smoke.
 */
// `carregar` é uma arrow com o caminho LITERAL: o import dinâmico do vitest
// não resolve variável com subdiretório ("one level deep").
const TELAS = [
  { arquivo: 'screens/profile-screen', global: 'PedeAquiProfileScreen', carregar: () => import('../../scripts/pages/screens/profile-screen.js') },
  { arquivo: 'screens/customer-data-screen', global: 'PedeAquiCustomerDataScreen', carregar: () => import('../../scripts/pages/screens/customer-data-screen.js') },
  { arquivo: 'screens/store-info-screen', global: 'PedeAquiStoreInfoScreen', carregar: () => import('../../scripts/pages/screens/store-info-screen.js') },
  { arquivo: 'screens/coupon-detail-screen', global: 'PedeAquiCouponDetailScreen', carregar: () => import('../../scripts/pages/screens/coupon-detail-screen.js') },
  { arquivo: 'screens/product-screen', global: 'PedeAquiProductScreen', carregar: () => import('../../scripts/pages/screens/product-screen.js') },
  { arquivo: 'screens/home-screen', global: 'PedeAquiHomeScreen', carregar: () => import('../../scripts/pages/screens/home-screen.js') },
  { arquivo: 'screens/account-delete-screen', global: 'PedeAquiAccountDeleteScreen', carregar: () => import('../../scripts/pages/screens/account-delete-screen.js') }
];

describe('importar um módulo de tela não pode executar nada', () => {
  // Este é o teste que teria pegado o defeito. Importar o arquivo roda o corpo
  // do IIFE; se houver ali uma instrução que use uma dependência injetada, ela
  // ainda é `undefined` e a importação estoura — aqui, em milissegundos, com o
  // nome real da função em vez de uma letra minificada.
  for (const { arquivo, global } of MODULOS) {
    it(`${arquivo} importa limpo e publica ${global}.init`, async () => {
      await import(`../../scripts/pages/${arquivo}.js`);
      expect(globalThis.window[global], `${global} não foi publicado`).toBeTruthy();
      expect(globalThis.window[global].init).toBeTypeOf('function');
    });
  }

  for (const { arquivo, global, carregar } of TELAS) {
    it(`${arquivo} importa limpo e publica ${global}.mount — e nada mais`, async () => {
      await carregar();
      expect(globalThis.window[global], `${global} não foi publicado`).toBeTruthy();
      expect(globalThis.window[global].mount).toBeTypeOf('function');
      // O contrato é mount e NADA mais: uma segunda porta é acessor de volta
      // para o estado da tela, e estado de tela não se lê de fora.
      expect(Object.keys(globalThis.window[global])).toEqual(['mount']);
    });
  }
});

describe('nenhuma instrução executável no corpo do módulo', () => {
  // O teste acima pega o caso em que a instrução USA uma injeção. Este pega a
  // classe inteira, inclusive a instrução que hoje não usa nenhuma e amanhã
  // passa a usar — ou que tem efeito colateral (listener, timer, fetch) na hora
  // errada. Efeito de carga vai para init(), sem exceção.
  const executavel = /^(?:[A-Za-z_$][\w$]*\s*[.(]|new\s|await\s|delete\s|if\s*\(|for\s*\(|while\s*\()/;

  for (const { arquivo } of [...MODULOS, ...TELAS]) {
    it(`${arquivo} só declara — não roda`, () => {
      const linhas = ler(`scripts/pages/${arquivo}.js`).split('\n');
      const infratoras = [];
      let profundidade = 0;
      // Uma linha só COMEÇA instrução se a anterior TERMINOU uma. Sem isto, a
      // continuação de uma declaração multilinha (`const f = x =>` com o corpo
      // na linha seguinte) é acusada como instrução solta — foi o primeiro
      // resultado deste teste, um falso positivo no módulo do Pix.
      let anteriorFechou = true;
      for (const [i, linha] of linhas.entries()) {
        const texto = linha.trim();
        const comentario = /^(?:\/\/|\*|\/\*)/.test(texto);
        const declaracao = /^(?:async function|function|const|let|var|window\.)/.test(texto);
        if (profundidade === 1 && texto && !comentario && anteriorFechou
            && !declaracao && executavel.test(texto)) {
          infratoras.push(`${arquivo}.js:${i + 1}  ${texto.slice(0, 70)}`);
        }
        if (texto && !comentario) anteriorFechou = /[;{}]$/.test(texto);
        profundidade += (linha.match(/{/g) || []).length - (linha.match(/}/g) || []).length;
      }
      expect(infratoras, 'instrução no corpo do módulo: mova para init()').toEqual([]);
    });
  }
});

describe('toda injeção declarada é realmente passada no init()', () => {
  // A outra metade do mesmo buraco. Ao extrair o módulo do Pix, `$` (o
  // getElementById do app) faltou na chamada de init(). Declarei `let $` no
  // módulo, O LINT FICOU VERDE — ele só cobra o nome sem declaração, e a
  // declaração passou a existir — e a chamada continuava sem passar o `$`. A
  // tela do Pix quebraria no primeiro clique, com tudo verde.
  //
  // O lint vê a metade de baixo e não vê a de cima. Esta é a de cima.
  const pagina = ler('scripts/pages/restaurant-page.js');

  for (const { arquivo, chamada } of MODULOS) {
    it(`${arquivo}: restaurant-page passa todas`, () => {
      const fonte = ler(`scripts/pages/${arquivo}.js`);
      const declaradas = /^ {2}let ([^;]+);/m.exec(fonte);
      expect(declaradas, `${arquivo}: não achei a lista de injeções`).toBeTruthy();
      const nomes = declaradas[1].split(',').map(n => n.trim()).filter(Boolean);
      expect(nomes.length, 'a lista de injeções não pode estar vazia').toBeGreaterThan(0);

      const inicio = pagina.indexOf(chamada);
      expect(inicio, `não achei "${chamada}" em restaurant-page.js`).toBeGreaterThan(-1);
      // Os comentários saem ANTES da busca. Na primeira versão deste teste eles
      // ficavam, e a sonda mostrou o resultado: tirei o `$` da chamada de
      // verdade e o teste passou, porque o comentário logo acima explicava
      // justamente por que o `$` precisa estar ali — e continha um `$`. Um
      // teste que se satisfaz com a própria documentação não prova nada.
      const argumentos = pagina
        .slice(inicio, pagina.indexOf('\n  });', inicio))
        .replace(/\/\/[^\n]*/g, '');

      // `\b` não serve: ele não casa antes de `$`, que não é caractere de
      // palavra — e foi exatamente assim que o `$` escapou das duas varreduras
      // que montaram estas listas.
      const faltando = nomes.filter(nome => !new RegExp(
        `(?<![\\w.$])${nome.replace(/\$/g, '\\$')}(?![\\w$])`
      ).test(argumentos));
      expect(faltando, `${arquivo} declara mas restaurant-page não passa`).toEqual([]);
    });
  }
});

describe('nenhuma FOTOGRAFIA DO BOOT: o que muda de valor vai por acessor', () => {
  // A quarta metade do mesmo buraco, e a única que não deixa rastro nenhum.
  //
  // Um `let` que o restaurant-page REATRIBUI, passado por valor num init(),
  // chega ao módulo como uma fotografia do instante do boot — e a partir da
  // primeira reatribuição o módulo decide com dado velho. Não estoura, não
  // avisa, não aparece no lint: o nome existe dos dois lados, com o tipo certo,
  // e as três verificações acima deste arquivo passam.
  //
  // O que ela custou, medido em 01/09/2026: `restaurant` e `selectedSavedCard`
  // chegavam ao módulo do Pix por valor, e o init() dele roda ANTES do boot.
  // As duas cópias eram `{}` e `null`, para sempre. Efeito na tela: o cartão do
  // pedido na tela de pagamento dizia "Restaurante - MATRIZ" — o
  // `fallback().restaurantName` da PLATAFORMA — em vez de
  // "Júnior da Picanha - MATRIZ". Num app white-label, na última tela antes de
  // o cliente pagar. E `retryPixPayment()` nunca pedia um token novo do cartão,
  // porque `selectedSavedCard?.id` era sempre falso.
  //
  // O E2E que existia afirmava `not.toBeEmpty()` sobre esse elemento: passava
  // com o nome errado. Este teste custa milissegundos e não depende de alguém
  // ter escrito a asserção forte na tela certa.
  const pagina = ler('scripts/pages/restaurant-page.js');
  const linhas = pagina.split('\n');

  /** Os `let` de topo do IIFE (dois espaços) que são REATRIBUÍDOS depois. */
  const reatribuidos = new Set();
  linhas.forEach((linha, i) => {
    const m = linha.match(/^ {2}let ([A-Za-z_$][\w$]*)/);
    if (!m) return;
    const nome = m[1];
    const re = new RegExp(`(^|[^\\w$.])${nome.replace(/\$/g, '\\$')}\\s*=(?!=|>)`);
    const outra = linhas.some((outraLinha, j) =>
      j !== i && !/^\s*(\/\/|\*)/.test(outraLinha) && re.test(outraLinha.replace(/\/\/.*$/, '')));
    if (outra) reatribuidos.add(nome);
  });

  it('a lista de reatribuídos não pode estar vazia (senão o teste não prova nada)', () => {
    // A sonda. Se a varredura acima parar de casar — o arquivo ganhou outra
    // indentação, o `let` virou `const` — o conjunto fica vazio e as
    // verificações abaixo passam por vacuidade, que é a pior forma de passar.
    expect(reatribuidos.size).toBeGreaterThan(10);
    expect(reatribuidos.has('cart'), 'cart é reatribuído: a varredura tem de vê-lo').toBe(true);
  });

  for (const { arquivo, chamada } of MODULOS) {
    it(`${arquivo}: nenhum nome que muda de valor chega por cópia`, () => {
      const inicio = pagina.indexOf(chamada);
      expect(inicio, `não achei "${chamada}"`).toBeGreaterThan(-1);
      const corpo = pagina.slice(inicio, pagina.indexOf('\n  });', inicio));

      // SÓ taquigrafia. `nome: () => nome` e `{ get: () => nome }` são o jeito
      // CERTO, e contá-los aqui daria falso positivo nos três módulos — foi o
      // primeiro resultado errado da varredura que achou o defeito (acusou 11
      // onde havia 2). Uma linha de taquigrafia neste arquivo é só
      // identificadores e vírgulas.
      const porValor = [];
      for (const bruta of corpo.split('\n')) {
        const limpa = bruta.replace(/\/\/[^\n]*/g, '').trim();
        if (!/^[A-Za-z_$][\w$]*(\s*,\s*[A-Za-z_$][\w$]*)*,?$/.test(limpa)) continue;
        for (const nome of limpa.split(',')) if (nome.trim()) porValor.push(nome.trim());
      }
      expect(porValor.length, 'não achei nome nenhum passado por valor').toBeGreaterThan(0);

      const fotografias = porValor.filter(nome => reatribuidos.has(nome));
      expect(fotografias,
        `${chamada} leva por valor um nome que o restaurant-page reatribui: `
        + 'o módulo ficaria com a fotografia do boot. Passe como getter '
        + '(`nome: () => nome`), como os outros.').toEqual([]);
    });
  }
});
