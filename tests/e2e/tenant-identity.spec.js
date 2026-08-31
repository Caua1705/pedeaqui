import { test, expect } from '@playwright/test';
import { mockApi, MENU, SLUG, RESTAURANT_URL, esperarAppPronto } from './helpers.js';

// O app é white-label DENTRO da página há tempo. Fora dela não era: a aba, o
// ícone de tela inicial e o cartão de compartilhamento eram da plataforma.
//
// Estes testes travam a propriedade que interessa, e ela é NEGATIVA: nada que o
// cliente final vê fora da página pode ser nosso. Um teste que só conferisse "a
// logo do piloto aparece" passaria verde no dia em que a cadeia de reserva
// voltasse a cair no mark do Rapidex — que é exatamente o bug consertado aqui.

const PILOT_NAME = 'Júnior da Picanha';
const PILOT_LOGO = MENU.restaurant.logo_url;

/** Tudo o que o <head> declara como identidade, depois do boot. */
function headIdentity(page) {
  return page.evaluate(() => ({
    title: document.title,
    icon: document.querySelector('link[rel="icon"]')?.getAttribute('href') || null,
    appleTouch: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') || null,
    themeColor: document.querySelector('meta[name="theme-color"]')?.content || null,
    ogTitle: document.querySelector('meta[property="og:title"]')?.content || null,
    ogImage: document.querySelector('meta[property="og:image"]')?.content || null,
    ogSite: document.querySelector('meta[property="og:site_name"]')?.content || null,
    description: document.querySelector('meta[name="description"]')?.content || null
  }));
}

async function boot(page, url = RESTAURANT_URL) {
  await page.goto(url);
  await esperarAppPronto(page);
  // applyTenantIcons roda dentro de applyTheme; espera o favicon existir.
  await expect.poll(() => page.getAttribute('link[rel="icon"]', 'href')).toBeTruthy();
}

test('a aba é do restaurante: título, favicon e ícone de tela inicial', async ({ page }) => {
  await mockApi(page);
  await boot(page);

  const head = await headIdentity(page);

  expect(head.title).toBe(`${PILOT_NAME} — Pedido Online`);
  expect(head.icon).toBe(PILOT_LOGO);
  expect(head.appleTouch).toBe(PILOT_LOGO);
});

// O <link rel="apple-touch-icon"> fixo para /assets/icons/pwa/app-192.png era a
// pior das fugas: no iOS é ele — não o manifest — que vira o ícone da tela
// inicial, e é ele que o WhatsApp usa de miniatura quando não há og:image.
test('NENHUM asset da plataforma sobra no <head>', async ({ page }) => {
  await mockApi(page);
  await boot(page);

  const head = await page.evaluate(() => document.head.innerHTML);
  const tags = head.replace(/<!--[\s\S]*?-->/g, ''); // comentários explicam o porquê; não são servidos como marca

  expect(tags).not.toContain('/assets/icons/pwa/');
  expect(tags).not.toMatch(/content="[^"]*Rapidex/i);
});

test('as meta de compartilhamento levam o nome e a logo da loja', async ({ page }) => {
  await mockApi(page);
  await boot(page);

  const head = await headIdentity(page);

  expect(head.ogSite).toBe(PILOT_NAME);
  expect(head.ogTitle).toContain(PILOT_NAME);
  expect(head.ogImage).toBe(PILOT_LOGO);
  expect(head.description).toBe(MENU.restaurant.description);
});

// A tag neutra do HTML tem que ser SOBRESCRITA, não acompanhada. Quem lê Open
// Graph — crawler, in-app browser, Web Share — pega a PRIMEIRA ocorrência: uma
// segunda tag ao lado deixaria o link se anunciando como "Pedido Online" com a
// do restaurante logo abaixo, sem ninguém olhar.
test('não sobra uma segunda meta neutra na frente da do restaurante', async ({ page }) => {
  await mockApi(page);
  await boot(page);

  for (const selector of ['meta[property="og:title"]', 'meta[property="og:description"]', 'meta[name="description"]']) {
    expect(await page.locator(selector).count(), selector).toBe(1);
  }
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /Júnior da Picanha/);
});

test('a barra do browser recebe a cor da loja, não a nossa', async ({ page }) => {
  await mockApi(page);
  await boot(page);

  expect((await headIdentity(page)).themeColor.toUpperCase())
    .toBe(MENU.restaurant.primary_color.toUpperCase());
});

// O CASO QUE MOTIVOU A TAREFA. Sem logo cadastrada, a saída NÃO pode ser o
// nosso favicon — esse era o vazamento. É a marca gerada: iniciais da loja
// sobre a cor da loja.
test.describe('restaurante SEM logo cadastrada', () => {
  // Registrada DEPOIS de mockApi de propósito: as rotas do Playwright são LIFO,
  // então esta ganha do fixture geral. Devolve o mesmo cardápio com a logo
  // apagada — e sem route.fetch(), que iria à rede de verdade.
  const semLogo = (page) => page.route('**/api.pederapidex.com/**/menu*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ...MENU,
      restaurant: { ...MENU.restaurant, logo_url: '', logo_path: '' }
    })
  }));

  test('o favicon é a marca gerada da loja, nunca a da plataforma', async ({ page }) => {
    await mockApi(page);
    await semLogo(page);
    await boot(page);

    const head = await headIdentity(page);

    expect(head.icon.startsWith('data:image/svg+xml,')).toBe(true);
    const svg = decodeURIComponent(head.icon.replace('data:image/svg+xml,', ''));
    // "JD" de Júnior da Picanha, sobre o #D95C04 dele.
    expect(svg).toContain('>JD<');
    expect(svg).toContain(MENU.restaurant.primary_color);
    expect(head.icon).not.toContain('/assets/');
  });

  // O iOS ignora o manifest e não aceita SVG no apple-touch-icon, então a marca
  // gerada precisa chegar lá rasterizada em PNG. Falhar aqui devolveria a tela
  // inicial ao print da página — aceitável; ao nosso mark — não.
  test('o ícone de tela inicial do iOS sai em PNG', async ({ page }) => {
    await mockApi(page);
    await semLogo(page);
    await boot(page);

    await expect
      .poll(() => page.getAttribute('link[rel="apple-touch-icon"]', 'href'), { timeout: 10_000 })
      .toMatch(/^data:image\/png;base64,/);
  });
});

test.describe('manifest do app instalado', () => {
  async function tenantManifest(page) {
    await expect
      .poll(() => page.getAttribute('link[rel="manifest"]', 'href'), { timeout: 10_000 })
      .toMatch(/^blob:/);
    return page.evaluate(async () => {
      const href = document.querySelector('link[rel="manifest"]').href;
      return (await fetch(href)).json();
    });
  }

  test('quem instalar vê o nome e o ícone do RESTAURANTE', async ({ page }) => {
    await mockApi(page);
    await boot(page);

    const manifest = await tenantManifest(page);

    expect(manifest.short_name).toBe(PILOT_NAME);
    expect(manifest.icons[0].src).toBe(PILOT_LOGO);
    // O type sai da extensão: o piloto cadastrou .webp, e declarar image/png
    // fazia o browser considerar um ícone que o arquivo não é.
    expect(manifest.icons[0].type).toBe('image/webp');
  });

  test('nenhum ícone da plataforma entra no manifest do tenant', async ({ page }) => {
    await mockApi(page);
    await boot(page);

    const manifest = await tenantManifest(page);

    expect(JSON.stringify(manifest)).not.toContain('/assets/');
    expect(JSON.stringify(manifest)).not.toMatch(/rapidex|pedeaqui/i);
  });

  // A camada estática serve TODOS os tenants ao mesmo tempo; um ícone nela é,
  // por definição, o de nenhum restaurante — e era o nosso.
  test('o manifest estático não declara ícone nenhum', async ({ request }) => {
    const response = await request.get(`/${SLUG}/manifest.webmanifest`);
    expect(response.status()).toBe(200);

    const manifest = await response.json();
    expect(manifest.icons).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toMatch(/rapidex|pedeaqui/i);
  });
});

// O HTML servido é o que o crawler do WhatsApp lê — ele não executa JS. Não dá
// para ele ter a marca do restaurante sem render no servidor; dá, e é
// obrigatório, para ele não ter a nossa.
test('o HTML servido, sem JS, não carrega marca de ninguém', async ({ request }) => {
  const html = await (await request.get(RESTAURANT_URL)).text();
  const head = html.slice(0, html.indexOf('</head>')).replace(/<!--[\s\S]*?-->/g, '');

  expect(head).not.toContain('/assets/icons/pwa/');
  expect(head).not.toMatch(/<title>[^<]*Rapidex/i);
  expect(head).not.toMatch(/content="[^"]*Rapidex/i);
  // Neutro, e neutro de verdade: nem a nossa cor de marca na barra do browser.
  expect(head).not.toContain('#F36F21');
});
