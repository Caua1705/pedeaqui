// ============================================================================
//  Quantos FIOS um bloco teria se saisse do restaurant-page.js.
//
//  POR QUE ISTO EXISTE
//
//  "Quebrar o arquivo de 7.185 linhas" e uma frase que soa sempre boa e quase
//  nunca e. Tres cortes deram certo (endereco, Pix, auth: ~1.100 linhas cada,
//  ~40 injecoes) e quatro foram recusados — e a diferenca entre os dois grupos
//  nao e o tamanho do bloco, e a DENSIDADE DE FIOS: quantos nomes ele le de
//  fora e quantos nomes dele sao chamados de fora. Um bloco com fio demais,
//  extraido, e o mesmo fechamento com mais cerimonia — e cerimonia e onde mora
//  a armadilha do acessor congelado no boot (ver a skill, secao 2.1).
//
//  Este script poe numero nessa conversa, para que a proxima pessoa nao precise
//  refazer a leitura inteira do arquivo para descobrir o que ja foi medido.
//
//  A REFERENCIA, MEDIDA
//
//    corte que DEU certo (endereco/Pix/auth)  ~1.100 linhas / ~40 fios  ~27 l/fio
//    operacao/filial, RECUSADO                  316 linhas / 87 fios     3,6 l/fio
//    folha do cupom, RECUSADA                   261 linhas / 29 fios     9,0 l/fio
//
//  Um candidato abaixo de ~10 linhas por fio nao paga. Em 30/08/2026 os sete
//  blocos restantes foram medidos e o melhor deles ficou em 8,9.
//
//  USO
//    node tools/fios-do-corte.mjs
//
//  O QUE ELE NAO FAZ
//
//  A varredura de identificador erra dos dois lados (skill, secao 2.1,
//  armadilha 3): sub-reporta o que chega por desestruturacao e super-reporta
//  nome de parametro, chave de objeto e string. Serve para COMPARAR candidatos
//  entre si com a mesma regua — a aferição contra o bloco ja recusado esta
//  impressa junto de proposito, para que o numero de hoje tenha com que ser
//  comparado. Nao serve como lista de dependencias de um init().
// ============================================================================
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARQ = join(ROOT, 'scripts', 'pages', 'restaurant-page.js');
const L = readFileSync(ARQ, 'utf8').split(/\r?\n/);

// Funcoes de topo do IIFE (indentacao 2), com o intervalo de linhas. O fim e a
// primeira linha que e exatamente `  }` — vale porque este arquivo e formatado
// com dois espacos e nenhuma funcao de topo termina de outro jeito.
const fns = [];
for (let i = 0; i < L.length; i++) {
  const m = L[i].match(/^ {2}(?:async )?function ([A-Za-z0-9_$]+)/);
  if (!m) continue;
  let j = i;
  while (j < L.length && L[j] !== '  }') j++;
  fns.push({ nome: m[1], ini: i, fim: j });
}

// Tudo que o IIFE declara no topo: so estes contam como fio de entrada. Um
// nome global (window, document, Math) nao e fio — ele atravessa o corte
// sozinho.
const declarados = new Set(fns.map(f => f.nome));
for (const linha of L) {
  const simples = linha.match(/^ {2}(?:const|let|var) ([A-Za-z0-9_$]+)/);
  if (simples) declarados.add(simples[1]);
  const desestruturado = linha.match(/^ {2}(?:const|let|var) \{([^}]+)\}/);
  if (desestruturado) for (const parte of desestruturado[1].split(',')) {
    const nome = parte.split(':').pop().trim().split('=')[0].trim();
    if (nome) declarados.add(nome);
  }
}

const semComentario = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
const identificadores = (s) => new Set(semComentario(s).match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []);

function medir(rotulo, re) {
  const bloco = fns.filter(f => re.test(f.nome));
  if (!bloco.length) return null;
  const dentro = new Set(bloco.map(f => f.nome));
  const linhasBloco = new Set();
  for (const f of bloco) for (let i = f.ini; i <= f.fim; i++) linhasBloco.add(i);

  const textoDentro = [...linhasBloco].sort((a, b) => a - b).map(i => L[i]).join('\n');
  const textoFora = L.filter((_, i) => !linhasBloco.has(i)).join('\n');

  const entrada = [...identificadores(textoDentro)].filter(n => declarados.has(n) && !dentro.has(n));
  const foraIds = identificadores(textoFora);
  const saida = [...dentro].filter(n => foraIds.has(n));
  const fios = entrada.length + saida.length;

  return {
    rotulo,
    funcoes: bloco.length,
    linhas: linhasBloco.size,
    entrada: entrada.sort(),
    saida: saida.sort(),
    fios,
    densidade: linhasBloco.size / fios
  };
}

const CANDIDATOS = [
  ['AFERICAO — operacao/filial (JA RECUSADO)', /^(loadOperationContext|initOperationContext|applyOperationToLegacy|setOperationEntryLoading|openOperationScreen|closeOperationScreen|renderOperationScreen|setOperationType|renderOperationBranches|selectBranch|confirmOperation|requestBranchAvailability|setSelectedOperationAddress|opBranch|handleMenuBranchChange|ensureMenuMatchesSelectedBranch|unavailableBranchReason)/],
  ['Perfil: historico de pedidos', /^(renderProf|loadProf|openProf|closeProf|profOrder)/],
  ['Dados do cliente / senha', /^(setCustomerData|setCustomerPassword|openCustomerData|closeCustomerData|handleCustomerData|submitCustomerData|openCustomerPassword|closeCustomerPassword|handleCustomerPassword|submitCustomerPassword|confirmCustomerPassword|resetCustomerData|resetCustomerPassword|hideCustomerPassword|showCustomerPassword)/],
  ['Informacoes da loja (modal + info*)', /^(renderRestaurantInfo|ensureRestaurantInfo|openRestaurantInfo|handleRestaurantInfoContextChange|setStoreInfoTab|info[A-Z]|storeInfo)/],
  ['Cupom: folha de detalhe + helpers', /^(coupon[A-Z]|showCouponNotice|openCouponDetail|closeCouponDetail|confirmCouponDetail|useCoupon|renderCoupons|refreshAvailableCoupons)/],
  ['Cashback', /^(initCashbackState|loadCashbackForHome|renderCashbackStatement|closeCashbackStatement|openCashbackStatement|retryCashbackStatement)/],
  ['Produto: modal e opcoes', /^(openProduct|renderProduct|initProduct|syncProduct|changeQty|toggleProductOption|addToCart|editCartItem)/],
  ['Confirmar pedido (folha) + submissao', /^(syncOrderConfirmSheet|openOrderConfirm|closeOrderConfirm|setOrderConfirmLoading|confirmOrderFromSheet|orderConfirm|openConfirmBenefits)/]
];

const detalhado = process.argv.includes('--detalhe');
const medidos = CANDIDATOS.map(([rotulo, re]) => medir(rotulo, re)).filter(Boolean);

console.log('restaurant-page.js: ' + L.length + ' linhas, ' + fns.length + ' funcoes de topo\n');
console.log('bloco'.padEnd(42) + 'linhas'.padStart(8) + 'fios'.padStart(7) + 'l/fio'.padStart(8));
for (const m of medidos.sort((a, b) => b.densidade - a.densidade)) {
  console.log(m.rotulo.padEnd(42) + String(m.linhas).padStart(8) + String(m.fios).padStart(7) +
    m.densidade.toFixed(1).padStart(8));
}
console.log('\nreferencia: os tres cortes que deram certo ficaram perto de 27 linhas por fio.');
console.log('abaixo de ~10 o corte e o mesmo fechamento com mais cerimonia.');

if (detalhado) {
  for (const m of medidos) {
    console.log('\n=== ' + m.rotulo + ' ===');
    console.log('  entrada (' + m.entrada.length + '): ' + m.entrada.join(' '));
    console.log('  saida   (' + m.saida.length + '): ' + m.saida.join(' '));
  }
}
