import { describe, it, expect, beforeAll } from 'vitest';

// O QR do Pix é gerado no cliente (ver o cabeçalho de scripts/utils/qrcode.js:
// sem dependência de runtime, e a CSP proíbe imagem de terceiro). Um QR errado
// falha de um jeito silencioso e caro — o cliente escaneia, o app do banco não
// lê ou lê OUTRO valor —, então o que este arquivo trava é o conteúdo dos bits,
// não só o formato do SVG.
//
// A matriz de referência no fim do arquivo NÃO foi produzida por este código:
// veio de uma implementação independente (pacote npm `qrcode`), com o mesmo
// payload, modo byte e nível M. É ela que faz o teste ser uma verificação e não
// um espelho.

let qr;

beforeAll(async () => {
  await import('../../scripts/utils/qrcode.js');
  qr = window.RapidexQrCode;
});

// Payload EMV de Pix (copia-e-cola), no formato que POST .../payment devolve.
const PIX_PAYLOAD =
  '00020126580014BR.GOV.BCB.PIX0136123e4567-e12b-12d1-a456-42665544000052040000530398654041.005802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D';

describe('capacidades das tabelas da norma', () => {
  // Um erro de digitação numa das quatro tabelas de blocos/ECC não quebra nada
  // visivelmente: o QR sai bem-formado e ilegível. Estas capacidades são
  // derivadas das tabelas, então conferi-las cobre as tabelas inteiras.
  const PUBLISHED = {
    1: { L: 17, M: 14, Q: 11, H: 7 },
    2: { L: 32, M: 26, Q: 20, H: 14 },
    3: { L: 53, M: 42, Q: 32, H: 24 },
    10: { L: 271, M: 213, Q: 151, H: 119 },
    25: { L: 1273, M: 997, Q: 715, H: 535 },
    40: { L: 2953, M: 2331, Q: 1663, H: 1273 }
  };

  for (const [version, byLevel] of Object.entries(PUBLISHED)) {
    for (const [level, capacity] of Object.entries(byLevel)) {
      it(`versão ${version} nível ${level} comporta ${capacity} bytes`, () => {
        expect(qr.byteCapacity(Number(version), level)).toBe(capacity);
      });
    }
  }
});

describe('encode', () => {
  it('reproduz, módulo a módulo, o QR de uma implementação independente', () => {
    const { size, version, mask, modules } = qr.encode(PIX_PAYLOAD, { ecc: 'M' });

    expect({ size, version, mask }).toEqual({ size: 49, version: 8, mask: 2 });
    const rendered = modules.map(row => row.map(cell => (cell ? '#' : '.')).join(''));
    expect(rendered).toEqual(GOLDEN_PIX_M);
  });

  it('escolhe a menor versão que comporta o conteúdo', () => {
    // Exatamente na capacidade da v1-M (14 bytes) e um byte além dela.
    expect(qr.encode('x'.repeat(14), { ecc: 'M' }).version).toBe(1);
    expect(qr.encode('x'.repeat(15), { ecc: 'M' }).version).toBe(2);
  });

  it('conta bytes UTF-8, não caracteres', () => {
    // 'ç' ocupa 2 bytes: 14 desses não cabem na v1-M, que aceita 14 BYTES.
    expect(qr.encode('ç'.repeat(7), { ecc: 'M' }).version).toBe(1);
    expect(qr.encode('ç'.repeat(8), { ecc: 'M' }).version).toBe(2);
  });

  it('gera o tamanho previsto pela versão (4v + 17)', () => {
    for (const ecc of ['L', 'M', 'Q', 'H']) {
      const result = qr.encode(PIX_PAYLOAD, { ecc });
      expect(result.size).toBe(result.version * 4 + 17);
      expect(result.modules).toHaveLength(result.size);
      expect(result.modules[0]).toHaveLength(result.size);
    }
  });

  it('desenha os três finders e as linhas de tempo', () => {
    const { size, modules } = qr.encode(PIX_PAYLOAD, { ecc: 'M' });
    // Corte vertical pelo centro de cada finder: escuro, escuro, claro, escuro
    // conforme a distância — é a proporção 1:1:3:1:1 que o leitor procura.
    const darkAtDistance = { 0: true, 1: true, 2: false, 3: true, 4: false };
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      for (let d = -4; d <= 4; d++) {
        const y = cy + d;
        if (y < 0 || y >= size) continue; // o separador cai fora nas bordas
        expect(modules[y][cx], `finder (${cx},${cy}) distância ${d}`).toBe(darkAtDistance[Math.abs(d)]);
      }
    }
    // Linhas de tempo: alternadas na linha e na coluna 6.
    for (let i = 8; i < size - 8; i++) {
      expect(modules[6][i]).toBe(i % 2 === 0);
      expect(modules[i][6]).toBe(i % 2 === 0);
    }
  });

  it('recusa conteúdo vazio e conteúdo maior que a versão 40', () => {
    expect(() => qr.encode('')).toThrow(/vazio/i);
    expect(() => qr.encode('x'.repeat(3000), { ecc: 'L' })).toThrow(/não cabem/i);
  });
});

describe('toSvg', () => {
  it('inclui a zona de silêncio de 4 módulos que a norma exige', () => {
    const svg = qr.toSvg(PIX_PAYLOAD, { ecc: 'M' });
    // 49 módulos + 4 de margem de cada lado.
    expect(svg).toContain('viewBox="0 0 57 57"');
  });

  it('não usa style inline, script nem referência externa (CSP)', () => {
    const svg = qr.toSvg(PIX_PAYLOAD, { title: 'Pix' });
    expect(svg).not.toMatch(/<style|<script|style=|href=|xlink/i);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain('<title>Pix</title>');
  });

  it('escapa o que vai para dentro do markup', () => {
    const svg = qr.toSvg('pix', { title: '<img onerror="x">' });
    expect(svg).not.toContain('<img');
    expect(svg).toContain('&lt;img');
  });

  it('marca-se como decorativo quando não recebe título', () => {
    const svg = qr.toSvg('pix');
    expect(svg).toContain('role="presentation"');
    expect(svg).toContain('aria-hidden="true"');
  });
});

// ---------------------------------------------------------------------------
// Matriz de referência — payload Pix acima, modo byte, nível M, versão 8.
// Gerada pelo pacote npm `qrcode` (implementação independente), não por este
// código. Se ela e a nossa divergirem, é a nossa que está errada.
// ---------------------------------------------------------------------------
const GOLDEN_PIX_M = [
  '#######...####.#.....#...#....#.##.#....#.#######',
  '#.....#...##....#...#.###..#....#.###.###.#.....#',
  '#.###.#.#.#...##.#..##..#.###.####.#...##.#.###.#',
  '#.###.#.#.#.#...###..###.........##.#..#..#.###.#',
  '#.###.#.##.#.#.#.##########..##.##..##....#.###.#',
  '#.....#.####..##..#.###...#...#..##.###...#.....#',
  '#######.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#.#######',
  '........#....##.##.##.#...#.#####..#...##........',
  '#.#####...######.##.#.######........#.##..#####..',
  '##..##...#.#..##...#.#.....#..#.##..##...##.#..#.',
  '###..##.#.####.#.###.#.#.###.#.#..###.##..#.....#',
  '.##.##.#.#.#.#..###..........##....##...#.####...',
  '.####.#.##.#.......#.##.#....###...##...###...###',
  '##......##..#.##.##..#.#......#.##.....#..##.#.#.',
  '..##..##...##.####.#...#.#####.##.#.####.#..##..#',
  '.#.....#.#.....##.#..#.#.##.#...##.#..#...####..#',
  '##....#...#..#..##..#...#..#.....#..##..#.....#.#',
  '##...#.#.#....#..#.#.#.###.#..#.##..##.#.###.#.#.',
  '.#.##.#...##....##.....##.#..#..#.#.#........#..#',
  '##...#..###....##.##.#.#.#..#.##..##...#...###...',
  '...##.#...#...#...###.#.#....#.#.##.#...#.#...###',
  '#.#..#..#####..####..#.#...####.#...#..#..#....#.',
  '#.#########.###.###..######...#..#..###.#####.#.#',
  '#...#...##..###...#..##...#.#####..#.#.##...##..#',
  '..###.#.##..######.####.#.##.##..##.#...#.#.###.#',
  '#.###...#####.##..#..##...##..#.##.##..##...##.#.',
  '#..#######..#..###.#..#####..#...##.#########.#.#',
  '.....#.####..#.#..##.##.####....###.##.###...#.##',
  '...#..###.##.#####...##.#....##..#.##..##.##..###',
  '.#####..####..#..#####..#..#..#.##..#..#.###.#.#.',
  '.#...#######.###....#.#.#..#.#.#..#####.###.##..#',
  '#.#.##.#.....#.#.#.##..####.###.#..#.....##..#.##',
  '####.##..#.#..#..###..#....#........##.##.###.#.#',
  '#....#....#.###.##.#...##..#..####.....##....#.#.',
  '#.#####...##..####...##....#.#....#.#####.####..#',
  '#.###...#....#####...#.#.###..#....#.....#...#..#',
  '.##.###..##.###.#.###..#.......#..#.#..##.###.##.',
  '..#....#..#.####.##..#..##..#.#.#......##.....##.',
  '.#...##.#...###..##.....##.#.....#.#.##.#.##....#',
  '.###...#.##.#..#..#..##.#.#.#####.#........#....#',
  '###...#.#.#..#.##.#.#.######.##....###.########.#',
  '........#####.#..#.#.##...##..#..#.##..##...##.#.',
  '#######..##..#.##..####.#.#..#.#..##..#.#.#.##..#',
  '#.....#.##..##.......##...#...##.#.#....#...##..#',
  '#.###.#.####..##.#.#.######..###.#..##.######.###',
  '#.###.#.###..##.###...##...##.####.##..#.########',
  '#.###.#.#...#.##.###....###.##.##.#.#.#......#...',
  '#.....#......#...#.....###..#.####.#.#..#.#.#...#',
  '#######.####..#...#.##..#..#.#...#..#.##.#...#.##'
];
