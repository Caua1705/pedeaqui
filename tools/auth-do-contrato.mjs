// ============================================================================
//  O OPENAPI E O CÓDIGO DO BACKEND CONCORDAM SOBRE AUTENTICAÇÃO?
//
//  A pergunta nasceu de um defeito medido em 03/09/2026. `GET .../coupons` e
//  `POST .../coupons/preview` carregam o MESMO `security: [{HTTPBearer}]` no
//  spec — e uma é auth OPCIONAL (funciona sem token, o visitante recebe
//  `login_required`) e a outra é OBRIGATÓRIA (401 sem token). Quem lê só o
//  spec não distingue as duas, e foi assim que oito testes E2E passaram
//  durante meses aplicando cupom sem token, contra um mock que aceitava o que
//  produção recusa.
//
//  "Um mock que só aceita é um teste que só concorda" (skill §4). Esta
//  ferramenta responde POR MEDIDA de onde mais essa confusão pode sair.
//
//  FONTE DA VERDADE: a dependência que a rota de fato usa, no código do
//  backend. O spec é o suspeito, não o juiz.
//
//  ELA NÃO JULGA. Nenhuma das classes abaixo é necessariamente um defeito —
//  a A é o comportamento correto de uma rota de visitante, e a B é a maioria
//  das rotas de painel. O que ela mostra é ONDE o spec sozinho não basta para
//  escrever um mock ou um cliente.
//
//  --- POR QUE O SPEC NÃO CONSEGUE DIZER ---
//
//  O FastAPI emite `security` quando a rota depende de um SCHEME declarado
//  (o HTTPBearer). Ele emite igual para `get_current_customer` (auto_error,
//  401 sem token) e para `get_optional_current_customer` (devolve None e
//  segue). O documento não tem campo para essa diferença.
//
//  Pior: quando a credencial NÃO é um scheme — o par do entregador é um
//  `Header(default=None)` — não sai `security` nenhum, e o cabeçalho sai
//  `required: false`. O spec diz DUAS VEZES que a credencial é opcional numa
//  rota que responde 401 sem ela.
//
//  --- REQUISITOS ---
//
//  Precisa do `../pedeaqui_back` ao lado. Sem ele, sai avisando e não falha —
//  é a mesma condição do `api-contract.test.js`.
//
//      node tools/auth-do-contrato.mjs
//
//  --- A SONDA CONTRA VACUIDADE ---
//
//  Se a varredura de decoradores parar de casar (o backend trocar o idioma
//  das rotas), a lista fica vazia e o silêncio parece boa notícia. Por isso
//  ela EXIGE um piso de rotas lidas e a presença do par conhecido
//  coupons/coupons-preview em lados opostos — se a régua não reproduz o
//  defeito que a criou, ela não vale nada (skill §3.2).
// ============================================================================
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BACK = resolve(RAIZ, '..', 'pedeaqui_back');
const SPEC = resolve(RAIZ, 'scripts', 'types', 'openapi.json');

if (!existsSync(BACK)) {
  console.log('../pedeaqui_back não está ao lado: esta varredura precisa do código do backend.');
  process.exit(0);
}

const spec = JSON.parse(readFileSync(SPEC, 'utf8'));

// As dependências de autenticação do backend, e o que cada uma significa.
// Nome novo aqui é a única manutenção que esta ferramenta pede.
const DEPS = [
  ['get_current_customer', 'cliente OBRIGATORIA'],
  ['get_optional_current_customer', 'cliente OPCIONAL'],
  ['get_admin_scope', 'lojista OBRIGATORIA'],
  ['get_current_admin', 'lojista OBRIGATORIA'],
  ['exigir_papel', 'lojista OBRIGATORIA'],
  ['get_current_courier', 'entregador OBRIGATORIA']
];

// Os endpoints moram em dois lugares: `endpoints/` e alguns soltos em `api/`
// (o /chat é um). Varrer só o primeiro deixa rota de fora — e uma rota de fora
// vira uma linha em "não achei no código", que é ruído com cara de achado.
const DIRETORIOS = [resolve(BACK, 'src/api/endpoints'), resolve(BACK, 'src/api')];

function prefixosDosRouters(texto) {
  const mapa = {};
  const re = /^(\w+)\s*=\s*APIRouter\(([^)]*)\)/gms;
  let m;
  while ((m = re.exec(texto))) {
    const p = /prefix\s*=\s*["']([^"']*)["']/.exec(m[2]);
    mapa[m[1]] = p ? p[1] : '';
  }
  return mapa;
}

const rotasDoCodigo = [];
const vistos = new Set();

for (const dir of DIRETORIOS) {
  if (!existsSync(dir)) continue;
  for (const arquivo of readdirSync(dir).filter(f => f.endsWith('.py') && f !== '__init__.py')) {
    const caminhoDoArquivo = resolve(dir, arquivo);
    if (vistos.has(caminhoDoArquivo)) continue;
    vistos.add(caminhoDoArquivo);

    const texto = readFileSync(caminhoDoArquivo, 'utf8');
    const pref = prefixosDosRouters(texto);
    const linhas = texto.split('\n');

    for (let i = 0; i < linhas.length; i++) {
      const dec = /^@(\w+)\.(get|post|put|patch|delete)\(/.exec(linhas[i]);
      if (!dec) continue;
      const [, router, metodo] = dec;

      // O decorador pode ocupar várias linhas; junta dele até o `def`, e do
      // `def` até o fim da assinatura — é lá que moram os Depends.
      let bloco = '';
      let j = i;
      for (; j < linhas.length && j < i + 40; j++) {
        bloco += linhas[j] + '\n';
        if (/^(async )?def \w+\(/.test(linhas[j])) break;
      }
      let assinatura = '';
      for (let k = j; k < linhas.length && k < j + 40; k++) {
        assinatura += linhas[k] + '\n';
        if (/^\):|^\) ->/.test(linhas[k])) break;
      }

      const caminho = /\.(?:get|post|put|patch|delete)\(\s*["']([^"']*)["']/.exec(bloco);
      if (!caminho) continue;

      const achadas = [...new Set(
        DEPS.filter(([nome]) => (bloco + assinatura).includes(nome)).map(([, cls]) => cls)
      )];

      rotasDoCodigo.push({
        arquivo,
        caminho: (pref[router] ?? '') + caminho[1],
        metodo: metodo.toUpperCase(),
        auth: achadas.length ? achadas.join(' + ') : 'NENHUMA'
      });
    }
  }
}

const doSpec = new Map();
for (const [caminho, ops] of Object.entries(spec.paths)) {
  for (const [metodo, op] of Object.entries(ops)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(metodo)) continue;
    const cabecalhos = (op.parameters || []).filter(p => p.in === 'header');
    doSpec.set(`${metodo.toUpperCase()} ${caminho}`, {
      security: Boolean(op.security),
      // O cabeçalho de credencial que NÃO é scheme: se ele existe e está
      // `required: false`, o spec chama de opcional o que a rota exige.
      credencialOpcional: cabecalhos.filter(p => !p.required).map(p => p.name),
      respostas: Object.keys(op.responses || {})
    });
  }
}

const casadas = [];
const semParNoSpec = [];
for (const r of rotasDoCodigo) {
  const chave = `${r.metodo} ${r.caminho}`;
  const s = doSpec.get(chave);
  // A auth vai junto DE PROPÓSITO. Uma rota que existe em produção e não tem
  // linha nenhuma no contrato é o caso extremo desta varredura: ali o spec não
  // diz a auth errada, ele não diz nada — e quem escreve mock ou cliente a
  // partir dele nem sabe que a rota existe. As de voz são exatamente isso: o
  // router é montado só com `VOICE_ENABLED`, e o dump saiu com ela desligada.
  if (!s) { semParNoSpec.push(`${chave}   [${r.auth}]   (${r.arquivo})`); continue; }
  casadas.push({ ...r, ...s });
  doSpec.delete(chave);
}

const obrigatoria = (a) => /OBRIGATORIA/.test(a);
const opcional = (a) => /OPCIONAL/.test(a);

// --- Sonda contra vacuidade -------------------------------------------------
const par = {
  lista: casadas.find(l => l.caminho.endsWith('/coupons') && l.metodo === 'GET'),
  preview: casadas.find(l => l.caminho.endsWith('/coupons/preview'))
};
const erros = [];
if (rotasDoCodigo.length < 100) erros.push(`só ${rotasDoCodigo.length} rotas lidas do código`);
if (!par.lista || !opcional(par.lista.auth)) erros.push('GET /coupons deixou de ser lida como OPCIONAL');
if (!par.preview || !obrigatoria(par.preview.auth)) erros.push('POST /coupons/preview deixou de ser lida como OBRIGATORIA');
if (erros.length) {
  console.error('SONDA CONTRA VACUIDADE FALHOU — a régua parou de casar:');
  erros.forEach(e => console.error('  - ' + e));
  console.error('\nUma lista vazia daqui não valeria nada. Conserte a varredura antes de acreditar nela.');
  process.exit(1);
}

const bloco = (titulo, explica, itens, extra = () => '') => {
  console.log(`\n### ${titulo}`);
  console.log(`    ${explica}`);
  if (!itens.length) { console.log('    (nenhuma)'); return; }
  itens.forEach(l => console.log(`  ${l.metodo.padEnd(6)} ${l.caminho}${extra(l)}`));
};

console.log('='.repeat(78));
console.log(`rotas lidas do código: ${rotasDoCodigo.length}   |   casadas com o spec: ${casadas.length}`);
console.log('='.repeat(78));

bloco(
  'A — o spec marca `security`, a auth é OPCIONAL',
  'funciona sem token. Um cliente gerado do spec pode exigir login sem precisar.',
  casadas.filter(l => l.security && opcional(l.auth))
);

bloco(
  'C — o spec NÃO marca `security` e a rota EXIGE credencial',
  'a mais cara: o mock deixa passar e produção responde 401.',
  casadas.filter(l => !l.security && obrigatoria(l.auth)),
  (l) => `   [${l.auth}]${l.credencialOpcional.length ? `  cabeçalho "${l.credencialOpcional.join(', ')}" está required:false` : ''}`
);

bloco(
  'D — o spec marca `security` e a rota não pede auth nenhuma',
  'o contrário: o cliente manda credencial que a rota ignora.',
  casadas.filter(l => l.security && l.auth === 'NENHUMA')
);

const B = casadas.filter(l => l.security && obrigatoria(l.auth));
console.log(`\n### B — o spec marca \`security\` e a auth é OBRIGATÓRIA: ${B.length} rotas`);
console.log('    Corretas. Ficam contadas e não listadas porque o ponto é OUTRO:');
console.log('    olhando só o spec elas são INDISTINGUÍVEIS das da classe A.');

console.log('\n### não casaram (ruído da varredura, para conferência humana)');
if (!semParNoSpec.length && !doSpec.size) console.log('    (nenhuma)');
semParNoSpec.forEach(x => console.log(`  código sem spec:  ${x}`));
[...doSpec.keys()].forEach(x => console.log(`  spec sem código:  ${x}`));
