// ============================================================================
//  A COR DOS TRÊS PONTINHOS DO LOADER, e só ela.
//
//  O DEFEITO: `.app-loader-dots span` pintava com `var(--brand-primary)`, e
//  durante o boot INTEIRO essa variável ainda é a paleta padrão de
//  `styles/tokens.css` — que é a cor da PLATAFORMA (#F36F21, laranja). Quem
//  escreve a cor do lojista é `applyTheme()`, e ela só roda quando o `/menu`
//  responde. Ou seja: num tenant azul, a PRIMEIRA coisa que o cliente via era
//  laranja do Rapidex, pulsando, por toda a ida-e-volta de rede.
//
//  Num app white-label isso é exatamente o que não pode existir. A §7 da skill
//  fala de cor chumbada no CSS; esta é a mesma doença por outra porta — a cor
//  não está chumbada, ela é o VALOR PADRÃO de um token que ainda não foi
//  escrito, e o loader é justamente a tela que vive antes da escrita.
//
//  A CORREÇÃO TEM DOIS LADOS, e nenhum dos dois inventa cor:
//
//  1. PRIMEIRA VISITA — não se sabe a cor da loja, e adivinhar é o erro. O
//     token `--app-loader-dot` nasce CINZA NEUTRO em tokens.css. Neutro não é
//     a marca de ninguém; laranja é a marca do Rapidex, e usá-la é anunciar a
//     plataforma na loja do cliente.
//  2. DA SEGUNDA EM DIANTE — a cor daquele slug já foi vista uma vez e está
//     guardada. Este arquivo a lê e escreve NO TOKEN, antes de qualquer rede.
//
//  POR SLUG, como o carrinho. A conta é do Rapidex e atravessa lojas, mas COR
//  não: pintar o loader do Fuji com o azul do Júnior é o defeito do
//  white-label ao contrário. A chave está declarada em `utils/storage-keys.js`
//  junto das outras, que é o lugar onde se procura chave neste repositório.
//
//  ESTE ARQUIVO EXECUTA NO IMPORT, de propósito — é literalmente o trabalho
//  dele. A regra "corpo de módulo não executa nada" (§2.1 e §9 da skill) vale
//  para os módulos de TELA, que dependem de injeção por `init()`/`mount()`;
//  aqui não há injeção nenhuma, e chegar tarde é o mesmo que não chegar: o
//  loader já está pintado desde o HTML. `utils/storage-keys.js` já executa
//  `migrateSessionKeys()` no import pelo mesmo motivo.
//
//  O QUE ELE NÃO FAZ: não aplica tema. `applyBrandTheme()` continua sendo o
//  dono da paleta, e escrever a paleta inteira a partir de um cache seria
//  pintar o app com a cor de ontem — se o lojista trocou de cor, o cliente
//  veria a antiga em superfície de marca até o /menu chegar. Um pontinho de
//  loader é a única superfície em que a cor de ontem é melhor que cor nenhuma.
// ============================================================================
(function () {
  const TOKEN = '--app-loader-dot';
  // Só #rrggbb: é o que `applyBrandTheme()` normaliza e grava. Qualquer outra
  // coisa (rgb(), nome de cor, lixo de outra versão) é descartada em vez de ir
  // para o CSS — um valor inválido no token não pinta nada e o pontinho some.
  const HEX = /^#[0-9a-f]{6}$/i;

  const prefixo = () => window.RapidexStorage?.PREFIXES?.brandTint || 'rapidex.brandTint.';

  function chave(slug) {
    const limpo = String(slug || '').trim().toLowerCase();
    return limpo ? prefixo() + limpo : '';
  }

  /** A cor guardada daquele slug, ou '' — nunca um palpite. */
  function readTint(slug) {
    const nome = chave(slug);
    if (!nome) return '';
    let bruto;
    try { bruto = localStorage.getItem(nome); } catch { return ''; }
    return HEX.test(String(bruto || '')) ? String(bruto) : '';
  }

  /**
   * Guarda a cor da loja para o boot seguinte.
   *
   * Chamada por `applyTheme()` (restaurant-page.js) com a MESMA cor que acabou
   * de ir para a paleta — não com `primary_color` cru. A diferença importa: um
   * hex inválido do backend cai na cor da plataforma dentro do brand-theme, e
   * gravar o cru aqui ressuscitaria o laranja na visita seguinte.
   */
  function rememberTint(slug, primary) {
    const nome = chave(slug);
    const cor = String(primary || '').trim().toUpperCase();
    if (!nome || !HEX.test(cor)) return '';
    try { localStorage.setItem(nome, cor); } catch { /* modo privativo */ }
    return cor;
  }

  /** Escreve a cor guardada no token. Sem cor guardada, não escreve nada — e
   *  o padrão neutro de tokens.css continua valendo. */
  function applyTint(slug) {
    const cor = readTint(slug);
    if (cor) document.documentElement.style.setProperty(TOKEN, cor);
    return cor;
  }

  window.RapidexBootTint = { TOKEN, readTint, rememberTint, applyTint, storageKey: chave };

  applyTint(window.RapidexTenant?.resolveSlug?.() || '');
})();
