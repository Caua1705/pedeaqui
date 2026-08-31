import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * O DEPLOY NÃO PODE SAIR NA FRENTE DO PORTÃO.
 *
 * Até 31/08/2026 a integração Git da Vercel publicava a `main` no instante do
 * push. O `ci.yml` roda `on: push: branches: [main]` — ele CONFERE, ele não
 * publica, e a Vercel não esperava por ele. O site subia e o portão ficava
 * vermelho depois. Isso quase custou caro na rodada anterior: o portão
 * pré-merge reportou `exit 0` com dois testes vermelhos por causa de um
 * `| tail`, e se o merge tivesse saído ali o deploy teria ido junto.
 *
 * A trava tem duas metades e as duas precisam existir ao mesmo tempo — meia
 * trava é pior que nenhuma, porque parece uma:
 *
 *   1. `vercel.json` desliga o deploy automático DA MAIN.
 *   2. `ci.yml` publica, num job que depende do `verify`.
 *
 * Este teste existe para que reativar a metade 1 no painel, ou apagar a metade
 * 2 num refactor de CI, não passe em silêncio.
 */

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const vercel = JSON.parse(readFileSync(resolve(raiz, 'vercel.json'), 'utf8'));
const ci = readFileSync(resolve(raiz, '.github', 'workflows', 'ci.yml'), 'utf8');

describe('o deploy espera o portão', () => {
  it('a main não publica sozinha', () => {
    expect(vercel.git?.deploymentEnabled?.main).toBe(false);
  });

  it('o preview das outras branches continua ligado', () => {
    // `deploymentEnabled` desliga SÓ as branches nomeadas. Se alguém escrever
    // um `false` de outra branch aqui, o preview morre junto — e preview é o
    // que a migração do Maps ainda precisa para ser verificada (a chave do
    // Google não libera localhost).
    expect(Object.keys(vercel.git.deploymentEnabled)).toEqual(['main']);
  });

  it('quem publica é o CI, num job que depende do verify', () => {
    expect(ci, 'não há job de deploy').toMatch(/^ {2}deploy:/m);
    expect(ci, 'o deploy não depende do verify').toMatch(/needs:\s*verify/);
    expect(ci, 'o deploy não está preso à main').toMatch(/refs\/heads\/main/);
    expect(ci, 'nada publica de fato').toMatch(/vercel[^\n]*deploy[^\n]*--prod/);
  });

  it('sem o segredo o job FALHA, em vez de ficar verde sem ter publicado', () => {
    // Um deploy que se pula em silêncio devolve o buraco inteiro: o CI fica
    // verde, ninguém olha, e a produção para no commit anterior sem aviso.
    expect(ci).toMatch(/VERCEL_TOKEN/);
    expect(ci).toMatch(/::error::/);
  });
});
