import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
//  Num app WHITE-LABEL, o que varia por loja não se escreve no HTML.
//
//  A regra é a mesma que a §7 da skill já aplica às cores: um valor de um
//  tenant chumbado no arquivo compartilhado faz toda loja nova nascer parecendo
//  a loja do piloto. Ali eram ~250 cores; aqui é a lista de formas de pagamento.
//
//  O caso que criou este arquivo: `#profSubpagamento` (a subtela "Pagamento" do
//  Perfil) trazia SEIS chips escritos à mão — Pix, cartão de crédito, cartão de
//  débito, vale-refeição, vale-alimentação e dinheiro — mais um cartão de texto
//  afirmando "O pagamento é realizado diretamente no estabelecimento".
//
//  Quem responde por essa lista é o `/info` DAQUELA FILIAL, e `tests/fixtures/
//  info.json` — cópia fiel da produção — traz PIX no grupo online e só
//  crédito/débito no de entrega. Nada de vale, nada de dinheiro. E "pago no
//  estabelecimento" é falso para quem paga PIX online.
//
//  ## Por que um teste de MARKUP, e não um E2E
//
//  A hipótese inicial era um flash: o app sobe, o /info está em voo, a pessoa
//  abre Perfil -> Pagamento e lê a lista errada. **Medido em 02/09/2026, esse
//  flash NÃO existe**: `openProfSub('pagamento')` (screens/profile-screen.js:440)
//  troca o corpo por "Carregando formas de pagamento..." sempre que
//  `restaurantInfoState.status !== 'success'`. Pelo caminho do app, os chips
//  nunca chegam à tela.
//
//  O que sobra é real e não é pequeno: eles ESTÃO no DOM de toda loja (sonda:
//  `document.querySelectorAll('.prof-pay-chip').length === 6` logo depois do
//  boot), alcançáveis por leitor de tela e por busca na página, e servem de
//  esqueleto para quem for mexer nessa tela. Um teste que fingisse ver o flash
//  passaria pelo motivo errado — que é a §3.3 da skill.
//
//  FORA desta guarda, de propósito: `#paymentMethodModal` (restaurant.html:1341)
//  tem um botão de PIX escrito à mão. É a tela de CHECKOUT, fora da rodada de
//  02/09/2026, e o caso é diferente — o app mostra ou esconde aquele botão
//  conforme `/payment-config` e `/info`, em vez de ignorá-lo. Fica anotado.
// ============================================================================

const AQUI = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(resolve(AQUI, '../../restaurant.html'), 'utf8');

/** O conteúdo de um elemento pelo id, contando as tags aninhadas. */
function corpoDe(html, marcadorDeAbertura) {
  const inicio = html.indexOf(marcadorDeAbertura);
  if (inicio < 0) throw new Error(`não achei ${marcadorDeAbertura} em restaurant.html`);
  let profundidade = 0;
  let i = inicio;
  const abre = /<div\b/g;
  const fecha = /<\/div>/g;
  // Varredura simples: conta <div> e </div> a partir da abertura.
  while (i < html.length) {
    abre.lastIndex = i;
    fecha.lastIndex = i;
    const a = abre.exec(html);
    const f = fecha.exec(html);
    if (!f) break;
    if (a && a.index < f.index) { profundidade += 1; i = a.index + 4; continue; }
    profundidade -= 1;
    i = f.index + 6;
    if (profundidade === 0) return html.slice(inicio, i);
  }
  throw new Error(`não fechei ${marcadorDeAbertura}`);
}

describe('markup white-label: o que varia por loja não mora no HTML', () => {
  const subtela = corpoDe(HTML, '<div class="prof-sub" id="profSubpagamento">');

  it('a sonda pegou a subtela certa — sem isto o teste passaria por vacuidade', () => {
    // Se o recorte falhar (mudou a classe, mudou a ordem dos atributos), a
    // string fica pequena e as afirmações abaixo passam sem ter olhado nada.
    expect(subtela).toContain('prof-sub-title');
    expect(subtela).toContain('Pagamento');
    expect(subtela.length).toBeGreaterThan(200);
  });

  it('#profSubpagamento não escreve nenhum chip de forma de pagamento', () => {
    expect(
      subtela.match(/prof-pay-chip/g) || [],
      'a lista de formas de pagamento é do /info da filial, não do HTML compartilhado'
    ).toEqual([]);
  });

  it('#profSubpagamento não afirma onde o pagamento acontece', () => {
    // "O pagamento é realizado diretamente no estabelecimento" é falso para
    // toda loja que aceita PIX online — inclusive a deste repositório.
    expect(subtela).not.toContain('diretamente no estabelecimento');
  });

  it('#profSubpagamento não nomeia forma de pagamento nenhuma', () => {
    const nomes = ['Vale-refeição', 'Vale-alimentação', 'Dinheiro', 'Cartão de crédito', 'Cartão de débito'];
    expect(nomes.filter((nome) => subtela.includes(nome))).toEqual([]);
  });
});
