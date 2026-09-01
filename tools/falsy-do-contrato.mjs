// ============================================================================
//  O FALSY LEGÍTIMO — a régua que faltava na auditoria de contrato.
//
//  POR QUE ISTO EXISTE
//
//  A auditoria de 30/08/2026 dispensou dezenove cadeias de fallback com uma
//  régua que parecia bastar: *"o nome certo vem em primeiro, logo o fallback é
//  inalcançável"*. Ela estava certa dezenove vezes e errada quatro, e as quatro
//  erraram pelo MESMO motivo, que a régua não previa: o fallback não precisa do
//  nome ausente para vencer. Basta o valor ser FALSY.
//
//    sort_order: Number(category.sort_order || index)
//
//  `CategoryResponse.sort_order` é `number | null` com **@default 0**. Zero é a
//  resposta normal de todo item que ninguém reordenou no painel — e `||` não
//  distingue 0 de ausente. O item de MENOR ordem, o que tem de vir primeiro,
//  era justamente o que perdia a própria ordem e herdava a posição de chegada
//  no array. Passou anos invisível porque o backend costuma entregar a lista já
//  ordenada, e o contrato não promete ordem de array em lugar nenhum.
//
//  A pergunta que ficou, e que esta ferramenta responde por medida em vez de
//  por leitura: **onde mais o front lê um campo que o contrato declara como
//  número ou booleano com um fallback que engole 0 / false?**
//
//  COMO USAR
//    node tools/falsy-do-contrato.mjs            # a lista
//    node tools/falsy-do-contrato.mjs --campos   # os campos do contrato
//
//  O QUE ELA **NÃO** FAZ, e é o mais importante
//
//  Ela não julga. Um `Number(x.additional_price || 0)` está na lista e é
//  INOFENSIVO: com 0 o fallback devolve 0, que é o mesmo número. Quem decide é
//  a leitura, e a pergunta da leitura é uma só:
//
//      cair no fallback dá um resultado DIFERENTE de não cair?
//
//  Só isso separa defeito de ruído. A lista é o ponto de partida da conferência,
//  nunca a conclusão dela — do mesmo jeito que `css-usage` não autoriza apagar
//  regra por conta própria.
//
//  AS DUAS CEGUEIRAS CONHECIDAS (nenhuma tem conserto barato aqui)
//
//  1. **Desestruturação.** `const { sort_order } = x` e depois `sort_order ||`
//     não casa: a régua exige o campo colado a um `.`, a `[` ou a uma aspa,
//     senão qualquer variável local de nome parecido entraria na lista. É a
//     mesma sub-reportagem que a varredura de identificadores do corte tem
//     (skill §2.1, armadilha 3), e pelo mesmo motivo.
//  2. **Campo que o contrato não declara.** Se o backend passar a mandar um
//     campo novo e o `api.d.ts` não for regerado, ele não existe para esta
//     régua. `npm run api:generate` antes de confiar na lista.
// ============================================================================
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const spec = JSON.parse(readFileSync('scripts/types/openapi.json', 'utf8'));

/** Os tipos de um esquema, atravessando anyOf/oneOf (o `X | null` do gerador). */
function tiposDe(esquema) {
  if (!esquema || typeof esquema !== 'object') return [];
  if (esquema.type) return [esquema.type];
  if (Array.isArray(esquema.anyOf)) return esquema.anyOf.flatMap(tiposDe);
  if (Array.isArray(esquema.oneOf)) return esquema.oneOf.flatMap(tiposDe);
  return [];
}

// Campo -> onde ele é declarado. A STRING DECIMAL entra junto de propósito:
// "0.00" é truthy, mas ninguém lê dinheiro sem passar por Number(), e
// `Number("0.00") || y` engole o zero exatamente como o número cru engoliria.
const campos = new Map();
for (const [nomeSchema, esquema] of Object.entries(spec.components?.schemas || {})) {
  for (const [campo, prop] of Object.entries(esquema.properties || {})) {
    const tipos = tiposDe(prop);
    const decimal = typeof prop.pattern === 'string' && prop.pattern.includes('\\d');
    if (!tipos.includes('number') && !tipos.includes('integer') && !tipos.includes('boolean') && !decimal) continue;
    if (!campos.has(campo)) campos.set(campo, []);
    campos.get(campo).push(nomeSchema + (prop.default !== undefined ? ` @default ${JSON.stringify(prop.default)}` : ''));
  }
}

if (process.argv.includes('--campos')) {
  for (const [campo, onde] of [...campos].sort()) console.log(`${campo}\n    ${onde.join(' | ')}`);
  console.log(`\n${campos.size} campos numéricos/booleanos no contrato.`);
  process.exit(0);
}

const arquivos = [];
(function anda(dir) {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) anda(caminho);
    else if (nome.endsWith('.js')) arquivos.push(caminho.split('\\').join('/'));
  }
})('scripts');

// AS TRÊS FORMAS QUE O DEFEITO TOMA. `||` é só a mais conhecida — as outras
// duas engolem o mesmo 0 e o mesmo false, e não têm um operador que as denuncie.
//
// Em todas, o nome do campo vem colado a um `.`, `[` ou aspa, para não casar
// com `sort_order_label` nem com uma variável local de nome parecido.
const FAMILIAS = [
  // 1. FALLBACK — `campo || padrão` e o ternário `campo ? a : b`.
  //    A travessia de `)` e `]` é o que faz a régua enxergar
  //    `Number(x.campo) || y`, a forma mais comum daqui: sem ela a lista
  //    perdia os sete sítios do bloco de dinheiro do perfil.
  //    `?` sozinho é ternário; `?.`, `??` e `?:` ficam de fora.
  ['fallback', (c) => new RegExp(`[.\\[' ]${c}['\\]]?[\\s)\\]]*(\\|\\||\\?(?![.?:=]))`)],
  // 2. NEGAÇÃO — `!campo`. "não veio" e "veio zero" viram a mesma coisa, e
  //    aqui não há operador nenhum para desconfiar.
  ['negacao', (c) => new RegExp(`!\\s*[A-Za-z_$][\\w$.?\\[\\]']*[.\\[']${c}\\b`)],
  // 3. GUARDA — `if (campo)` / `&& campo`. Mesma troca, do lado positivo.
  ['guarda', (c) => new RegExp(`(if\\s*\\(|&&\\s+)[A-Za-z_$][\\w$.?\\[\\]']*[.\\[']${c}['\\]]?\\s*[)&|]`)],
  // 4. filter(Boolean) — o mais silencioso dos quatro: numa lista de números
  //    ele APAGA o zero, e a linha não tem nem um `||` para chamar atenção.
  ['filter-boolean', (c) => new RegExp(`filter\\(Boolean\\)|[.\\[' ]${c}\\b`)]
];

const achados = [];
for (const arquivo of arquivos) {
  if (arquivo.includes('/types/')) continue;
  readFileSync(arquivo, 'utf8').split('\n').forEach((linha, i) => {
    if (/^\s*(\*|\/\*|\/\/)/.test(linha)) return;        // comentário puro
    const codigo = linha.replace(/\/\/.*$/, '');          // comentário no fim
    for (const [campo, onde] of campos) {
      for (const [familia, regra] of FAMILIAS) {
        // filter(Boolean) só conta quando as DUAS metades estão na linha.
        if (familia === 'filter-boolean'
          && !(codigo.includes('filter(Boolean)') && new RegExp(`[.\\[' ]${campo}\\b`).test(codigo))) continue;
        if (familia === 'filter-boolean' || regra(campo).test(codigo)) {
          achados.push({ arquivo, linha: i + 1, campo, familia, texto: linha.trim(), onde });
          break;                                          // uma família por sítio
        }
      }
    }
  });
}

for (const a of achados) {
  console.log(`${a.arquivo}:${a.linha}  campo=${a.campo}  [${a.familia}]`);
  console.log(`    ${a.texto.slice(0, 200)}`);
  console.log(`    contrato: ${a.onde.slice(0, 3).join(' | ')}`);
}
const porFamilia = FAMILIAS.map(([f]) => `${f}: ${achados.filter(a => a.familia === f).length}`);
console.log(`\n${campos.size} campos numéricos/booleanos no contrato.`);
console.log(`${achados.length} sítios os leem de um jeito que PODE engolir o falsy (${porFamilia.join(' · ')}).`);
console.log('Nenhum deles é defeito por estar aqui: a pergunta da conferência é');
console.log('se cair no fallback dá um resultado DIFERENTE de não cair.');
