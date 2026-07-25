// Gera as versões WebP/AVIF dos assets de marca a partir dos PNGs originais.
//
// POR QUÊ: os PNGs foram commitados no tamanho em que saíram do design, não no
// tamanho em que a tela usa. O mascote é 1254x1254 (1,0 MB) para ser desenhado
// num quadrado de 110px — 130x mais pixels do que a maior tela precisa. O logo
// da landing é 634x640 (143 kB) para 34px. Isso é banda paga por pixel que o
// usuário nunca vê.
//
// COMO: cada entrada declara o tamanho de RENDERIZAÇÃO real (lido do CSS, com o
// seletor anotado ao lado para que a conta continue auditável) e o script emite
// 1x/2x/3x a partir dele. A grade de DPR sai do CSS, não de um chute.
//
// Este script NÃO roda no build. Os arquivos gerados são commitados, então o
// projeto não ganha nenhuma dependência de build por causa disto. Rode à mão só
// quando um PNG de origem mudar:
//
//   npm i sharp --no-save && node tools/optimize-images.mjs
//
// `sharp` é instalado com --no-save de propósito: ele traz binários por
// plataforma e entraria no package-lock com deps opcionais por SO, que é
// exatamente a classe de problema que já custou três commits de conserto de
// lockfile neste repo.

import sharp from 'sharp';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

// rendered = lado em CSS px que o elemento realmente ocupa (maior caso).
const ASSETS = [
  {
    src: 'assets/brand/rapi-mascot.png',
    rendered: 110, // .rapi-orb-img — styles/rapi.css:1220
    formats: ['webp']
  },
  {
    src: 'assets/brand/pedeaqui-logo.png',
    rendered: 34, // .logo-img — styles/landing.css:27
    formats: ['webp']
  },
  {
    src: 'assets/brand/rapi-nav-avatar.png',
    rendered: 52, // .menu-mobile-rapi-avatar — styles/rapi.css:1030
    formats: ['webp']
  },
  {
    src: 'assets/icons/cart/cart-location-customer.png',
    rendered: 62, // #cartModal .cart-location-map — styles/restaurant.css:125
    formats: ['webp']
  },
  {
    src: 'assets/icons/cart/cart-location-guest.png',
    rendered: 62,
    formats: ['webp']
  }
];

const DPRS = [1, 2, 3];

// Qualidade por formato. 72 é o ponto em que, num alvo de 110px ou menos, a
// diferença deixa de ser visível — o mascote é arte chapada, não foto.
//
// Só WebP: o AVIF equivalente ficou 1,3 kB menor no mascote (3,5 vs 4,8 kB) e
// custaria um <picture> com dois <source> em cada ponto de uso. Num asset que
// já caiu de 1,0 MB para 4,8 kB, essa troca não se paga. O QUALITY é um mapa
// por formato para que voltar atrás seja só acrescentar 'avif' aos formats.
const QUALITY = { webp: 72, avif: 50 };

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

async function main() {
  const rows = [];

  for (const asset of ASSETS) {
    const input = await readFile(asset.src);
    const meta = await sharp(input).metadata();
    const before = (await stat(asset.src)).size;
    const stem = basename(asset.src, '.png');
    const dir = dirname(asset.src);

    let after = 0;
    const generated = [];

    for (const format of asset.formats) {
      for (const dpr of DPRS) {
        const width = asset.rendered * dpr;
        // Nunca upscale: se a origem é menor que o alvo, para na origem.
        if (width > meta.width) continue;

        const out = join(dir, `${stem}@${dpr}x.${format}`);
        const buffer = await sharp(input)
          // `inside` preserva o aspecto da origem. Não é detalhe: o logo é
          // 634x640 (não é quadrado) e o CSS o desenha com object-fit:contain,
          // então recortar para um quadrado aqui mudaria o enquadramento que
          // está no ar. Mantendo o aspecto, o object-fit do CSS continua
          // recebendo exatamente a mesma imagem que recebia do PNG.
          .resize({ width, fit: 'inside', withoutEnlargement: true })
          .toFormat(format, { quality: QUALITY[format] })
          .toBuffer();

        await writeFile(out, buffer);
        generated.push({ out, width, bytes: buffer.length });
        // O "depois" que importa é o que UM usuário baixa, não a soma de todas
        // as variantes: o browser escolhe uma. Usamos a maior (3x) como teto.
        after = Math.max(after, buffer.length);
      }
    }

    rows.push({
      src: asset.src,
      source: `${meta.width}x${meta.height}`,
      rendered: `${asset.rendered}px`,
      before,
      after,
      generated
    });
  }

  console.log('\nAsset                                    origem      usa    antes ->   depois   corte');
  console.log('-'.repeat(92));
  let totalBefore = 0;
  let totalAfter = 0;
  for (const row of rows) {
    totalBefore += row.before;
    totalAfter += row.after;
    const cut = `${(100 - (row.after / row.before) * 100).toFixed(0)}%`;
    console.log(
      `${row.src.padEnd(40)} ${row.source.padStart(9)} ${row.rendered.padStart(6)} ` +
        `${kb(row.before).padStart(8)} -> ${kb(row.after).padStart(8)} ${cut.padStart(6)}`
    );
    for (const g of row.generated) {
      console.log(`    ${basename(g.out).padEnd(36)} ${String(g.width + 'px').padStart(6)}  ${kb(g.bytes).padStart(8)}`);
    }
  }
  console.log('-'.repeat(92));
  console.log(
    `${'TOTAL (pior caso por usuário, 3x)'.padEnd(40)} ${''.padStart(16)} ` +
      `${kb(totalBefore).padStart(8)} -> ${kb(totalAfter).padStart(8)} ` +
      `${(100 - (totalAfter / totalBefore) * 100).toFixed(0)}%`.padStart(7)
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
