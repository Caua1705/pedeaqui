// Gera os ícones do manifest a partir do mark da PLATAFORMA.
//
// POR QUÊ: o manifest precisa de PNGs quadrados em 192 e 512 px. O único mark
// que existe no repo é assets/brand/pedeaqui-logo.png (634x640) — quase
// quadrado, mas não exatamente, e o manifest exige `sizes` exatos.
//
// São TRÊS saídas, não duas:
//   - 192 e 512 `purpose: any`      -> fundo transparente, arte inteira visível
//   - 512 `purpose: maskable`       -> a arte recuada para 60% dentro de um
//     quadrado chapado, porque o Android recorta o ícone num círculo/squircle e
//     comeria as pontas do pin se a arte fosse até a borda.
//
// Estes são os ícones da PLATAFORMA. O ícone do TENANT é o logo que a API
// devolve (logo_url), montado em runtime — ver scripts/utils/pwa.js. Aqui só
// mora o fallback: tenant sem logo, ou manifest servido antes da API responder.
//
// Como o tools/optimize-images.mjs, este script NÃO roda no build. A saída é
// commitada; rode à mão só quando o mark mudar:
//
//   npm i sharp --no-save && node tools/generate-pwa-icons.mjs

import sharp from 'sharp';
import { writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const SOURCE = 'assets/brand/pedeaqui-logo.png';
const OUT_DIR = 'public/assets/icons/pwa';

// O mark de origem NÃO tem alfa: ele é o pin laranja sobre um quadrado PRETO
// chapado (conferido pixel a pixel — o canto é opaco). Então o fundo do ícone
// não é uma escolha de design nova, é o fundo que o asset já tem; usar o laranja
// da marca aqui produziria um quadrado preto flutuando dentro de um quadrado
// laranja. Se um dia o mark ganhar fundo transparente, esta constante é o único
// lugar a mudar.
const MARK_BACKGROUND = '#000000';

// Fração do lado ocupada pela arte dentro do maskable. A "safe zone" do
// Android é um círculo de 80% do lado; 60% deixa o pin inteiro dentro dela com
// folga, inclusive nas máscaras mais agressivas.
const MASKABLE_ART_RATIO = 0.6;

async function writeIcon(name, buffer) {
  const path = join(OUT_DIR, name);
  await writeFile(path, buffer);
  const { size } = await stat(path);
  console.log(`${path.padEnd(44)} ${(size / 1024).toFixed(1)} kB`);
}

// A arte é chapada (duas cores + antialias), então a paleta indexada de 8 bits
// a reproduz sem perda visível e corta o arquivo em ~4x. Sem isso o ícone de
// 512 sai com 106 kB — peso de foto para um pin vetorial.
const PNG_OPTIONS = { compressionLevel: 9, palette: true, effort: 10 };

// `contain`, nunca `fill`: o mark é 634x640, então esticá-lo para um quadrado o
// deformaria. Encaixar preserva a proporção, centraliza e completa as sobras
// com a mesma cor de fundo do próprio mark.
function square(size) {
  return sharp(SOURCE)
    .extract(SOURCE_ART)
    .resize(size, size, { fit: 'contain', background: MARK_BACKGROUND })
    .png(PNG_OPTIONS);
}

// As duas primeiras linhas do PNG de origem são BRANCAS — sobra de digitalização.
// A 34px (o uso na landing) ninguém vê; a 512 vira um risco branco atravessando
// o topo do ícone. Recortadas aqui, não no asset, para não mexer nas variantes
// que o tools/optimize-images.mjs já gerou e commitou.
const SOURCE_ART = { left: 0, top: 2, width: 634, height: 638 };

await mkdir(OUT_DIR, { recursive: true });

await writeIcon('rapidex-192.png', await square(192).toBuffer());
await writeIcon('rapidex-512.png', await square(512).toBuffer());

// O maskable é o MESMO desenho recuado: a arte encolhe para 60% e o fundo se
// estende até a borda, então qualquer máscara do Android corta só fundo.
const art = await square(Math.round(512 * MASKABLE_ART_RATIO)).toBuffer();
await writeIcon(
  'rapidex-maskable-512.png',
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: MARK_BACKGROUND }
  })
    .composite([{ input: art, gravity: 'center' }])
    .png(PNG_OPTIONS)
    .toBuffer()
);
