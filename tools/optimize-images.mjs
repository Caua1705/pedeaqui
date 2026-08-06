// Gera as versões WebP/AVIF dos assets de marca a partir dos PNGs originais.
//
// POR QUÊ: os PNGs foram commitados no tamanho em que saíram do design, não no
// tamanho em que a tela usa. O mascote é 1254x1254 (1,0 MB) para ser desenhado
// num quadrado de 110px — 130x mais pixels do que a maior tela precisa. O logo
// mestre também é muito maior que os 34px usados na landing. Isso é banda paga
// por pixel que o usuário nunca vê.
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
//
// `cutout` recorta o fundo chapado do master (ver cutoutFlatBackground abaixo).
// Só os dois masters do mascote precisam: ambos chegaram do render em RGB, sem
// canal alfa, com o mascote achatado sobre branco + sombra.
const ASSETS = [
  {
    src: 'assets/brand/rapi-mascot.png',
    rendered: 110, // .rapi-orb-img — styles/rapi.css:1220
    formats: ['webp'],
    // step 1 num master de 1254px: a rampa do fundo é suave o bastante para o
    // flood andar de 1 em 1, e é isso que impede o vazamento para dentro do
    // gorro branco, que quase encosta no branco do fundo.
    cutout: { step: 1, repair: 5 }
  },
  {
    src: 'assets/brand/pedeaqui-logo.png',
    rendered: 34, // .logo-img — styles/landing.css:27
    formats: ['webp']
  },
  {
    src: 'assets/brand/rapi-nav-avatar.png',
    rendered: 52, // .menu-mobile-rapi-avatar — styles/rapi.css:1030
    formats: ['webp'],
    // Mesma arte em 256px: o mesmo degradê de sombra cai em 5x menos pixels,
    // então cada passo é mais íngreme e o flood precisa de mais tolerância.
    cutout: { step: 3, repair: 3 }
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
  },
  {
    // Ilustração da cobrança Pix. O master já vem com o ícone do Pix composto
    // na tela do aparelho e com alfa de verdade — a arte de origem chegou em
    // JPEG, com o xadrez de transparência achatado dentro da imagem.
    //
    // 170 e não 185: a caixa do CSS é 185.31x181.74 com object-fit:contain e a
    // arte é mais alta que larga (728x780), então quem limita é a ALTURA —
    // 181.74 x (728/780) = 169.6 de largura desenhada.
    src: 'assets/icons/payment/pix-awaiting-payment.png',
    rendered: 170, // .pix-art — styles/pix.css:205
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

/**
 * Devolve o master com alfa de verdade, recortando o fundo chapado.
 *
 * POR QUÊ: os PNGs do mascote são RGB puro (color type 2, sem canal alfa) — o
 * render saiu achatado sobre branco, com sombra. Sobre a tela branca do Rapi
 * isso aparece como um quadrado atrás do mascote: o fundo da arte é #FEFEFE e a
 * sombra desce até ~#DC, nenhum dos dois é o #FFF da página.
 *
 * COMO: flood fill a partir da borda com tolerância POR PASSO, não absoluta. Um
 * limiar absoluto ("tudo acima de #FA é fundo") não serve aqui, porque o gorro
 * branco é tão claro quanto o fundo e a sombra é bem mais escura que ele — o
 * mesmo número não consegue separar os dois casos. Já o passo separa: fundo e
 * sombra variam ~1 nível por pixel, enquanto a silhueta do mascote é um degrau
 * de 15+ níveis. Por isso a sombra sai junto e o gorro fica.
 *
 * As duas guardas de cor (neutro e não escuro demais) existem só para o flood
 * nunca escorregar para dentro da arte por um corredor de pixels quase neutros.
 */
async function cutoutFlatBackground(input, { step, repair }) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const isBackground = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const MAX_CHROMA = 6; // fundo e sombra são neutros; a arte é quente ou colorida
  const MIN_LEVEL = 60; // nada realmente escuro é fundo nestes masters

  const neutral = (i) => {
    const max = Math.max(data[i], data[i + 1], data[i + 2]);
    const min = Math.min(data[i], data[i + 1], data[i + 2]);
    return max - min <= MAX_CHROMA && max >= MIN_LEVEL;
  };

  const seed = (x, y) => {
    const pixel = y * width + x;
    if (isBackground[pixel] || !neutral(pixel * channels)) return;
    isBackground[pixel] = 1;
    queue[tail++] = pixel;
  };

  for (let x = 0; x < width; x += 1) { seed(x, 0); seed(x, height - 1); }
  for (let y = 0; y < height; y += 1) { seed(0, y); seed(width - 1, y); }

  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % width;
    const y = (pixel - x) / width;
    const i = pixel * channels;
    const visit = (nx, ny) => {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
      const next = ny * width + nx;
      if (isBackground[next]) return;
      const ni = next * channels;
      if (Math.abs(data[ni] - data[i]) > step) return;
      if (Math.abs(data[ni + 1] - data[i + 1]) > step) return;
      if (Math.abs(data[ni + 2] - data[i + 2]) > step) return;
      if (!neutral(ni)) return;
      isBackground[next] = 1;
      queue[tail++] = next;
    };
    visit(x - 1, y); visit(x + 1, y); visit(x, y - 1); visit(x, y + 1);
  }

  const mask = Buffer.alloc(width * height);
  for (let pixel = 0; pixel < width * height; pixel += 1) mask[pixel] = isBackground[pixel] ? 0 : 255;

  // A máscara sai dura e com falhas finas: mediana fecha fresta e cospe respingo,
  // o desfoque devolve a borda macia e o ganho encolhe a silhueta ~1px, que é o
  // que come a franja branca do antialias do master.
  const alpha = await sharp(mask, { raw: { width, height, channels: 1 } })
    .median(repair)
    .blur(1.1)
    .linear(1.9, -115)
    .toColourspace('b-w')
    .raw()
    .toBuffer();

  for (let pixel = 0; pixel < width * height; pixel += 1) data[pixel * channels + 3] = alpha[pixel];

  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

async function main() {
  const rows = [];

  for (const asset of ASSETS) {
    const original = await readFile(asset.src);
    // O recorte roda UMA vez, no master, e alimenta as três DPRs: refazer o
    // flood a cada variante custaria três varreduras de 1,5 M de pixels.
    const input = asset.cutout ? await cutoutFlatBackground(original, asset.cutout) : original;
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
