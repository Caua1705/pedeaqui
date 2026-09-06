import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * QUEM CONFERE A PRODUÇÃO NÃO PODE SER APAGADO EM SILÊNCIO.
 *
 * `tools/csp-em-producao.mjs` é a única coisa neste repositório que olha para o
 * header que o navegador REALMENTE recebe. Todo o resto — `csp.spec.js`,
 * `google-identity.test.js`, `pwa-manifest.test.js` — lê a `vercel.json` do
 * disco, e foi por isso que em 05/09/2026 o `npm test` ficou verde, o
 * documento escreveu "Corrigido" e a produção passou um dia inteiro recusando
 * o `gsi/style` do botão do Google, em toda visita.
 *
 * Mas a ferramenta roda no CI, DEPOIS do deploy — e nada num arquivo de CI
 * grita quando some num refactor. Este teste é o grito. Ele não confere CSP
 * nenhum: ele confere que a conferência continua ligada, e ligada no lugar
 * certo. Mesmo papel que o `deploy-gate.test.js` faz para o próprio deploy.
 *
 * As duas metades precisam existir juntas, e meia trava é pior que nenhuma:
 *   1. a ferramenta existe e tem sonda para TODO bloco de CSP da vercel.json;
 *   2. o `ci.yml` a chama, no job `deploy`, DEPOIS de publicar.
 */

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ci = readFileSync(resolve(raiz, '.github', 'workflows', 'ci.yml'), 'utf8');
const ferramenta = readFileSync(resolve(raiz, 'tools', 'csp-em-producao.mjs'), 'utf8');
const vercel = JSON.parse(readFileSync(resolve(raiz, 'vercel.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(resolve(raiz, 'package.json'), 'utf8'));

const CHAMADA = /node tools\/csp-em-producao\.mjs/;

describe('a CSP servida pela produção é conferida depois do deploy', () => {
  it('o ci.yml chama a ferramenta', () => {
    expect(ci, 'ninguém confere o header servido — só a vercel.json do disco').toMatch(CHAMADA);
  });

  it('a chamada está DEPOIS de publicar, e não antes', () => {
    // Ordem literal no arquivo. O passo que publica é `vercel deploy --prod`;
    // conferir antes dele mede o deploy ANTERIOR e não diz nada sobre este.
    const publicar = ci.search(/vercel@latest deploy --prebuilt --prod/);
    const conferir = ci.search(CHAMADA);
    expect(publicar, 'o passo que publica sumiu do ci.yml').toBeGreaterThan(-1);
    expect(conferir, 'a conferência sumiu do ci.yml').toBeGreaterThan(-1);
    expect(
      conferir,
      'a conferência ficou ANTES do deploy — ela mediria a produção velha'
    ).toBeGreaterThan(publicar);
  });

  it('a chamada NÃO está no verify — lá ela trancaria o deploy para sempre', () => {
    // O `verify` roda antes do `deploy`. Uma conferência de produção ali leria
    // o deploy anterior: toda mudança de CSP reprovaria o verify, o deploy
    // nunca aconteceria, e a mudança jamais chegaria à produção que ela cobra.
    // Trava fechada, e ela se parece com um teste rigoroso — por isso o teste.
    const verify = ci.slice(ci.search(/^ {2}verify:/m), ci.search(/^ {2}deploy:/m));
    expect(verify, 'a conferência de produção caiu dentro do job verify').not.toMatch(CHAMADA);
  });

  it('a falta do header é FALHA, não um passo pulado em silêncio', () => {
    // `continue-on-error` transformaria o único olho na produção num enfeite:
    // job verde, header errado, ninguém sabendo. É o mesmo modo de falha que o
    // "Conferir o segredo do deploy" existe para acabar.
    const passo = ci.slice(ci.search(CHAMADA) - 400, ci.search(CHAMADA) + 200);
    expect(passo).not.toMatch(/continue-on-error/);
    expect(ferramenta, 'a ferramenta precisa sair com código de erro').toMatch(
      /process\.exit\(1\)/
    );
  });

  it('todo bloco de CSP da vercel.json tem uma sonda na ferramenta', () => {
    // A ferramenta também cobra isto em tempo de execução, mas só DEPOIS do
    // deploy. Aqui a falta aparece no `verify`, antes de publicar: quem
    // acrescentar um terceiro bloco de CSP descobre no portão, e não no dia em
    // que uma política que ninguém pediu estiver errada há semanas.
    const comCsp = (vercel.headers || [])
      .filter((b) => b.headers?.some((h) => h.key.toLowerCase() === 'content-security-policy'))
      .map((b) => b.source);
    expect(comCsp.length, 'nenhum bloco de CSP na vercel.json').toBeGreaterThan(0);

    const sondas = [...ferramenta.matchAll(/\{\s*source:\s*'([^']+)'\s*,\s*caminho:/g)].map(
      (m) => m[1]
    );
    for (const source of comCsp) {
      expect(sondas, `o bloco ${source} não tem sonda em tools/csp-em-producao.mjs`).toContain(
        source
      );
    }
  });

  it('dá para rodar à mão, sem decorar o caminho', () => {
    expect(pkg.scripts, 'sem script npm, a ferramenta só existe para o CI').toHaveProperty(
      'csp:prod'
    );
    expect(pkg.scripts['csp:prod']).toMatch(CHAMADA);
  });
});
