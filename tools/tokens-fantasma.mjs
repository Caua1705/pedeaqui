// ============================================================================
//  TOKEN FANTASMA — `var(--nome)` que ninguém define, em lugar nenhum.
//
//  É a §12.1 (nome fantasma) dentro do CSS, e ela erra de um jeito que NENHUM
//  portão deste repositório vê:
//
//    * o lint lê JavaScript, não folha de estilo;
//    * `css-usage.mjs` pergunta se a REGRA pode pintar alguém, não se o VALOR
//      dela existe;
//    * `css-important.mjs` pergunta quem vence a disputa, não quem é o valor;
//    * `capture-screens.mjs` compara ANTES com DEPOIS — e um token fantasma é
//      estável: ele estava errado antes e continua errado depois, então a
//      captura responde "Nenhuma diferença" com toda a razão.
//
//  E o CSS não reclama por desenho: `var(--nao-existe, #c0392b)` cai no
//  fallback em silêncio, e `var(--nao-existe)` sem fallback deixa a
//  propriedade no valor inicial. Nos dois casos a tela FUNCIONA — só que a cor
//  nunca veio do tema. Num app white-label isso é a §7 vestida de token: o
//  valor fica chumbado com nome de variável.
//
//  O primeiro caso conhecido foi `--brand-on-primary` (o nome certo é
//  `--brand-on`), no bloco do cupom da sacola: o rótulo do botão Aplicar nunca
//  recebeu a cor da marca, e ninguém soube até o bloco ser removido por outro
//  motivo em 03/09/2026. A skill registrou ali que "nenhuma das três
//  ferramentas de folha responde essa pergunta hoje". Esta responde.
//
//  ## O QUE ELA NÃO JULGA
//
//  Nome MONTADO ou INDIRETO. `const TOKEN = '--app-loader-dot'` seguido de
//  `setProperty(TOKEN, cor)` define o token sem que a string apareça ao lado de
//  um `:`, e um `--x-${variante}` não aparece inteiro em lugar nenhum (§14.3).
//  Todo `--nome` que apareça dentro de uma string de JS entra na lista
//  "escritos em runtime" e SAI do veredito — subnotificar é o lado seguro aqui,
//  porque a saída desta ferramenta autoriza mexer em cor.
//
//  ## A ARMADILHA QUE ELA JÁ PAGOU: COMENTÁRIO
//
//  `tokens.css` explica a regra de uso escrevendo `var(--brand-*)` DENTRO de um
//  comentário. Sem tirar comentário antes, a varredura relata um fantasma
//  chamado `--brand-` que não existe em lugar nenhum do app. Neste repositório
//  o comentário colado é a REGRA, não a exceção — quem lê CSS aqui tira
//  comentário antes de tudo (§5.1, armadilha 1).
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const NOME = '--[A-Za-z0-9_-]+';

/** Arquivos com uma das extensões, recursivamente, pulando o que não é nosso. */
function arquivos(dir, exts) {
  const saida = [];
  if (!fs.existsSync(dir)) return saida;
  for (const nome of fs.readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'coverage'].includes(nome)) continue;
    const p = path.join(dir, nome);
    if (fs.statSync(p).isDirectory()) saida.push(...arquivos(p, exts));
    else if (exts.includes(path.extname(nome))) saida.push(p);
  }
  return saida;
}

/**
 * Tira comentário PRESERVANDO AS QUEBRAS DE LINHA.
 *
 * Trocar um bloco por um espaço colapsa o arquivo e a linha relatada aponta
 * para outro lugar — e uma mensagem que erra o endereço faz consertar o sítio
 * errado (§12.1).
 */
export function semComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, (bloco) => bloco.replace(/[^\n]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, (bloco) => bloco.replace(/[^\n]/g, ' '));
}

/** Tira comentário de JS, também preservando as quebras. */
function semComentariosJs(texto) {
  return semComentarios(texto).replace(/(^|[^:])\/\/[^\n]*/g, (m, antes) =>
    antes + ' '.repeat(m.length - antes.length)
  );
}

/**
 * O inventário: quem DEFINE, quem CONSOME, e quem só aparece em string de JS.
 *
 * Exportado para o teste unitário poder cobrar o resultado sem repetir a
 * varredura — uma segunda cópia da regra divergiria na direção do que o código
 * faz hoje, que é exatamente o que se quer pegar.
 */
export function inventario(base = raiz) {
  const folhas = arquivos(path.join(base, 'styles'), ['.css']);
  const paginas = fs.readdirSync(base).filter((f) => f.endsWith('.html')).map((f) => path.join(base, f));
  const scripts = arquivos(path.join(base, 'scripts'), ['.js']);

  const definidos = new Map();   // nome -> [sítios]
  const consumidos = new Map();  // nome -> [{arquivo, linha, fallback}]
  const emRuntime = new Map();   // nome -> [sítios] (string de JS: não julgo)

  const relativo = (p) => path.relative(base, p).split(path.sep).join('/');

  const anota = (mapa, nome, sitio) => {
    if (!mapa.has(nome)) mapa.set(nome, []);
    mapa.get(nome).push(sitio);
  };

  for (const arquivo of [...folhas, ...paginas]) {
    const linhas = semComentarios(fs.readFileSync(arquivo, 'utf8')).split('\n');
    linhas.forEach((linha, i) => {
      for (const m of linha.matchAll(new RegExp(`(${NOME})\\s*:`, 'g'))) {
        anota(definidos, m[1], { arquivo: relativo(arquivo), linha: i + 1 });
      }
      for (const m of linha.matchAll(new RegExp(`var\\(\\s*(${NOME})\\s*(,)?`, 'g'))) {
        anota(consumidos, m[1], { arquivo: relativo(arquivo), linha: i + 1, fallback: Boolean(m[2]) });
      }
    });
  }

  for (const arquivo of scripts) {
    const linhas = semComentariosJs(fs.readFileSync(arquivo, 'utf8')).split('\n');
    linhas.forEach((linha, i) => {
      const sitio = { arquivo: relativo(arquivo), linha: i + 1 };
      // Chave de objeto (`'--brand-primary': valor`) é definição de verdade: é
      // assim que `applyBrandTheme` escreve a paleta inteira.
      for (const m of linha.matchAll(new RegExp(`['"\`](${NOME})['"\`]\\s*:`, 'g'))) {
        anota(definidos, m[1], sitio);
      }
      // Qualquer outra menção dentro de string é candidata a escrita indireta.
      for (const m of linha.matchAll(new RegExp(`['"\`]\\s*(${NOME})`, 'g'))) {
        anota(emRuntime, m[1], sitio);
      }
      for (const m of linha.matchAll(new RegExp(`var\\(\\s*(${NOME})\\s*(,)?`, 'g'))) {
        anota(consumidos, m[1], { ...sitio, fallback: Boolean(m[2]) });
      }
    });
  }

  const fantasmas = [...consumidos.entries()]
    .filter(([nome]) => !definidos.has(nome) && !emRuntime.has(nome))
    .map(([nome, usos]) => ({ nome, usos }))
    .sort((a, b) => a.nome.localeCompare(b.nome));

  const naoJulgados = [...consumidos.keys()]
    .filter((nome) => !definidos.has(nome) && emRuntime.has(nome))
    .sort();

  const definidosSemLeitor = [...definidos.keys()]
    .filter((nome) => !consumidos.has(nome))
    .sort();

  return { definidos, consumidos, emRuntime, fantasmas, naoJulgados, definidosSemLeitor };
}

function principal() {
  const inv = inventario();
  const linha = (u) => `      ${u.arquivo}:${u.linha}${u.fallback ? '   (cai no fallback, em silêncio)' : '   <-- SEM fallback'}`;

  process.stdout.write(
    `\nTokens definidos: ${inv.definidos.size}   consumidos: ${inv.consumidos.size}   ` +
    `fantasmas: ${inv.fantasmas.length}\n`
  );

  if (!inv.fantasmas.length) {
    process.stdout.write('\nNenhum `var(--x)` sem dono. \n');
  } else {
    process.stdout.write('\nFANTASMAS — `var()` de um token que ninguém define:\n');
    for (const { nome, usos } of inv.fantasmas) {
      const semFallback = usos.filter((u) => !u.fallback).length;
      process.stdout.write(`\n  ${nome}   ${usos.length} uso(s), ${semFallback} sem fallback\n`);
      for (const u of usos) process.stdout.write(linha(u) + '\n');
    }
    // A ASSINATURA DE UM RENOME é um nome DEFINIDO que compartilha palavra com
    // o fantasma — `--danger` contra `--state-danger-strong`. A comparação é por
    // PALAVRA e não por prefixo: por prefixo, `--danger` tem raiz vazia e "casa"
    // com os 121 tokens do app, o que é a mesma coisa que não sugerir nada.
    const palavras = (nome) => nome.replace(/^--/, '').split('-').filter((p) => p.length > 2);
    const parecidos = inv.fantasmas
      .map(({ nome }) => {
        const minhas = new Set(palavras(nome));
        const candidatos = [...inv.definidos.keys()]
          .map((d) => ({ d, comuns: palavras(d).filter((p) => minhas.has(p)).length }))
          .filter((c) => c.comuns > 0)
          .sort((a, b) => b.comuns - a.comuns)
          .slice(0, 5)
          .map((c) => c.d);
        return candidatos.length ? `  ${nome}  ->  ${candidatos.join(', ')}` : '';
      })
      .filter(Boolean);
    if (parecidos.length) {
      process.stdout.write('\nNOMES PARECIDOS que existem (candidatos a renome errado):\n');
      process.stdout.write(parecidos.join('\n') + '\n');
    }
  }

  if (inv.naoJulgados.length) {
    process.stdout.write(
      `\nNÃO JULGADOS (${inv.naoJulgados.length}) — o nome aparece em string de JS, ` +
      'então pode ser escrito em runtime:\n  ' + inv.naoJulgados.join('\n  ') + '\n'
    );
  }

  process.stdout.write(
    `\nDefinidos e lidos por ninguém: ${inv.definidosSemLeitor.length}` +
    (inv.definidosSemLeitor.length ? '\n  ' + inv.definidosSemLeitor.join('\n  ') : '') +
    '\n\nEsta ferramenta não julga sozinha: token consumido só por markup de ' +
    'runtime\nnão aparece aqui, e token definido sem leitor pode ser API para o ' +
    'tenant.\n'
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal();
}
