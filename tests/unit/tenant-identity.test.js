import { describe, it, expect } from 'vitest';

// onBrandColor() e normalizeHex() vêm daqui: a letra da marca gerada usa a MESMA
// guarda de contraste dos botões da loja.
import '../../scripts/utils/brand-theme.js';
import '../../scripts/utils/tenant-identity.js';

const {
  initialsFor,
  brandMarkSvg,
  brandMarkDataUri,
  iconTypeFor,
  remoteLogo,
  tenantIcons
} = window.RapidexTenantIdentity;

const LOGO = 'https://mqanpwnrjjqcswzhcplc.supabase.co/storage/v1/object/public/junior/logo.webp';

// A propriedade que vale para o arquivo inteiro: nenhuma saída pode conter a
// marca da plataforma, em nenhum caminho de degradação.
const semPlataforma = (valor) => {
  const texto = typeof valor === 'string' ? valor : JSON.stringify(valor);
  expect(texto).not.toMatch(/rapidex|pedeaqui/i);
  expect(texto).not.toContain('/assets/');
};

describe('iniciais', () => {
  it('pega a primeira letra das duas primeiras palavras', () => {
    expect(initialsFor('Júnior da Picanha')).toBe('JD');
    expect(initialsFor('Fuji')).toBe('F');
  });

  // Era `name || 'Rapidex'`: sem nome, todo placeholder do app — logo, avatar da
  // sacola, foto de produto — escrevia "RA". O nome da plataforma dentro do app
  // de um restaurante, no lugar exato reservado à marca dele.
  it('sem nome NÃO inventa iniciais, e muito menos as nossas', () => {
    for (const value of ['', '   ', null, undefined]) {
      expect(initialsFor(value)).toBe('');
    }
  });

  it('acentos e nomes de uma letra não quebram', () => {
    expect(initialsFor('Ólio Ébano')).toBe('ÓÉ');
    expect(initialsFor('  espaço   duplo ')).toBe('ED');
  });
});

describe('marca gerada', () => {
  it('desenha as iniciais da loja sobre a cor da loja', () => {
    const svg = brandMarkSvg({ name: 'Fuji Sushi', primaryColor: '#0F6E4F' });

    expect(svg).toContain('>FS<');
    expect(svg).toContain('fill="#0F6E4F"');
    semPlataforma(svg);
  });

  // Sem width/height o Firefox se recusa a rasterizar um SVG carregado como
  // imagem — que é o que acontece quando este desenho vira favicon ou ícone de
  // manifest. O sintoma seria um ícone em branco, só nesse browser.
  it('declara width e height, não só viewBox', () => {
    const svg = brandMarkSvg({ name: 'Fuji', primaryColor: '#0F6E4F' });
    expect(svg).toMatch(/<svg[^>]*width="512"[^>]*height="512"/);
  });

  // A mesma guarda dos botões: branco enquanto for legível, tinta escura quando
  // a marca for clara demais para sustentá-lo. Sem isso, uma loja de marca
  // amarela ganharia um ícone com letra branca invisível.
  it('a cor da letra respeita o contraste mínimo sobre a marca', () => {
    const contraste = (a, b) => window.RapidexTheme.contrastRatio(a, b);
    const corDaLetra = (hex) => brandMarkSvg({ name: 'Fuji', primaryColor: hex }).match(/fill="(#[0-9A-F]{6})">/)[1];

    for (const marca of ['#FFD34D', '#0F6E4F', '#111111', '#D95C04', '#CFFF04']) {
      expect(contraste(corDaLetra(marca), marca)).toBeGreaterThanOrEqual(window.RapidexTheme.ON_BRAND_MIN_CONTRAST);
    }
  });

  it('sem nome, sai o quadrado da loja sem texto — nunca uma letra emprestada', () => {
    const svg = brandMarkSvg({ name: '', primaryColor: '#0F6E4F' });

    expect(svg).not.toContain('<text');
    expect(svg).toContain('fill="#0F6E4F"');
    semPlataforma(svg);
  });

  // O Android recorta o ícone num círculo/squircle. O fundo tem que ir até a
  // borda (sem canto arredondado) e a letra tem que caber na "safe zone".
  it('a variante maskable é chapada até a borda e com letra menor', () => {
    const comum = brandMarkSvg({ name: 'Fuji', primaryColor: '#0F6E4F' });
    const maskable = brandMarkSvg({ name: 'Fuji', primaryColor: '#0F6E4F', maskable: true });

    expect(maskable).toContain('rx="0"');
    expect(comum).not.toContain('rx="0"');

    const tamanho = (svg) => Number(svg.match(/font-size="([\d.]+)"/)[1]);
    expect(tamanho(maskable)).toBeLessThan(tamanho(comum));
  });

  // "#" num data: cru encerra a URL: o ícone chegaria ao browser sem cor e sem
  // metade do desenho.
  it('o data: URI sobrevive ao "#" das cores', () => {
    const uri = brandMarkDataUri({ name: 'Fuji', primaryColor: '#0F6E4F' });

    expect(uri.startsWith('data:image/svg+xml,')).toBe(true);
    expect(uri).not.toContain('#');
    expect(decodeURIComponent(uri.replace('data:image/svg+xml,', ''))).toContain('#0F6E4F');
  });

  // O nome vem da API e é escrito num atributo/nó de texto XML.
  it('escapa o nome antes de escrevê-lo no XML', () => {
    expect(brandMarkSvg({ name: '<script>x</script> &', primaryColor: '#0F6E4F' })).not.toContain('<script');
  });
});

describe('tipo do ícone', () => {
  // Era fixo em image/png. O piloto cadastrou um .webp, então o manifest
  // afirmava um tipo que o arquivo não tem — e o browser DESCARTA ícone cujo
  // `type` declarado ele não suporta.
  it('sai da extensão da URL', () => {
    expect(iconTypeFor('https://x.co/logo.webp')).toBe('image/webp');
    expect(iconTypeFor('https://x.co/logo.png')).toBe('image/png');
    expect(iconTypeFor('https://x.co/logo.PNG?v=2')).toBe('image/png');
    expect(iconTypeFor('https://x.co/logo.svg#a')).toBe('image/svg+xml');
  });

  it('sem extensão reconhecida, omite em vez de mentir', () => {
    expect(iconTypeFor('https://x.co/logo')).toBeNull();
    expect(iconTypeFor('')).toBeNull();
  });
});

describe('logo remota', () => {
  it('aceita http(s) absoluto', () => {
    expect(remoteLogo(LOGO)).toBe(LOGO);
  });

  it('descarta o que não é URL utilizável', () => {
    // logo_path do contrato é caminho de bucket, não URL: ele chega aqui e cai
    // fora, o que é certo — quem entra no lugar dele é a marca gerada.
    for (const value of ['', null, undefined, 'junior/brand/logo.webp', '/assets/logo.png', 'javascript:alert(1)']) {
      expect(remoteLogo(value)).toBeNull();
    }
  });
});

describe('lista de ícones do manifest', () => {
  it('a logo do lojista vem primeiro, com sizes "any"', () => {
    const icons = tenantIcons({ name: 'Júnior da Picanha', logoUrl: LOGO, primaryColor: '#D95C04' });

    expect(icons[0].src).toBe(LOGO);
    expect(icons[0].sizes).toBe('any');
    expect(icons[0].type).toBe('image/webp');
  });

  // Os 192/512 e o maskable eram os PNGs da plataforma. Agora são a marca da
  // loja — inclusive quando ela TEM logo, porque é essa a reserva de quando o
  // arquivo remoto não carrega.
  it('cobre os tamanhos exigidos sem um pixel da plataforma, com ou sem logo', () => {
    for (const logoUrl of [LOGO, '', undefined]) {
      const icons = tenantIcons({ name: 'Fuji', logoUrl, primaryColor: '#0F6E4F' });
      const sizes = icons.map(icon => icon.sizes);

      expect(sizes).toContain('192x192');
      expect(sizes).toContain('512x512');
      expect(icons.some(icon => icon.purpose === 'maskable')).toBe(true);
      semPlataforma(icons);
    }
  });

  it('sem logo, TODA entrada é a marca gerada da loja', () => {
    const icons = tenantIcons({ name: 'Fuji Sushi', primaryColor: '#0F6E4F' });

    expect(icons.every(icon => icon.src.startsWith('data:image/svg+xml,'))).toBe(true);
    for (const icon of icons) {
      expect(decodeURIComponent(icon.src)).toContain('#0F6E4F');
    }
  });
});
