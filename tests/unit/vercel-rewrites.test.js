import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { compileRoute, rewriteUrl, readRewrites } from '../../tools/vercel-rewrites.js';

// O espelho de roteamento do dev/preview lê a vercel.json de verdade. Se ele
// divergir do que a Vercel faz, o local mente: o e2e ficaria verde com rotas que
// só existem aqui, ou vermelho com rotas que só existem lá.

const here = dirname(fileURLToPath(import.meta.url));
const REWRITES = readRewrites(resolve(here, '..', '..', 'vercel.json'));

const go = (url) => rewriteUrl(REWRITES, url);

describe('compilação do source', () => {
  it('respeita parênteses aninhados no padrão do parâmetro', () => {
    // Um replace ingênuo cortaria no primeiro ')' e geraria regex inválida.
    const { regex, params } = compileRoute('/:slug([a-z0-9]+(?:-[a-z0-9]+)*)');

    expect(params).toEqual(['slug']);
    expect(regex.test('/junior-da-picanha')).toBe(true);
    expect(regex.test('/Junior')).toBe(false);
    expect(regex.test('/a/b')).toBe(false);
  });

  it('escapa o que é literal', () => {
    const { regex } = compileRoute('/manifest.webmanifest');
    expect(regex.test('/manifest.webmanifest')).toBe(true);
    expect(regex.test('/manifestXwebmanifest')).toBe(false);
  });

  it(':nome sem padrão casa um segmento', () => {
    const { regex, params } = compileRoute('/r/:slug');
    expect(params).toEqual(['slug']);
    expect(regex.test('/r/fuji')).toBe(true);
    expect(regex.test('/r/fuji/extra')).toBe(false);
  });
});

describe('as rotas reais da vercel.json', () => {
  it('/<slug> serve a página do restaurante', () => {
    expect(go('/junior-da-picanha')).toBe('/restaurant.html?slug=junior-da-picanha');
  });

  it('/<slug>/ — o start_url do app instalado — resolve', () => {
    expect(go('/junior-da-picanha/')).toBe('/restaurant.html?slug=junior-da-picanha');
  });

  it('/<slug>/manifest.webmanifest cai no arquivo único', () => {
    expect(go('/junior-da-picanha/manifest.webmanifest')).toBe('/manifest.webmanifest');
  });

  it('mantém os formatos antigos', () => {
    expect(go('/r/fuji')).toBe('/restaurant.html?slug=fuji');
    expect(go('/restaurantes/fuji')).toBe('/restaurant.html?slug=fuji');
  });

  it('/<slug>/produto/<id> abre a loja com o produto na query', () => {
    // O ENDEREÇO DE UM PRATO. Até 05/09/2026 o app tinha uma url por LOJA:
    // abrir um produto não mudava a barra, então quem quisesse mandar um prato
    // para alguém mandava a home. Este rewrite é a metade que funciona para
    // todo mundo — a outra (o cartão de compartilhamento com a foto) só chega
    // a quem executa JS, porque o app é estático e o crawler não executa.
    expect(go('/junior-da-picanha/produto/abc-123'))
      .toBe('/restaurant.html?slug=junior-da-picanha&produto=abc-123');
  });

  it('a rota de produto NAO engole /<slug>/manifest.webmanifest', () => {
    // As duas têm dois segmentos e a ordem no arquivo é o que as separa. Se
    // alguém mover a de produto para cima da do manifest, o app instalado
    // perde o manifest — e isso não aparece em nenhuma tela.
    expect(go('/junior-da-picanha/manifest.webmanifest')).toBe('/manifest.webmanifest');
  });

  it('a query original sobrevive ao rewrite', () => {
    expect(go('/fuji?utm_source=insta')).toBe('/restaurant.html?slug=fuji&utm_source=insta');
  });

  it('não reescreve o que já é arquivo servido na raiz', () => {
    expect(go('/restaurant.html')).toBeNull();
    expect(go('/manifest.webmanifest')).toBeNull();
    expect(go('/sw.js')).toBeNull();
  });

  // O middleware roda DEPOIS do filesystem (como na Vercel), então um asset
  // existente já respondeu. Estes casos são a segunda linha de defesa.
  it('não engole caminhos de mais de um segmento que não são rota de tenant', () => {
    expect(go('/assets/icons/pwa/rapidex-192.png')).toBeNull();
    expect(go('/assets/restaurant-CEpZNkEG.css')).toBeNull();
  });
});
