import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Publica window.RapidexTheme — buildTenantManifest usa normalizeHex para não
// deixar um hex inválido do lojista virar theme_color.
import '../../scripts/utils/brand-theme.js';
// Publica window.RapidexTenantIdentity, de onde saem os ícones do manifest.
// Precisa vir antes de pwa.js, igual à ordem de scripts/entry-restaurant.js.
import '../../scripts/utils/tenant-identity.js';
// Publica window.RapidexPWA.
import '../../scripts/utils/pwa.js';

const { tenantScope, staticManifestUrl, buildTenantManifest } = window.RapidexPWA;

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const readJson = (name) => JSON.parse(readFileSync(resolve(root, name), 'utf8'));

const ORIGIN = 'https://rapidex.com';
const build = (parts) => buildTenantManifest({ origin: ORIGIN, topology: 'path', ...parts });

describe('escopo do tenant', () => {
  it('em topologia de path, é o diretório do slug COM barra final', () => {
    expect(tenantScope('junior-da-picanha', 'path')).toBe('/junior-da-picanha/');
  });

  it('em subdomínio, é a raiz — a origem já é do tenant', () => {
    expect(tenantScope('junior-da-picanha', 'subdomain')).toBe('/');
  });

  it('sem slug, não inventa diretório', () => {
    expect(tenantScope('', 'path')).toBe('/');
  });

  // Esta é A razão da barra final. O escopo é comparado como PREFIXO DE STRING
  // no path: sem a barra, o app instalado de /pizzaria capturaria /pizzaria-2.
  it('a barra final impede que um slug capture o vizinho de mesmo prefixo', () => {
    const scope = tenantScope('pizzaria', 'path');
    const dentroDoEscopo = (path) => path.startsWith(scope);

    expect(dentroDoEscopo('/pizzaria/')).toBe(true);
    expect(dentroDoEscopo('/pizzaria-centro')).toBe(false);
    expect(dentroDoEscopo('/pizzaria2')).toBe(false);
    // E, sem a barra, o vizinho entraria — o caso que o teste existe para travar.
    expect('/pizzaria-centro'.startsWith('/pizzaria')).toBe(true);
  });

  it('a URL do manifest estático é o arquivo único sob o diretório do tenant', () => {
    expect(staticManifestUrl('fuji', 'path')).toBe('/fuji/manifest.webmanifest');
    expect(staticManifestUrl('fuji', 'subdomain')).toBe('/manifest.webmanifest');
  });
});

describe('manifest estático (camada 1)', () => {
  const manifest = readJson('public/manifest.webmanifest');

  it('declara start_url e scope RELATIVOS: é o que faz um arquivo servir N tenants', () => {
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
  });

  it('OMITE id: ele resolve contra a origem, e "./" colapsaria todo tenant no mesmo app', () => {
    expect(manifest.id).toBeUndefined();
  });

  // ESTE arquivo é servido a todos os tenants ao mesmo tempo, então um ícone
  // aqui é, por definição, o de nenhum restaurante — e na prática era o nosso:
  // /assets/icons/pwa/ é o mark do Rapidex. Quem instalasse o app antes de a
  // API responder, ou com a logo do lojista fora do ar, ficava com o nosso pin
  // na tela inicial. O preço de não declarar ícone é o browser só oferecer a
  // instalação depois que o manifest do tenant entra, que é o que se quer.
  it('NÃO declara ícone: um arquivo só não tem como ter a marca de N lojas', () => {
    expect(manifest.icons).toBeUndefined();
  });

  it('não cita nenhum asset da plataforma', () => {
    expect(JSON.stringify(manifest)).not.toContain('/assets/');
  });
});

describe('manifest do tenant (camada 2)', () => {
  it('leva nome, cor e logo do restaurante', () => {
    const manifest = build({
      slug: 'junior-da-picanha',
      name: 'Júnior da Picanha',
      themeColor: '#8B1E1E',
      logoUrl: 'https://xyz.supabase.co/storage/logo.png'
    });

    expect(manifest.short_name).toBe('Júnior da Picanha');
    expect(manifest.name).toBe('Júnior da Picanha — Pedido Online');
    expect(manifest.theme_color).toBe('#8B1E1E');
    expect(manifest.icons[0].src).toBe('https://xyz.supabase.co/storage/logo.png');
  });

  it('declara o type do logo pela EXTENSÃO — declarar png num .webp descarta o ícone', () => {
    const icons = build({ slug: 'fuji', name: 'Fuji', logoUrl: 'https://xyz.supabase.co/logo.webp' }).icons;
    expect(icons[0].type).toBe('image/webp');
  });

  it('escopo, start_url e id são o diretório do tenant', () => {
    const manifest = build({ slug: 'fuji', name: 'Fuji' });

    expect(manifest.scope).toBe('https://rapidex.com/fuji/');
    expect(manifest.start_url).toBe('https://rapidex.com/fuji/');
    expect(manifest.id).toBe('https://rapidex.com/fuji/');
  });

  // O objeto vira um blob:, e blob: tem path OPACO — "/x" resolvido contra
  // "blob:https://origem/uuid" não devolve "https://origem/x". Uma URL relativa
  // aqui quebraria escopo e ícones de um jeito silencioso.
  it('emite TODA URL absoluta, porque a base vai ser um blob:', () => {
    const manifest = build({ slug: 'fuji', name: 'Fuji' });
    const urls = [manifest.id, manifest.start_url, manifest.scope, ...manifest.icons.map(i => i.src)];

    // A propriedade é "não precisa de base para resolver", não "começa com
    // http": os ícones da marca gerada são data:, que já carrega o desenho
    // inteiro dentro de si e por isso é imune à base opaca do blob.
    for (const url of urls) expect(() => new URL(url)).not.toThrow();
    for (const url of urls) expect(url).toMatch(/^(https?|data):/);
  });

  it('o id bate com o start_url do manifest estático — trocar de camada não vira outro app', () => {
    const staticId = new URL('./', `${ORIGIN}/fuji/manifest.webmanifest`).href;
    expect(build({ slug: 'fuji', name: 'Fuji' }).id).toBe(staticId);
  });

  // Este teste afirmava o CONTRÁRIO — que os ícones da plataforma ficavam na
  // lista mesmo com logo do tenant, porque eram eles os 192/512 exigidos para a
  // instalação. Era verdade, e era o vazamento: o app instalado de uma loja cuja
  // logo não carregasse nascia com o pin do Rapidex. Quem cumpre o papel agora é
  // a marca gerada com as iniciais da loja.
  it('NENHUM ícone da plataforma entra no manifest do tenant', () => {
    for (const logoUrl of ['https://xyz.supabase.co/storage/logo.png', '', undefined]) {
      const manifest = build({ slug: 'fuji', name: 'Fuji', logoUrl });
      expect(JSON.stringify(manifest.icons)).not.toContain('/assets/');
      expect(JSON.stringify(manifest.icons)).not.toMatch(/rapidex|pedeaqui/i);
    }
  });

  it('continua entregando os tamanhos que o browser exige, agora com a marca da loja', () => {
    const manifest = build({ slug: 'fuji', name: 'Fuji' });
    const sizes = manifest.icons.map(icon => icon.sizes);

    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some(icon => icon.purpose === 'maskable')).toBe(true);
  });

  // Sem logo cadastrada, a reserva é a loja — iniciais na cor dela.
  it('sem logo, o ícone é a marca gerada do tenant, não a nossa', () => {
    const icons = build({ slug: 'fuji', name: 'Fuji Sushi', themeColor: '#0F6E4F' }).icons;

    expect(icons.every(icon => icon.src.startsWith('data:image/svg+xml,'))).toBe(true);
    const svg = decodeURIComponent(icons[0].src.replace('data:image/svg+xml,', ''));
    expect(svg).toContain('>FS<');
    expect(svg).toContain('#0F6E4F');
  });

  it('cor inválida do lojista cai na cor da PLATAFORMA, nunca em cor de outro tenant', () => {
    expect(build({ slug: 'fuji', name: 'Fuji', themeColor: 'roxo' }).theme_color)
      .toBe(window.RapidexPWA.PLATFORM_THEME);
  });

  it('sem nome, não vaza nome nenhum — nem de restaurante, nem da plataforma', () => {
    // O fallback serve TODOS os tenants ao mesmo tempo, então ele não tem como
    // saber de qual loja é. Era o nome da plataforma; num app white-label isso
    // é o único nome que ele com certeza não pode usar.
    const manifest = build({ slug: 'fuji' });
    expect(manifest.short_name).toBe('Pedido Online');
    expect(manifest.name).toBe('Pedido Online');
    expect(`${manifest.name} ${manifest.short_name}`).not.toMatch(/rapi/i);
  });

  it('em subdomínio o escopo é a raiz da origem do tenant', () => {
    const manifest = buildTenantManifest({
      origin: 'https://fuji.rapidex.com',
      slug: 'fuji',
      topology: 'subdomain',
      name: 'Fuji'
    });
    expect(manifest.scope).toBe('https://fuji.rapidex.com/');
  });
});

// O manifest só entrega escopo por tenant se a rota do diretório existir. Sem
// estas rotas o start_url /<slug>/ dá 404 e o app instalado abre numa tela de
// erro — falha que só apareceria em produção, depois do deploy.
describe('rotas que o manifest por tenant exige da vercel.json', () => {
  const rewrites = readJson('vercel.json').rewrites;
  const has = (source) => rewrites.some(rule => rule.source === source);
  const SLUG_PATTERN = '[a-z0-9]+(?:-[a-z0-9]+)*';

  it('o diretório do tenant (com barra final) resolve', () => {
    expect(has(`/:slug(${SLUG_PATTERN})/`)).toBe(true);
  });

  it('/<slug>/manifest.webmanifest serve o arquivo único da raiz', () => {
    const rule = rewrites.find(r => r.source === `/:slug(${SLUG_PATTERN})/manifest.webmanifest`);
    expect(rule).toBeTruthy();
    expect(rule.destination).toBe('/manifest.webmanifest');
  });

  it('a CSP libera o blob do manifest de runtime', () => {
    const csp = readJson('vercel.json').headers[0].headers
      .find(h => h.key === 'Content-Security-Policy').value;
    const manifestSrc = csp.split(';').map(s => s.trim()).find(s => s.startsWith('manifest-src'));

    expect(manifestSrc, 'sem manifest-src, o browser recusa o blob e o link quebra').toBeTruthy();
    expect(manifestSrc).toContain('blob:');
  });
});
