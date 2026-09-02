import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
//  Nome que o front lê de um objeto da API tem de EXISTIR no esquema dele.
//
//  Esta é a classe de defeito da §3.2 da skill — a mais silenciosa daqui.
//  `final_total`, `total_after_discount`, `discounted_total`, `payable_amount`
//  e `coupon.eligible` foram procurados por anos e NUNCA existiram em resposta
//  nenhuma: o código lia `undefined`, caía no fallback em 100% das chamadas, e
//  nenhum portão tinha opinião sobre isso.
//
//  Um nome fantasma tem dois preços, e o segundo é o caro:
//
//  1. Enquanto ele não existe, é código morto que MENTE para quem lê — a
//     cadeia sugere um campo que nunca chegou.
//  2. No dia em que o backend publicar aquele nome para OUTRA coisa, a cadeia
//     acorda e passa a vencer o campo do contrato. É o escape 5 herdado:
//     `coupon.short_description || coupon.description` no card do Clube, com o
//     nome do contrato em SEGUNDO lugar.
//
//  ## A armadilha desta varredura, e por que ela é por ARQUIVO
//
//  `name` e `title` são os dois nomes do mesmo campo em DOIS esquemas
//  diferentes, e qual deles é o certo depende de qual tela está lendo:
//
//    | esquema                  | o rótulo do cupom se chama |
//    |--------------------------|----------------------------|
//    | PublicCouponResponse     | `name`   (o feed do /menu) |
//    | CustomerCouponResponse   | `title`  (a lista /coupons)|
//
//  O trilho da Home lê o feed do /menu; o card do Clube lê /coupons. E a folha
//  de detalhe recebe os DOIS (`getCouponForDetail()` procura primeiro na lista
//  do Clube e cai para o feed), então lá `coupon.name || coupon.title` não é
//  defeito nenhum — é normalização deliberada de dois contratos, a mesma
//  figura documentada em `address-service.js:25`.
//
//  Uma regra única do tipo "sempre prefira `title`" quebraria o trilho da Home.
//  Por isso cada alvo declara os SEUS esquemas, e a união deles é o que vale.
//
//  ## Fora desta varredura, de propósito
//
//  `scripts/pages/restaurant-page.js` — é o arquivo do dinheiro, e a rodada de
//  02/09/2026 não o abriu para isto. Os três sítios de cupom dele foram
//  conferidos à mão nessa data e os três já têm o nome do contrato NA FRENTE:
//  `:712` (`coupon.image_url || …`), `:4805` (`selectedCoupon.id ?? …`) e
//  `:4806` (`selectedCoupon.code || …`). Quando ele entrar, entram junto.
// ============================================================================

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '../..');

const SPEC = JSON.parse(readFileSync(resolve(RAIZ, 'scripts/types/openapi.json'), 'utf8'));

function propriedadesDe(nomeDoEsquema) {
  const esquema = SPEC.components?.schemas?.[nomeDoEsquema];
  if (!esquema?.properties) throw new Error(`Esquema ausente no openapi.json: ${nomeDoEsquema}`);
  return Object.keys(esquema.properties);
}

const ALVOS = [
  {
    arquivo: 'scripts/pages/restaurant-club.js',
    variaveis: ['coupon'],
    esquemas: ['CustomerCouponResponse'],
    porque: 'o card do Clube desenha exatamente a lista de GET /restaurants/{slug}/coupons',
    // `missing_amount` saiu daqui em 02/09/2026 para services/coupon-cta.js, e
    // a sonda apontou isso na hora — que e para o que ela existe.
    sonda: ['state', 'discount_amount']
  },
  {
    arquivo: 'scripts/pages/screens/coupon-detail-screen.js',
    variaveis: ['coupon'],
    esquemas: ['CustomerCouponResponse', 'PublicCouponResponse'],
    porque: 'getCouponForDetail() entrega os dois: a lista do Clube e o feed do /menu',
    sonda: ['state', 'min_order_value']
  },
  {
    arquivo: 'scripts/pages/screens/home-screen.js',
    variaveis: ['coupon'],
    esquemas: ['PublicCouponResponse'],
    porque: 'o trilho da Home vem de `menu.coupons`, que é a vitrine pública',
    sonda: ['code', 'discount_type']
  },
  {
    arquivo: 'scripts/pages/screens/home-screen.js',
    // `first` entra porque o primeiro banner do carrossel é lido por uma
    // variável própria (`visualBanners[0]`) — sem ela a varredura via os dois
    // sítios do laço e não via os dois do banner de abertura, que é o único
    // que o cliente vê antes de o carrossel andar.
    variaveis: ['banner', 'highlight', 'first'],
    esquemas: ['BannerResponse'],
    porque: 'banners e destaques são o MESMO esquema (RestaurantMenuResponse declara os dois como BannerResponse[])',
    sonda: ['image_url', 'image_path']
  },
  {
    arquivo: 'scripts/services/menu-service.js',
    variaveis: ['banner'],
    esquemas: ['BannerResponse'],
    porque: 'a normalização dos dois trilhos de banner',
    sonda: ['is_active', 'sort_order']
  },
  {
    arquivo: 'scripts/services/coupon-cta.js',
    variaveis: ['coupon'],
    esquemas: ['CustomerCouponResponse'],
    porque: 'o decisor do botao le o veredito que o backend deu para ESTA sacola',
    sonda: ['state', 'missing_amount']
  },
  {
    arquivo: 'scripts/services/coupon-format.js',
    variaveis: ['source'],
    esquemas: ['CustomerCouponResponse', 'PublicCouponResponse'],
    porque: 'o rótulo é a implementação única, e recebe cupom dos dois contratos',
    sonda: ['title', 'discount_type']
  }
];

/**
 * Tira comentário de linha, comentário de bloco e string entre aspas.
 *
 * O que NÃO sai é a template string: neste repositório o markup é montado com
 * crase, e leituras de verdade (`${esc(highlight.title)}`) moram DENTRO dela —
 * removê-la esconderia justamente os sítios da tela. Comentário é a fonte de
 * falso positivo que importa aqui: o cabeçalho de `coupon-format.js` cita
 * `coupon.code` em prosa, e a §2.1-3 da skill já registra que varredura de
 * identificador super-reporta menção em comentário.
 */
function semComentarioNemAspas(fonte) {
  return fonte
    // O comentário de bloco sai preservando as QUEBRAS: um `.replace(..., ' ')`
    // colapsa o arquivo e a linha relatada passa a apontar para outro lugar —
    // uma mensagem que erra o endereço faz consertar o sítio errado.
    .replace(/\/\*[\s\S]*?\*\//g, (bloco) => bloco.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

function nomesLidos(fonte, variaveis) {
  const codigo = semComentarioNemAspas(fonte);
  const encontrados = new Map();
  for (const variavel of variaveis) {
    const regex = new RegExp(`(?<![\\w.$])${variavel}\\s*\\??\\.\\s*([A-Za-z_$][\\w$]*)`, 'g');
    for (const casamento of codigo.matchAll(regex)) {
      const nome = casamento[1];
      const linha = codigo.slice(0, casamento.index).split('\n').length;
      if (!encontrados.has(nome)) encontrados.set(nome, linha);
    }
  }
  return encontrados;
}

describe('todo campo lido de um objeto da API existe no esquema dele', () => {
  for (const alvo of ALVOS) {
    const rotulo = `${alvo.arquivo} (${alvo.variaveis.join(', ')})`;

    it(`${rotulo}: a varredura ainda casa — sonda contra vacuidade`, () => {
      // A pior forma de passar é por vacuidade. Se a regex parar de casar
      // (mudou o nome da variável, a leitura virou desestruturação), a lista
      // fica vazia e a afirmação abaixo passa sem ter olhado para nada.
      const lidos = nomesLidos(readFileSync(resolve(RAIZ, alvo.arquivo), 'utf8'), alvo.variaveis);
      for (const esperado of alvo.sonda) {
        expect(
          [...lidos.keys()],
          `a varredura de ${rotulo} deixou de enxergar \`${alvo.variaveis[0]}.${esperado}\` — conserte a varredura antes de acreditar no verde`
        ).toContain(esperado);
      }
    });

    it(`${rotulo}: nenhum nome fora de ${alvo.esquemas.join(' + ')}`, () => {
      const permitidos = new Set(alvo.esquemas.flatMap(propriedadesDe));
      const lidos = nomesLidos(readFileSync(resolve(RAIZ, alvo.arquivo), 'utf8'), alvo.variaveis);
      const fantasmas = [...lidos.entries()]
        .filter(([nome]) => !permitidos.has(nome))
        .map(([nome, linha]) => `${alvo.arquivo}:${linha} lê \`${nome}\``);

      expect(
        fantasmas,
        [
          `${rotulo} — ${alvo.porque}.`,
          `Campos do contrato: ${[...permitidos].sort().join(', ')}.`,
          'Um nome fora dessa lista lê `undefined` em 100% das chamadas hoje, e vence',
          'o campo do contrato no dia em que o backend publicar aquele nome.'
        ].join('\n')
      ).toEqual([]);
    });
  }
});
