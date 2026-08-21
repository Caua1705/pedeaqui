// Identidade do tenant no CHROME DO BROWSER — favicon, ícone de tela inicial e
// cartão de compartilhamento.
//
// O app é white-label. DENTRO da página isso já valia: nome, cor, logo e tema
// vêm da API. FORA dela não valia — e "fora dela" é justamente onde o cliente
// final guarda de quem ele pediu:
//
//   - a aba não declarava ícone nenhum, então o browser caía no /favicon.ico da
//     ORIGEM. A origem é uma só para todos os tenants: seja qual for o arquivo
//     que estiver lá, ele nunca é o do restaurante;
//   - <link rel="apple-touch-icon"> apontava, FIXO, para o mark da plataforma.
//     No iOS é ele — não o manifest — que vira o ícone da tela inicial, e é ele
//     que o WhatsApp usa de miniatura quando não há og:image.
//
// A REGRA DESTE ARQUIVO. Nada que a plataforma desenhou pode ser servido como
// ícone de restaurante. Sem logo cadastrada a saída NÃO é o nosso mark: é uma
// marca gerada na hora, com as INICIAIS do restaurante sobre a cor dele — a
// mesma convenção que a tela já usa em .mob-logo-fallback e .cart-rest-avatar
// quando não há logo. O app inteiro passa a degradar do mesmo jeito.
//
// O QUE ESTE ARQUIVO NÃO RESOLVE. og:image e og:title escritos aqui só valem
// para quem executa JS. O crawler do WhatsApp não executa — ele lê o HTML
// servido e para por aí. Por isso o HTML estático ficou NEUTRO (sem ícone nosso,
// sem título nosso): neutro não é a marca do restaurante, mas também não é a
// nossa. Preview com a cara da loja exige render no servidor; ver o relatório.
(function () {
  // O lado do desenho gerado. 512 é o maior tamanho que um manifest pede, e SVG
  // escala para baixo sem perda — um desenho só serve favicon de 16 px e ícone
  // de tela inicial de 512.
  const MARK_SIZE = 512;

  // Canto arredondado do ícone comum, como fração do lado. O maskable NÃO usa:
  // lá o fundo precisa ir até a borda, porque quem recorta é o Android.
  const MARK_CORNER_RATIO = 0.1875;

  // Altura da letra como fração do lado. São dois valores porque a área
  // utilizável é diferente: no ícone comum a arte pode ir quase até o canto; no
  // maskable a "safe zone" do Android é um círculo de 80% do lado, e a letra
  // tem que caber dentro dele mesmo nas máscaras mais agressivas.
  const MARK_TEXT_RATIO = 0.46;
  const MARK_TEXT_RATIO_MASKABLE = 0.3;

  // Lado do apple-touch-icon. 180 é o que o iOS pede no maior DPR.
  const APPLE_TOUCH_SIZE = 180;

  // Pilha de fontes do desenho. Quem rasteriza o SVG é o BROWSER de quem abre,
  // não nós — daí a pilha larga e o sans-serif genérico no fim.
  const MARK_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

  const escapeXml = (text) => String(text ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  }[char]));

  /**
   * As iniciais do restaurante — no máximo duas.
   *
   * Devolve string VAZIA quando não há nome. É de propósito: um texto de reserva
   * aqui só poderia ser genérico ("R" de Restaurante) ou nosso, e as duas coisas
   * são piores que um quadrado liso na cor da loja. Quem chama decide.
   */
  function initialsFor(name) {
    return String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => Array.from(part)[0])
      .join('')
      .toUpperCase();
  }

  /**
   * A marca gerada, como SVG. PURA: só strings entram e saem.
   *
   * O fundo é a cor do lojista; a cor da letra sai de onBrandColor(), a MESMA
   * guarda de contraste que decide a cor do texto sobre os botões da marca
   * (scripts/utils/brand-theme.js). Sem ela, uma loja de marca amarela ganharia
   * um ícone com letra branca ilegível.
   *
   * width/height explícitos não são decoração: sem eles o Firefox se recusa a
   * rasterizar um SVG carregado como IMAGEM — que é exatamente o que acontece
   * quando este desenho vira favicon ou ícone de manifest.
   */
  function brandMarkSvg({ name, primaryColor, maskable = false } = {}) {
    const theme = window.RapidexTheme;
    const background = theme.normalizeHex(primaryColor, theme.PLATFORM_PRIMARY);
    const foreground = theme.onBrandColor(background);
    const initials = escapeXml(initialsFor(name));
    const radius = maskable ? 0 : MARK_SIZE * MARK_CORNER_RATIO;
    const fontSize = MARK_SIZE * (maskable ? MARK_TEXT_RATIO_MASKABLE : MARK_TEXT_RATIO);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${MARK_SIZE}" height="${MARK_SIZE}" viewBox="0 0 ${MARK_SIZE} ${MARK_SIZE}">`
      + `<rect width="${MARK_SIZE}" height="${MARK_SIZE}" rx="${radius}" ry="${radius}" fill="${background}"/>`
      + (initials
        ? `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"`
          + ` font-family="${escapeXml(MARK_FONT)}" font-weight="700" font-size="${fontSize}"`
          + ` fill="${foreground}">${initials}</text>`
        : '')
      + `</svg>`;
  }

  /**
   * O mesmo desenho como data: URI.
   *
   * encodeURIComponent, e não base64: o SVG tem "#" nas cores, e num data: cru
   * o "#" encerraria a URL e entregaria um ícone quebrado. Percent-encoded o
   * arquivo continua legível no DevTools, o que em base64 não estaria.
   */
  function brandMarkDataUri(parts) {
    return `data:image/svg+xml,${encodeURIComponent(brandMarkSvg(parts))}`;
  }

  // O `type` do ícone sai da EXTENSÃO da URL do lojista, não de um palpite fixo.
  // O manifest declarava image/png para qualquer logo; o piloto cadastrou um
  // .webp, então o manifest afirmava um tipo que o arquivo não tem. Nulo é
  // resposta legítima — sem extensão reconhecida é melhor omitir o campo do que
  // mentir, porque o browser DESCARTA ícone cujo `type` declarado ele não
  // suporta.
  function iconTypeFor(url) {
    const extension = String(url || '').split(/[?#]/)[0].split('.').pop().toLowerCase();
    return {
      png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      svg: 'image/svg+xml', gif: 'image/gif', avif: 'image/avif', ico: 'image/x-icon'
    }[extension] || null;
  }

  // Só http(s) absoluto vale como logo remota. Vazio, relativo ou de esquema
  // exótico é descartado em silêncio, e quem chamou cai na marca gerada.
  function remoteLogo(logoUrl) {
    let parsed;
    try {
      parsed = new URL(String(logoUrl || ''));
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.href;
  }

  /**
   * A lista de ícones do tenant, na ordem em que o browser deve considerá-los.
   * PURA — é ela que o manifest consome (scripts/utils/pwa.js).
   *
   * A logo do lojista vem primeiro e com `sizes: "any"`: o tamanho do upload
   * dele é desconhecido, e "any" é o que faz o Chrome tratá-la como candidata
   * ideal para qualquer tamanho pedido.
   *
   * A marca gerada vem depois, COM tamanhos explícitos, e cumpre dois papéis de
   * uma vez: é o 192/512 que o browser exige para oferecer a instalação, e é o
   * que aparece se a logo remota não carregar. Antes esse papel era dos PNGs da
   * PLATAFORMA — ou seja, o app instalado de qualquer loja cujo logo falhasse
   * nascia com o nosso pin na tela inicial.
   *
   * Vale registrar o pior caso: se o Chrome preferir a marca gerada à logo, o
   * cliente vê as iniciais da loja na cor da loja. Continua sendo o restaurante,
   * que é a única propriedade que este arquivo precisa garantir.
   */
  function tenantIcons({ name, logoUrl, primaryColor } = {}) {
    const logo = remoteLogo(logoUrl);
    const logoType = logo ? iconTypeFor(logo) : null;
    const mark = brandMarkDataUri({ name, primaryColor });
    const maskable = brandMarkDataUri({ name, primaryColor, maskable: true });

    return [
      ...(logo ? [{ src: logo, sizes: 'any', ...(logoType ? { type: logoType } : {}), purpose: 'any' }] : []),
      { src: mark, sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
      { src: mark, sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
      { src: maskable, sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' }
    ];
  }

  // ---------------------------------------------------------------------------
  // Escrita no DOM. Daqui para baixo nada é puro.
  // ---------------------------------------------------------------------------

  // Todo <link>/<meta> que este arquivo escreve leva a marcação abaixo, para que
  // reaplicar a identidade (troca de filial, retry de boot) não acumule tags.
  const OWNED = 'data-tenant-identity';

  /**
   * A tag da identidade — ADOTANDO a que o HTML já declarou, quando existe.
   *
   * Adotar não é detalhe. O HTML estático traz og:title e og:description
   * NEUTROS, que existem para o crawler não ler nada nosso. Criar uma segunda
   * tag ao lado deixaria as duas no documento, e todo consumidor de Open Graph
   * — crawler, in-app browser, Web Share — lê a PRIMEIRA: o app continuaria se
   * anunciando como "Pedido Online" com a tag do restaurante logo abaixo, sem
   * ninguém olhar. Foi assim que o e2e pegou.
   *
   * Por isso a busca é pelo seletor cru primeiro; a marcação é carimbada na tag
   * encontrada, e só não havendo nenhuma é que uma nova nasce.
   */
  function ownedTag(tag, selector, attributes) {
    let element = document.head.querySelector(`${selector}[${OWNED}]`)
      || document.head.querySelector(selector);
    if (!element) {
      element = document.createElement(tag);
      document.head.appendChild(element);
    }
    element.setAttribute(OWNED, '');
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    return element;
  }

  /**
   * Rasteriza a marca gerada em PNG.
   *
   * Existe por causa do iOS: o apple-touch-icon é o ÚNICO ícone que o iPhone usa
   * ao salvar na tela inicial (ele ignora o manifest), e o Safari não aceita SVG
   * nesse link. Sem este passo, uma loja sem logo cadastrada ganharia um print
   * da página como ícone.
   *
   * Falhar aqui não é erro: se o canvas não colaborar, o link simplesmente não é
   * escrito e o iOS volta ao print da página — que é a página do restaurante.
   * Degradar para o print é aceitável; degradar para o nosso mark não é.
   */
  function rasterizeMark(svgDataUri, size = APPLE_TOUCH_SIZE) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          canvas.getContext('2d').drawImage(image, 0, 0, size, size);
          resolve(canvas.toDataURL('image/png'));
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = () => reject(new Error('a marca gerada não rasterizou'));
      image.src = svgDataUri;
    });
  }

  /**
   * Favicon e ícone de tela inicial do tenant.
   *
   * A cadeia é: logo cadastrada -> marca gerada com as iniciais na cor da loja.
   * Não existe terceiro degrau, e é esse o ponto — o terceiro degrau era o nosso.
   */
  function applyTenantIcons({ name, logoUrl, primaryColor } = {}) {
    const logo = remoteLogo(logoUrl);
    const mark = brandMarkDataUri({ name, primaryColor });
    const favicon = logo || mark;
    const faviconType = logo ? iconTypeFor(logo) : 'image/svg+xml';

    ownedTag('link', 'link[rel="icon"]', {
      rel: 'icon',
      href: favicon,
      ...(faviconType ? { type: faviconType } : {})
    });

    // O iOS quer PNG. Com logo cadastrada é a URL dela direto — e se o formato
    // do lojista não agradar ao Safari, o pior caso é o print da página.
    if (logo) {
      ownedTag('link', 'link[rel="apple-touch-icon"]', { rel: 'apple-touch-icon', href: logo });
    } else {
      rasterizeMark(mark)
        .then(png => ownedTag('link', 'link[rel="apple-touch-icon"]', { rel: 'apple-touch-icon', href: png }))
        .catch(() => { /* ver rasterizeMark: o iOS cai no print da página */ });
    }

    return { favicon, mark };
  }

  /**
   * Open Graph e Twitter Card com a cara da loja.
   *
   * LEIA ANTES DE CONFIAR NISTO. O crawler do WhatsApp (e o do Facebook, e o do
   * Telegram) NÃO executa JavaScript: ele busca o HTML servido e lê o que está
   * lá. Como o app é servido estático, o que este código escreve nunca chega a
   * esses previews.
   *
   * Então por que escrever? Porque quem executa JS lê: o navegador embutido do
   * Instagram e do próprio WhatsApp ao ABRIR o link, extensões e leitores, e o
   * Web Share do Chrome ao compartilhar a aba. E porque no dia em que o HTML
   * passar a ser renderizado no servidor, o dado a injetar já está decidido
   * aqui, num lugar só.
   */
  function applyTenantMeta({ name, description, logoUrl, primaryColor } = {}) {
    const restaurantName = String(name || '').trim();
    if (!restaurantName) return null;

    const title = document.title || restaurantName;
    const text = String(description || '').trim() || `Peça online no ${restaurantName}.`;
    const image = remoteLogo(logoUrl) || brandMarkDataUri({ name, primaryColor });

    const tags = {
      'og:type': 'website',
      'og:site_name': restaurantName,
      'og:title': title,
      'og:description': text,
      'og:image': image,
      'og:url': window.location.href,
      'twitter:card': 'summary',
      'twitter:title': title,
      'twitter:description': text,
      'twitter:image': image
    };

    for (const [key, value] of Object.entries(tags)) {
      const attribute = key.startsWith('og:') ? 'property' : 'name';
      ownedTag('meta', `meta[${attribute}="${key}"]`, { [attribute]: key, content: value });
    }
    ownedTag('meta', 'meta[name="description"]', { name: 'description', content: text });

    return tags;
  }

  window.RapidexTenantIdentity = {
    MARK_SIZE,
    APPLE_TOUCH_SIZE,
    initialsFor,
    brandMarkSvg,
    brandMarkDataUri,
    iconTypeFor,
    remoteLogo,
    tenantIcons,
    applyTenantIcons,
    applyTenantMeta
  };
})();
