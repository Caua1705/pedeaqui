#!/usr/bin/env node
/**
 * O QUE O NAVEGADOR RECEBE, NÃO O QUE O ARQUIVO DIZ.
 *
 * Em 05/09/2026 o `style-src` ganhou `https://accounts.google.com` na
 * `vercel.json`, o `google-identity.test.js` passou a exigir a diretiva, o
 * `npm test` ficou verde e o documento escreveu "Corrigido". A produção
 * continuou servindo o header ANTIGO por um dia inteiro, recusando o
 * `gsi/style` em toda visita, porque o commit nunca tinha sido empurrado.
 *
 * Nenhum teste do repositório podia ter pego isso: todos leem a `vercel.json`,
 * e a `vercel.json` do disco não é o header que sai pelo fio. Entre o arquivo
 * e o navegador existem um push, um CI, um `vercel deploy` e um alias de
 * domínio — quatro lugares onde a correção some sem uma linha de aviso.
 *
 * Esta ferramenta fecha esse vão: ela pede o header à PRODUÇÃO e compara,
 * diretiva por diretiva, com o que a `vercel.json` deste commit declara.
 *
 * POR QUE ELA NÃO É UM `npm test`
 * -------------------------------
 * O `npm test` roda no job `verify`, que roda ANTES do `deploy` (a main não
 * publica sozinha — `deploy-gate.test.js`). Uma checagem de produção ali leria
 * o deploy ANTERIOR: toda mudança de CSP reprovaria o `verify`, o `deploy`
 * nunca aconteceria, e a mudança jamais chegaria à produção que a checagem
 * cobra. Trava fechada. O lugar dela é DEPOIS do `vercel deploy --prod`, e é
 * lá que o `ci.yml` a chama. Quem garante que ela continua chamada é
 * `tests/unit/csp-producao-gate.test.js`.
 *
 * FALHAR É O COMPORTAMENTO. Rede fora, DNS fora, 500 — tudo isso é FALHA, não
 * "pulei". Um "pulei" em silêncio devolve exatamente o buraco que ela tapa.
 *
 * Uso:
 *   node tools/csp-em-producao.mjs
 *   node tools/csp-em-producao.mjs --esperar 180   # dá tempo ao alias do deploy
 *   CSP_PROD_BASE=https://outra.origem node tools/csp-em-producao.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { setTimeout as dormir } from 'node:timers/promises';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vercel = JSON.parse(readFileSync(resolve(raiz, 'vercel.json'), 'utf8'));

const BASE = process.env.CSP_PROD_BASE || 'https://www.pederapidex.com';

const arg = (nome) => {
  const i = process.argv.indexOf(nome);
  return i === -1 ? null : process.argv[i + 1];
};
const ESPERAR = Number(arg('--esperar') || 0);
const INTERVALO = 10;

/**
 * Cada bloco de CSP da `vercel.json` precisa de uma URL que caia NELE.
 *
 * A tabela é explícita e é conferida contra o arquivo no início do `main()`:
 * um terceiro bloco de CSP sem sonda aqui FALHA, em vez de passar sem ser
 * olhado. Uma política que ninguém pede é uma política que ninguém vê quebrar.
 *
 * O caminho do entregador NÃO é decorativo: `/entregador/x` casa os DOIS
 * blocos (`/(.*)` também casa), e foi pedindo esta URL que se mediu qual vale.
 * MEDIDO em 06/09/2026: vem UM header só, o do bloco mais específico — para a
 * mesma chave o bloco específico SUBSTITUI, não soma. (Chaves distintas somam:
 * `/sw.js` recebe o `Service-Worker-Allowed` dele e o CSP do bloco global.)
 */
const SONDAS = [
  { source: '/(.*)', caminho: '/' },
  { source: '/entregador(/.*)?', caminho: '/entregador/x' }
];

/** "script-src 'self' https://x" -> Map { 'script-src' => Set{"'self'", 'https://x'} } */
const diretivas = (csp) =>
  new Map(
    String(csp || '')
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const [nome, ...valores] = p.split(/\s+/);
        return [nome.toLowerCase(), new Set(valores)];
      })
  );

const blocoDe = (source) =>
  vercel.headers
    ?.find((b) => b.source === source)
    ?.headers?.find((h) => h.key.toLowerCase() === 'content-security-policy')?.value;

async function pedirHeader(caminho) {
  // A query NÃO é cache-buster aqui, e vale escrito porque parece um.
  // MEDIDO em 06/09/2026: com `?csp-check=<agora>` a resposta volta
  // `x-vercel-cache: HIT` e `age: 22413` — a query string não entra na chave de
  // cache desta origem. Ela fica por higiene, não por eficácia.
  //
  // O que torna a leitura confiável não é furar o cache: é que um deploy novo é
  // um deployment novo, e o cache dele nasce vazio. Um HIT depois de publicar é
  // HIT da resposta NOVA. Por isso `x-vercel-cache` e `age` são impressos no
  // erro — quem lê o log precisa poder separar "resposta guardada" de "deploy
  // que não subiu", e essas duas linhas são o que separa.
  const url = `${BASE}${caminho}${caminho.includes('?') ? '&' : '?'}csp-check=${Date.now()}`;
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  return {
    url,
    status: res.status,
    csp: res.headers.get('content-security-policy'),
    cache: res.headers.get('x-vercel-cache') || '—',
    idade: res.headers.get('age') || '—',
    deploy: res.headers.get('x-vercel-id') || '—'
  };
}

function conferir(esperado, recebido) {
  const problemas = [];
  if (recebido.csp == null) {
    problemas.push('a resposta não traz Content-Security-Policy nenhum');
    return problemas;
  }

  // `fetch` junta headers repetidos com vírgula, e valor de CSP não tem vírgula.
  // Duas políticas na mesma resposta não é detalhe de arrumação: o navegador
  // aplica a INTERSEÇÃO, e um host liberado em só uma passa a ser BLOQUEADO.
  const quantas = recebido.csp.split(',').length;
  if (quantas !== 1) {
    problemas.push(
      `${quantas} políticas na mesma resposta — o browser aplica a interseção das duas`
    );
  }

  const e = diretivas(esperado);
  const r = diretivas(recebido.csp);

  for (const [nome, valores] of e) {
    if (!r.has(nome)) {
      problemas.push(`falta a diretiva \`${nome}\` no header servido`);
      continue;
    }
    const servido = r.get(nome);
    const sumiram = [...valores].filter((v) => !servido.has(v));
    const sobraram = [...servido].filter((v) => !valores.has(v));
    if (sumiram.length) problemas.push(`\`${nome}\` servido NÃO tem: ${sumiram.join(' ')}`);
    if (sobraram.length) problemas.push(`\`${nome}\` servido tem a MAIS: ${sobraram.join(' ')}`);
  }
  for (const nome of r.keys()) {
    if (!e.has(nome)) {
      problemas.push(`o header servido declara \`${nome}\`, que a vercel.json não tem`);
    }
  }
  return problemas;
}

async function main() {
  // Um bloco de CSP sem sonda passaria despercebido para sempre.
  const comCsp = (vercel.headers || [])
    .filter((b) => b.headers?.some((h) => h.key.toLowerCase() === 'content-security-policy'))
    .map((b) => b.source);
  const semSonda = comCsp.filter((s) => !SONDAS.some((p) => p.source === s));
  if (semSonda.length) {
    console.error(
      `::error::Bloco(s) de CSP sem sonda em tools/csp-em-producao.mjs: ${semSonda.join(', ')}. ` +
        'Acrescente um caminho que caia nele — sem sonda, essa política nunca é conferida contra a produção.'
    );
    process.exit(1);
  }

  const limite = Date.now() + ESPERAR * 1000;
  let tentativa = 0;
  let falhas;

  for (;;) {
    tentativa++;
    falhas = [];
    for (const sonda of SONDAS) {
      const esperado = blocoDe(sonda.source);
      if (!esperado) {
        falhas.push({
          sonda,
          recebido: null,
          problemas: [`bloco \`${sonda.source}\` sumiu da vercel.json`]
        });
        continue;
      }
      let recebido;
      try {
        recebido = await pedirHeader(sonda.caminho);
      } catch (erro) {
        falhas.push({
          sonda,
          recebido: null,
          problemas: [`a requisição não completou: ${erro.message}`]
        });
        continue;
      }
      const problemas = conferir(esperado, recebido);
      if (problemas.length) falhas.push({ sonda, recebido, problemas });
    }
    if (!falhas.length || Date.now() >= limite) break;
    console.log(
      `tentativa ${tentativa}: ainda diferente, esperando ${INTERVALO}s (o alias do deploy pode estar propagando)`
    );
    await dormir(INTERVALO * 1000);
  }

  if (!falhas.length) {
    console.log(
      `CSP de ${BASE} confere com a vercel.json deste commit, nas ${SONDAS.length} sondas:`
    );
    for (const s of SONDAS) console.log(`  ${s.caminho}  ->  bloco ${s.source}`);
    return;
  }

  for (const { sonda, recebido, problemas } of falhas) {
    console.error(`\n=== ${BASE}${sonda.caminho}  (bloco ${sonda.source}) ===`);
    if (recebido) {
      console.error(
        `HTTP ${recebido.status} | x-vercel-cache: ${recebido.cache} | age: ${recebido.idade} | ${recebido.deploy}`
      );
      console.error(`servido:     ${recebido.csp}`);
      console.error(`vercel.json: ${blocoDe(sonda.source)}`);
    }
    for (const p of problemas) console.error(`  - ${p}`);
  }
  console.error(
    '\n::error::O header servido pela producao NAO e o da vercel.json deste commit. ' +
      'Se `x-vercel-cache` for HIT com `age` alto, e resposta guardada; se for MISS ou BYPASS, ' +
      'o deploy nao subiu este commit e a correcao nao esta no ar.'
  );
  process.exit(1);
}

main();
