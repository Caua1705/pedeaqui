// ============================================================================
//  Gerador de QR Code — modo byte, ISO/IEC 18004.
//
//  POR QUE ESCREVER ISTO EM VEZ DE USAR UMA BIBLIOTECA
//
//  O backend devolve o Pix como `qr_code`: a string copia-e-cola (payload EMV),
//  não uma imagem. Alguém precisa transformá-la em QR, e as duas saídas fáceis
//  estão fechadas: o projeto não tem NENHUMA dependência de runtime (package.json
//  só tem devDependencies), e a CSP de produção proíbe script/img de terceiros
//  (`default-src 'self'`, `img-src 'self' data: blob:`). Um <img src="api-de-qr">
//  seria bloqueado — e, pior, mandaria o payload de cobrança do cliente para um
//  host externo.
//
//  A saída é SVG montado com ATRIBUTOS (fill=, d=), sem style inline e sem
//  script: passa na CSP sem precisar afrouxar nada.
//
//  ESCOPO. Só modo byte (o payload Pix é ASCII/UTF-8 misto e não compensa
//  segmentar) e versões 1..40. Sem modo numérico, alfanumérico ou kanji: o
//  ganho seria alguns módulos a menos num QR que já cabe na tela.
//
//  As tabelas abaixo são da própria norma. Não são ajustáveis: se alguma linha
//  estiver errada, o QR sai lido errado por metade dos leitores e certo pela
//  outra metade. tests/unit/qrcode.test.js confere as capacidades derivadas
//  delas contra os valores publicados da norma.
// ============================================================================
(function () {
  const MIN_VERSION = 1;
  const MAX_VERSION = 40;

  // Nível de correção de erro -> bits que vão no campo de formato do QR.
  // (A ordem NÃO é L,M,Q,H — é a da norma.)
  const ECC_LEVELS = {
    L: { index: 0, formatBits: 1 },
    M: { index: 1, formatBits: 0 },
    Q: { index: 2, formatBits: 3 },
    H: { index: 3, formatBits: 2 }
  };

  // [nível][versão] — índice 0 não existe (não há versão 0).
  const ECC_CODEWORDS_PER_BLOCK = [
    // 1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19  20  21  22  23  24  25  26  27  28  29  30  31  32  33  34  35  36  37  38  39  40
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // L
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28], // M
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // Q
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30] //  H
  ];

  const NUM_ERROR_CORRECTION_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25], // L
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49], // M
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68], // Q
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81] //  H
  ];

  const PENALTY_N1 = 3;
  const PENALTY_N2 = 3;
  const PENALTY_N3 = 40;
  const PENALTY_N4 = 10;

  /* ------------------------------------------------------------------ */
  /*  Aritmética em GF(256), polinômio primitivo 0x11D                   */
  /* ------------------------------------------------------------------ */

  function gfMultiply(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }

  /** Polinômio gerador de Reed-Solomon de grau `degree`, coeficientes descendentes. */
  function rsDivisor(degree) {
    const result = new Uint8Array(degree);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        result[j] = gfMultiply(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMultiply(root, 0x02);
    }
    return result;
  }

  /** Resto da divisão dos dados pelo gerador — são os codewords de correção. */
  function rsRemainder(data, divisor) {
    const result = new Uint8Array(divisor.length);
    for (const byte of data) {
      const factor = byte ^ result[0];
      result.copyWithin(0, 1);
      result[result.length - 1] = 0;
      for (let i = 0; i < divisor.length; i++) result[i] ^= gfMultiply(divisor[i], factor);
    }
    return result;
  }

  /* ------------------------------------------------------------------ */
  /*  Capacidades                                                        */
  /* ------------------------------------------------------------------ */

  /** Módulos disponíveis para dados+ECC, já descontados os padrões funcionais. */
  function rawDataModules(version) {
    let result = (16 * version + 128) * version + 64;
    if (version >= 2) {
      const numAlign = Math.floor(version / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (version >= 7) result -= 36; // dois blocos de informação de versão
    }
    return result;
  }

  function dataCodewords(version, eccName) {
    const level = ECC_LEVELS[eccName].index;
    return (
      Math.floor(rawDataModules(version) / 8) -
      ECC_CODEWORDS_PER_BLOCK[level][version] * NUM_ERROR_CORRECTION_BLOCKS[level][version]
    );
  }

  /** Bits do campo "contagem de caracteres" no modo byte: 8 até a v9, 16 daí em diante. */
  const charCountBits = version => (version <= 9 ? 8 : 16);

  /** Quantos bytes cabem numa dada versão/nível, já descontado o cabeçalho. */
  function byteCapacity(version, eccName) {
    const headerBits = 4 + charCountBits(version);
    return Math.max(0, Math.floor((dataCodewords(version, eccName) * 8 - headerBits) / 8));
  }

  /* ------------------------------------------------------------------ */
  /*  Codificação                                                        */
  /* ------------------------------------------------------------------ */

  function toUtf8Bytes(value) {
    const string = String(value ?? '');
    if (typeof TextEncoder === 'function') return Array.from(new TextEncoder().encode(string));
    // Fallback sem TextEncoder (ambientes muito antigos / testes headless).
    return Array.from(unescape(encodeURIComponent(string)), char => char.charCodeAt(0));
  }

  function bitBuffer() {
    const bits = [];
    return {
      bits,
      append(value, length) {
        for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
      }
    };
  }

  /** Bytes -> codewords de dados (cabeçalho, terminador, padding), para a versão dada. */
  function buildDataCodewords(bytes, version, eccName) {
    const capacityBits = dataCodewords(version, eccName) * 8;
    const buffer = bitBuffer();
    buffer.append(0b0100, 4); // indicador do modo byte
    buffer.append(bytes.length, charCountBits(version));
    bytes.forEach(byte => buffer.append(byte, 8));

    // Terminador: até 4 zeros, o que couber.
    buffer.append(0, Math.min(4, capacityBits - buffer.bits.length));
    // Completa o último byte.
    buffer.append(0, (8 - (buffer.bits.length % 8)) % 8);

    // Preenchimento alternado da norma, até encher a capacidade.
    for (let padding = 0xec; buffer.bits.length < capacityBits; padding ^= 0xec ^ 0x11) {
      buffer.append(padding, 8);
    }

    const codewords = [];
    for (let i = 0; i < buffer.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | buffer.bits[i + j];
      codewords.push(byte);
    }
    return codewords;
  }

  /** Divide em blocos, calcula o ECC de cada um e intercala como a norma manda. */
  function addEccAndInterleave(data, version, eccName) {
    const level = ECC_LEVELS[eccName].index;
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[level][version];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[level][version];
    const rawCodewords = Math.floor(rawDataModules(version) / 8);
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);

    const divisor = rsDivisor(blockEccLen);
    const blocks = [];
    for (let i = 0, offset = 0; i < numBlocks; i++) {
      const dataLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
      const block = data.slice(offset, offset + dataLen);
      offset += dataLen;
      const ecc = Array.from(rsRemainder(block, divisor));
      // Bloco curto ganha um furo para a intercalação ficar retangular; ele é
      // pulado na leitura abaixo.
      if (i < numShortBlocks) block.push(0);
      blocks.push(block.concat(ecc));
    }

    const result = [];
    for (let i = 0; i < blocks[0].length; i++) {
      for (let j = 0; j < blocks.length; j++) {
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(blocks[j][i]);
      }
    }
    return result;
  }

  /* ------------------------------------------------------------------ */
  /*  Desenho da matriz                                                  */
  /* ------------------------------------------------------------------ */

  function alignmentPositions(version) {
    if (version === 1) return [];
    const numAlign = Math.floor(version / 7) + 2;
    const step = Math.floor((version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
    const result = [6];
    for (let pos = version * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  function createMatrix(version, eccName, codewords) {
    const size = version * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));

    const setFunction = (x, y, dark) => {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      modules[y][x] = dark;
      isFunction[y][x] = true;
    };

    // Finder (7x7) + separador: um quadrado de raio 4 em volta do centro.
    const drawFinder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const distance = Math.max(Math.abs(dx), Math.abs(dy));
          setFunction(cx + dx, cy + dy, distance !== 2 && distance !== 4);
        }
      }
    };

    // Alinhamento (5x5), em todo cruzamento das posições menos os três cantos
    // dos finders.
    const drawAlignment = (cx, cy) => {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    };

    // Linhas de tempo.
    for (let i = 0; i < size; i++) {
      setFunction(6, i, i % 2 === 0);
      setFunction(i, 6, i % 2 === 0);
    }

    drawFinder(3, 3);
    drawFinder(size - 4, 3);
    drawFinder(3, size - 4);

    const positions = alignmentPositions(version);
    for (let i = 0; i < positions.length; i++) {
      for (let j = 0; j < positions.length; j++) {
        const isFinderCorner =
          (i === 0 && j === 0) ||
          (i === 0 && j === positions.length - 1) ||
          (i === positions.length - 1 && j === 0);
        if (!isFinderCorner) drawAlignment(positions[i], positions[j]);
      }
    }

    // Reserva as células do formato (preenchidas depois, já com a máscara
    // escolhida) e o módulo escuro fixo.
    const reserveFormat = () => {
      // i === 6 é pulado nos dois eixos: ali estão as linhas de tempo, que o
      // formato contorna. Reservá-las apagaria dois módulos escuros que os
      // leitores usam para se sincronizar.
      for (let i = 0; i <= 8; i++) {
        if (i === 6) continue;
        setFunction(8, i, false);
        setFunction(i, 8, false);
      }
      for (let i = 0; i < 8; i++) {
        setFunction(size - 1 - i, 8, false);
        setFunction(8, size - 1 - i, false);
      }
      setFunction(8, size - 8, true); // módulo escuro, sempre 1
    };
    reserveFormat();

    // Informação de versão (só v7+): 18 bits com BCH(18,6).
    if (version >= 7) {
      let remainder = version;
      for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
      const bits = (version << 12) | remainder;
      for (let i = 0; i < 18; i++) {
        const dark = ((bits >>> i) & 1) !== 0;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        setFunction(a, b, dark);
        setFunction(b, a, dark);
      }
    }

    // Dados: zigue-zague de duas colunas, de baixo para cima e da direita para
    // a esquerda, pulando a coluna 6 (linha de tempo vertical).
    let bitIndex = 0;
    const totalBits = codewords.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < size; vertical++) {
        for (let column = 0; column < 2; column++) {
          const x = right - column;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vertical : vertical;
          if (isFunction[y][x] || bitIndex >= totalBits) continue;
          modules[y][x] = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
          bitIndex++;
        }
      }
    }
    // Os bits restantes (remainder bits) ficam claros — é o que a norma pede.

    return { size, modules, isFunction };
  }

  const MASK_FUNCTIONS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    x => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  ];

  function applyMask(matrix, mask) {
    const { size, modules, isFunction } = matrix;
    const fn = MASK_FUNCTIONS[mask];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!isFunction[y][x] && fn(x, y)) modules[y][x] = !modules[y][x];
      }
    }
  }

  function drawFormatBits(matrix, eccName, mask) {
    const { size, modules, isFunction } = matrix;
    const data = (ECC_LEVELS[eccName].formatBits << 3) | mask;
    let remainder = data;
    for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const bits = ((data << 10) | remainder) ^ 0x5412;

    const set = (x, y, dark) => {
      modules[y][x] = dark;
      isFunction[y][x] = true;
    };
    const bit = i => ((bits >>> i) & 1) !== 0;

    // Cópia 1: em volta do finder superior esquerdo.
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));

    // Cópia 2: dividida entre os outros dois finders.
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true); // módulo escuro
  }

  /** Penalidade da norma: quanto MENOR, mais legível o padrão mascarado. */
  function penaltyScore(matrix) {
    const { size, modules } = matrix;
    let result = 0;

    // Procura a proporção 1:1:3:1:1 dos finders no meio dos dados, olhando as
    // sete últimas sequências de cor da linha.
    const countFinderPatterns = (runHistory) => {
      const n = runHistory[1];
      const core =
        n > 0 &&
        runHistory[2] === n &&
        runHistory[3] === n * 3 &&
        runHistory[4] === n &&
        runHistory[5] === n;
      return (
        (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0) +
        (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0)
      );
    };

    const scanLine = (get) => {
      const runHistory = new Array(7).fill(0);
      // A borda do símbolo conta como claro infinito: a PRIMEIRA sequência da
      // linha entra no histórico somada a `size`, e a última também. Sem isso
      // um finder encostado na borda não é contado, e a máscara escolhida sai
      // diferente da que a norma manda.
      const addHistory = (length) => {
        const padded = runHistory[0] === 0 ? length + size : length;
        runHistory.copyWithin(1, 0);
        runHistory[0] = padded;
      };

      let runColor = false;
      let runLength = 0;
      let lineScore = 0;

      for (let i = 0; i < size; i++) {
        const dark = get(i);
        if (dark === runColor) {
          runLength++;
          if (runLength === 5) lineScore += PENALTY_N1;
          else if (runLength > 5) lineScore++;
        } else {
          addHistory(runLength);
          if (!runColor) lineScore += countFinderPatterns(runHistory) * PENALTY_N3;
          runColor = dark;
          runLength = 1;
        }
      }

      // Fecha a linha: se ela terminou escura, essa sequência entra sozinha, e
      // só então a borda clara final é somada.
      if (runColor) {
        addHistory(runLength);
        runLength = 0;
      }
      addHistory(runLength + size);
      lineScore += countFinderPatterns(runHistory) * PENALTY_N3;
      return lineScore;
    };

    for (let y = 0; y < size; y++) result += scanLine(x => modules[y][x]);
    for (let x = 0; x < size; x++) result += scanLine(y => modules[y][x]);

    // Blocos 2x2 de uma cor só.
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const color = modules[y][x];
        if (color === modules[y][x + 1] && color === modules[y + 1][x] && color === modules[y + 1][x + 1]) {
          result += PENALTY_N2;
        }
      }
    }

    // Desequilíbrio entre claros e escuros.
    let dark = 0;
    for (const row of modules) for (const cell of row) if (cell) dark++;
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * PENALTY_N4;

    return result;
  }

  /* ------------------------------------------------------------------ */
  /*  API pública                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * @param {string} text
   * @param {object} [options]
   * @param {'L'|'M'|'Q'|'H'} [options.ecc='M'] nível de correção de erro
   * @param {number} [options.minVersion=1]
   * @returns {{size:number, version:number, ecc:string, mask:number, modules:boolean[][]}}
   * @throws {Error} quando o texto não cabe nem na versão 40
   */
  function encode(text, options = {}) {
    const eccName = ECC_LEVELS[options.ecc] ? options.ecc : 'M';
    const bytes = toUtf8Bytes(text);
    if (!bytes.length) throw new Error('QR Code: conteúdo vazio.');

    const minVersion = Math.min(Math.max(Number(options.minVersion) || MIN_VERSION, MIN_VERSION), MAX_VERSION);
    let version = 0;
    for (let candidate = minVersion; candidate <= MAX_VERSION; candidate++) {
      if (bytes.length <= byteCapacity(candidate, eccName)) {
        version = candidate;
        break;
      }
    }
    if (!version) {
      throw new Error(`QR Code: ${bytes.length} bytes não cabem em nenhuma versão no nível ${eccName}.`);
    }

    const codewords = addEccAndInterleave(buildDataCodewords(bytes, version, eccName), version, eccName);

    // Constrói uma vez e testa as 8 máscaras sobre a MESMA matriz, desfazendo
    // cada uma (a máscara é um XOR: aplicá-la de novo reverte).
    const matrix = createMatrix(version, eccName, codewords);
    let bestMask = 0;
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      applyMask(matrix, mask);
      drawFormatBits(matrix, eccName, mask);
      const score = penaltyScore(matrix);
      if (score < bestScore) {
        bestScore = score;
        bestMask = mask;
      }
      applyMask(matrix, mask);
    }
    applyMask(matrix, bestMask);
    drawFormatBits(matrix, eccName, bestMask);

    return {
      size: matrix.size,
      version,
      ecc: eccName,
      mask: bestMask,
      modules: matrix.modules
    };
  }

  /**
   * SVG pronto para innerHTML. Sem <style>, sem script e sem referência externa:
   * cores vão como atributo `fill`, então a CSP de produção não é tocada.
   *
   * O desenho é UM único <path> — um <rect> por módulo geraria milhares de nós
   * para uma imagem que nunca muda.
   *
   * @param {string} text
   * @param {object} [options]
   * @param {number} [options.border=4] módulos de margem (a norma pede 4)
   * @param {string} [options.dark='#000000']
   * @param {string} [options.light='#ffffff']
   * @param {string} [options.title] rótulo acessível
   */
  function toSvg(text, options = {}) {
    const { size, modules } = encode(text, options);
    const border = Math.max(0, Number.isFinite(options.border) ? options.border : 4);
    const dark = options.dark || '#000000';
    const light = options.light || '#ffffff';
    const dimension = size + border * 2;

    const parts = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (modules[y][x]) parts.push(`M${x + border},${y + border}h1v1h-1z`);
      }
    }

    const escapeXml = value =>
      String(value).replace(/[&<>"']/g, char =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
      );
    const title = options.title ? `<title>${escapeXml(options.title)}</title>` : '';
    const role = options.title ? 'img' : 'presentation';

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimension} ${dimension}" ` +
      `shape-rendering="crispEdges" role="${role}"${options.title ? '' : ' aria-hidden="true"'}>` +
      `${title}<rect width="${dimension}" height="${dimension}" fill="${escapeXml(light)}"/>` +
      `<path d="${parts.join('')}" fill="${escapeXml(dark)}"/>` +
      `</svg>`
    );
  }

  window.RapidexQrCode = { encode, toSvg, byteCapacity, MIN_VERSION, MAX_VERSION };
})();
