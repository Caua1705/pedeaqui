import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

// ============================================================================
//  TODA `import.meta.env.VITE_*` QUE O APP LÊ TEM DE ESTAR NO PASSO DE DEPLOY.
//
//  O Vite INLINA `import.meta.env` no bundle em tempo de BUILD. Quem decide o
//  valor é o ambiente de quem constrói — e aqui quem constrói **não é a
//  Vercel**: desde 02/09/2026 o `vercel.json` desligou o deploy automático da
//  main e o `ci.yml` publica com `vercel build --prod` **no runner do GitHub**,
//  sem `vercel pull` (o `pull` quebrava com o projeto num time).
//
//  A consequência é a que custou esta rodada, e ela não tem sintoma nenhum:
//  **variável cadastrada no painel da Vercel NÃO CHEGA ao bundle.** O build lê
//  exclusivamente o `env:` do passo de publicação.
//
//  Em 04/09/2026 o "Entrar com Google" ganhou `VITE_GOOGLE_CLIENT_ID`. A
//  variável foi cadastrada no painel — em Production, Preview e Development — e
//  o botão continuou escondido em produção. O bundle publicado provou o
//  mecanismo por CONTRASTE, no mesmo arquivo:
//
//      VITE_MAPS_KEY           preenchida    (é secret do repositório)
//      VITE_GOOGLE_CLIENT_ID   vazia         (só existia no painel)
//
//  Este teste não confere se o SECRET existe — isso só o GitHub sabe, e um
//  secret ausente já vira `::warning` no log do passo. Ele confere a outra
//  metade, que é a que ninguém lembra: se o app passou a LER uma variável de
//  build, o passo de deploy tem de DECLARÁ-LA. Sem isso ela nasce vazia em
//  produção, e o único sintoma é uma tela que não faz o que deveria.
// ============================================================================

const RAIZ = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const CI = join(RAIZ, '.github', 'workflows', 'ci.yml');

function arquivos(dir, exts, saida = []) {
  for (const nome of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git'].includes(nome)) continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) arquivos(p, exts, saida);
    else if (exts.includes(extname(nome))) saida.push(p);
  }
  return saida;
}

/** Tira comentário PRESERVANDO as quebras — linha errada faz consertar o sítio errado. */
const semComentarios = (texto) => texto
  .replace(/\/\*[\s\S]*?\*\//g, (bloco) => bloco.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, antes) => antes + ' '.repeat(m.length - antes.length));

/** As `VITE_*` que o CÓDIGO DO APP lê de fato (comentário não conta). */
function lidasPeloApp() {
  const achadas = new Map();
  for (const arquivo of arquivos(join(RAIZ, 'scripts'), ['.js'])) {
    const linhas = semComentarios(readFileSync(arquivo, 'utf8')).split('\n');
    linhas.forEach((linha, i) => {
      for (const m of linha.matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) {
        if (!achadas.has(m[1])) achadas.set(m[1], `${relative(RAIZ, arquivo)}:${i + 1}`);
      }
    });
  }
  return achadas;
}

/** As `VITE_*` declaradas no `env:` do passo que publica. */
function declaradasNoDeploy() {
  const ci = readFileSync(CI, 'utf8');
  const passo = ci.slice(ci.indexOf('- name: Publicar na Vercel'));
  const bloco = passo.slice(0, passo.indexOf('run: |'));
  return new Set([...bloco.matchAll(/^\s+(VITE_[A-Z0-9_]+):/gm)].map((m) => m[1]));
}

describe('variáveis de build: o painel da Vercel não chega ao bundle', () => {
  const lidas = lidasPeloApp();
  const declaradas = declaradasNoDeploy();

  // SONDA CONTRA VACUIDADE, nas duas pontas: se qualquer uma das varreduras
  // parar de casar, a comparação abaixo passa por vazio — que é a pior forma
  // de passar.
  it('as duas varreduras ainda encontram alguma coisa', () => {
    expect(lidas.size, 'nenhuma import.meta.env.VITE_* achada em scripts/').toBeGreaterThanOrEqual(3);
    expect(declaradas.size, 'nenhuma VITE_* achada no passo de deploy do ci.yml').toBeGreaterThanOrEqual(3);
    expect(lidas.has('VITE_MAPS_KEY'), 'a varredura do app parou de casar').toBe(true);
  });

  it('toda VITE_* lida pelo app está declarada no passo de deploy', () => {
    const faltando = [...lidas.entries()]
      .filter(([nome]) => !declaradas.has(nome))
      .map(([nome, onde]) => `${nome}  (lida em ${onde})`);
    expect(
      faltando,
      'variável de build que o app lê e o passo de deploy NÃO declara: ela vai '
      + 'nascer VAZIA no bundle publicado, e configurá-la no painel da Vercel '
      + 'não resolve — o build roda no runner do GitHub'
    ).toEqual([]);
  });
});
