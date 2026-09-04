import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
//  O CAMPO DE CÓDIGO DE CUPOM NÃO MORA NA SACOLA.
//
//  Ele existiu ali entre 02 e 03/09/2026 — um input "Digite o código do cupom"
//  com um botão Aplicar, na tela da sacola —, e SAIU por decisão de produto: o
//  lugar de digitar um código que veio de fora (panfleto, mensagem, embalagem)
//  vai ser outra tela. Enquanto essa tela não existe, o cupom se aplica pelo
//  Clube: card -> folha de detalhe -> confirmar.
//
//  ## Por que uma guarda, e não só o `git rm`
//
//  É a §14.8 da skill, na direção contrária: quando uma decisão é invertida, o
//  teste que protegia a anterior é INVERTIDO, não apagado. O
//  `cart-coupon-code.spec.js` guardava cinco fatos; quatro sobrevivem sem ele
//  e continuam guardados onde já estavam:
//
//   - "200 com valid:false não aplica e não entra no pedido" e "o motivo é
//     frase, não código": `club-coupons.spec.js`, pela folha de detalhe, que é
//     a MESMA porta (armSelectedCoupon -> previewSelectedCoupon ->
//     restoreSelectedCoupon).
//   - "o pedido leva coupon_code quando não há id":
//     `tests/unit/order-payload.test.js`.
//   - "o total é o `total_after_coupon` do backend": `cart-money-chain.spec.js`.
//
//  O quinto — "sem sacola o campo não existe" — deixou de existir junto com o
//  campo, e é o que esta guarda substitui: o campo não volta à sacola por
//  acidente (um merge, um revert, um `git checkout` de arquivo).
//
//  ## Por que unitário, e não E2E
//
//  A pergunta é sobre MARKUP e sobre o registro de ações — dois fatos
//  estáticos, que um E2E responderia em 11 segundos e um leitor de arquivo
//  responde em milissegundos. É a mesma escolha do `white-label-markup.test.js`.
// ============================================================================

const AQUI = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(resolve(AQUI, '../../restaurant.html'), 'utf8');
const PAGE = readFileSync(resolve(AQUI, '../../scripts/pages/restaurant-page.js'), 'utf8');

// SONDAS CONTRA VACUIDADE. Sem elas, um caminho errado (ou uma sacola que
// deixasse de existir) faria as buscas abaixo não acharem nada e o teste
// passaria sem ter olhado para nada.
describe('as sondas', () => {
  it('está lendo o HTML da sacola', () => {
    expect(HTML).toContain('id="cartModal"');
    expect(HTML).toContain('id="csTotal"');
  });

  it('está lendo o arquivo que registra as ações da sacola', () => {
    expect(PAGE).toContain('window.RapidexActions.register(ACTIONS)');
    // As três portas do cupom continuam de pé: elas são do DINHEIRO e a folha
    // de detalhe as usa. O campo saiu; o mecanismo de aplicar cupom, não.
    expect(PAGE).toContain('function armSelectedCoupon');
    expect(PAGE).toContain('function restoreSelectedCoupon');
    expect(PAGE).toContain('function previewSelectedCoupon');
  });
});

describe('a sacola não tem campo de código de cupom', () => {
  // `includes` em vez de `not.toContain`: o segundo despeja o arquivo INTEIRO
  // no diff quando falha, e um arquivo de 7.000 linhas na saída esconde a
  // frase que diz o que quebrou.
  it('nenhum dos quatro nós do campo está no restaurant.html', () => {
    for (const id of ['cartCouponSection', 'cartCouponInput', 'cartCouponApply', 'cartCouponMsg']) {
      expect(HTML.includes(id), `${id} voltou para a sacola (restaurant.html)`).toBe(false);
    }
  });

  it('nenhuma ação de digitar cupom fica registrada', () => {
    // Ação registrada sem markup é caminho armado esperando quem o religue —
    // a mesma lição do `persistCouponChoice` (skill §12.7), que foi REMOVIDA
    // em vez de ficar de pé sem chamador.
    for (const nome of ['applyTypedCoupon', 'setCartCouponMsg']) {
      expect(PAGE.includes(nome), `${nome} voltou ao restaurant-page.js`).toBe(false);
    }
  });
});
