// Deriva variantes menores das imagens de catálogo servidas pelo Supabase.
//
// POR QUÊ: as fotos de produto vêm no tamanho em que o lojista subiu — um
// arroz-branco.webp de 88 kB — e a grade do cardápio desenha cada uma num
// quadrado de 110px. Num cardápio de dezenas de itens isso é alguns MB de
// fotos que a tela reduz a miniatura. O Supabase Storage já expõe as derivadas:
// o mesmo objeto sob /render/image/public/ com ?width=. Medido no bucket deste
// projeto, o mesmo arroz-branco sai a 10,7 kB em 160px e 15,7 kB em 240px.
//
// COMO: só reescreve URLs que são reconhecidamente do Supabase Storage e estão
// na forma /object/public/. Qualquer outra coisa (outro CDN, caminho relativo,
// data:) volta intacta — em caso de dúvida a URL original é servida, que é o
// comportamento de hoje.
//
// O `src` continua apontando para o ORIGINAL de propósito: se a transformação
// falhar ou o plano do Storage mudar, o browser ainda tem uma URL boa em src, e
// nada no cardápio fica sem foto.
(function () {
  'use strict';

  const OBJECT_SEGMENT = '/storage/v1/object/public/';
  const RENDER_SEGMENT = '/storage/v1/render/image/public/';
  const DEFAULT_QUALITY = 72;

  function isSupabaseObjectUrl(url) {
    return (
      typeof url === 'string' &&
      url.includes('.supabase.co') &&
      url.includes(OBJECT_SEGMENT)
    );
  }

  // Devolve a URL da derivada com `width`, ou null se a origem não for
  // transformável — null é o sinal de "não mexe, usa o original".
  function variant(url, width, quality = DEFAULT_QUALITY) {
    if (!isSupabaseObjectUrl(url)) return null;
    if (!Number.isFinite(width) || width <= 0) return null;

    const rendered = url.replace(OBJECT_SEGMENT, RENDER_SEGMENT);
    // O objeto pode já vir com query (?t=..., token de cache). Preserva.
    const separator = rendered.includes('?') ? '&' : '?';
    return `${rendered}${separator}width=${Math.round(width)}&quality=${quality}`;
  }

  // Descritores `x`, para caixas de tamanho FIXO em CSS (a miniatura de 110px
  // do cardápio, a de 48px do carrinho). Com o lado conhecido, o DPR é a única
  // variável, e `x` evita ter que declarar um `sizes` que repetiria o CSS.
  function srcsetByDpr(url, cssWidth, dprs = [1, 2, 3], quality = DEFAULT_QUALITY) {
    if (!isSupabaseObjectUrl(url)) return '';
    const parts = [];
    for (const dpr of dprs) {
      const derived = variant(url, cssWidth * dpr, quality);
      if (derived) parts.push(`${derived} ${dpr}x`);
    }
    return parts.join(', ');
  }

  // Descritores `w`, para caixas FLUIDAS (o herói do modal de produto, que
  // ocupa 100vw no celular). Exige um `sizes` no elemento.
  function srcsetByWidth(url, widths, quality = DEFAULT_QUALITY) {
    if (!isSupabaseObjectUrl(url)) return '';
    const parts = [];
    for (const width of widths) {
      const derived = variant(url, width, quality);
      if (derived) parts.push(`${derived} ${width}w`);
    }
    return parts.join(', ');
  }

  window.RapidexImageCdn = { isSupabaseObjectUrl, variant, srcsetByDpr, srcsetByWidth };
})();
