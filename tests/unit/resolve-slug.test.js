import { describe, it, expect } from 'vitest';

// Publishes window.RapidexTenant (tenant/slug resolution).
import '../../scripts/utils/restaurant-slug.js';

const { resolveSlugFrom } = window.RapidexTenant;

const ROOTS = ['rapidex.com', 'pederapidex.com'];
const at = (parts) => resolveSlugFrom({ ...parts, rootDomains: ROOTS });

describe('resolveSlug — path (topologia padrão)', () => {
  it('lê rapidex.com/<slug>', () => {
    expect(at({ hostname: 'rapidex.com', pathname: '/junior-da-picanha' })).toBe('junior-da-picanha');
  });

  it('mantém os formatos antigos /r/<slug> e /restaurantes/<slug>', () => {
    expect(at({ hostname: 'rapidex.com', pathname: '/r/fuji' })).toBe('fuji');
    expect(at({ hostname: 'rapidex.com', pathname: '/restaurantes/fuji' })).toBe('fuji');
  });

  it('lê o ?slug= que o rewrite do Vercel entrega', () => {
    expect(at({ hostname: 'rapidex.com', pathname: '/restaurant.html', search: '?slug=fuji' })).toBe('fuji');
  });

  it('ignora o arquivo servido e os diretórios estáticos', () => {
    expect(at({ hostname: 'rapidex.com', pathname: '/restaurant.html' })).toBe('');
    expect(at({ hostname: 'rapidex.com', pathname: '/assets/brand/logo.png' })).toBe('');
  });
});

describe('resolveSlug — subdomínio wildcard', () => {
  it('lê <slug>.rapidex.com', () => {
    expect(at({ hostname: 'junior-da-picanha.rapidex.com', pathname: '/' })).toBe('junior-da-picanha');
  });

  it('tem precedência sobre query e path', () => {
    expect(at({
      hostname: 'fuji.rapidex.com',
      pathname: '/junior-da-picanha',
      search: '?slug=junior-da-picanha'
    })).toBe('fuji');
  });

  it('não trata o apex nem www como tenant', () => {
    expect(at({ hostname: 'rapidex.com', pathname: '/' })).toBe('');
    expect(at({ hostname: 'www.rapidex.com', pathname: '/' })).toBe('');
  });

  it('não trata subdomínios da plataforma como tenant', () => {
    expect(at({ hostname: 'api.rapidex.com', pathname: '/' })).toBe('');
    expect(at({ hostname: 'admin.rapidex.com', pathname: '/' })).toBe('');
  });

  it('ignora hosts fora do domínio-raiz (preview do Vercel, localhost, IP)', () => {
    expect(at({ hostname: 'preview-abc123.vercel.app', pathname: '/' })).toBe('');
    expect(at({ hostname: 'localhost', pathname: '/' })).toBe('');
    expect(at({ hostname: '127.0.0.1', pathname: '/' })).toBe('');
    // ...mas o path continua valendo nesses hosts.
    expect(at({ hostname: 'localhost', pathname: '/fuji' })).toBe('fuji');
  });

  it('não aceita subdomínio aninhado', () => {
    expect(at({ hostname: 'a.b.rapidex.com', pathname: '/' })).toBe('');
  });
});

describe('resolveSlug — nunca inventa um tenant', () => {
  it('devolve string vazia quando não há slug em lugar nenhum', () => {
    expect(at({ hostname: 'rapidex.com', pathname: '/', search: '' })).toBe('');
  });

  it('rejeita slug malformado em vez de aceitá-lo', () => {
    expect(at({ hostname: 'rapidex.com', search: '?slug=Júnior Da Picanha' })).toBe('');
    expect(at({ hostname: 'rapidex.com', search: '?slug=-fuji-' })).toBe('');
    expect(at({ hostname: 'rapidex.com', search: '?slug=../../etc/passwd' })).toBe('');
  });

  it('normaliza caixa alta para o formato canônico', () => {
    expect(at({ hostname: 'rapidex.com', pathname: '/FUJI' })).toBe('fuji');
  });
});
