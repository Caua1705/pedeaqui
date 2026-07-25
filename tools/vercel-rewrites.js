// Espelha os rewrites da vercel.json no dev server e no preview do Vite.
//
// POR QUÊ: o roteamento de produção mora na vercel.json e NÃO existe localmente.
// Até aqui isso passava batido porque tudo — dev, preview, e2e — usava a forma
// /restaurant.html?slug=x, que não precisa de rewrite. O manifest por tenant
// mudou isso: ele é servido em /<slug>/manifest.webmanifest, uma URL que só a
// Vercel sabe resolver. Sem este espelho, o `<link rel="manifest">` apontaria
// para um 404 em todo ambiente local, e o e2e não teria como provar que a rota
// que o PWA depende existe.
//
// As regras são LIDAS da vercel.json, nunca copiadas: uma cópia envelheceria em
// silêncio e o local voltaria a divergir da produção — que é o bug que este
// arquivo existe para não deixar acontecer.
//
// ORDEM. Na Vercel o rewrite só entra quando o filesystem não respondeu. Aqui
// ele precisa rodar ANTES dos middlewares do Vite — não depois — porque o Vite
// tem `appType: 'spa'` e devolve index.html para toda rota desconhecida: um
// pós-middleware nunca veria /<slug>/, o fallback já teria respondido com a
// landing. A regra "arquivo real ganha" é então reimplementada aqui, checando o
// disco antes de reescrever, em vez de herdada da ordem da cadeia.
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';

/**
 * Compila o `source` de um rewrite (sintaxe path-to-regexp da Vercel) em RegExp.
 *
 * Só o subconjunto que a vercel.json usa: `:nome` e `:nome(regex)`. O regex do
 * parâmetro pode ter parênteses aninhados — `([a-z0-9]+(?:-[a-z0-9]+)*)` — daí
 * a varredura balanceada em vez de um replace ingênuo, que cortaria no primeiro
 * `)` e produziria um padrão inválido.
 */
export function compileRoute(source) {
  const params = [];
  let pattern = '';

  for (let i = 0; i < source.length; i++) {
    if (source[i] !== ':') {
      pattern += source[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      continue;
    }
    let end = i + 1;
    while (end < source.length && /[A-Za-z0-9_]/.test(source[end])) end++;
    params.push(source.slice(i + 1, end));

    if (source[end] !== '(') {
      pattern += '([^/]+)';
      i = end - 1;
      continue;
    }
    let depth = 1;
    let close = end + 1;
    while (close < source.length && depth > 0) {
      if (source[close] === '(') depth++;
      else if (source[close] === ')') depth--;
      close++;
    }
    pattern += `(${source.slice(end + 1, close - 1)})`;
    i = close - 1;
  }

  return { regex: new RegExp(`^${pattern}$`), params };
}

/** Aplica o primeiro rewrite que casar. Devolve a URL nova, ou null. */
export function rewriteUrl(rewrites, url) {
  const [pathname, search = ''] = String(url).split('?');

  for (const rule of rewrites) {
    const { regex, params } = compileRoute(rule.source);
    const match = regex.exec(pathname);
    if (!match) continue;

    let destination = rule.destination;
    params.forEach((name, index) => {
      destination = destination.split(`:${name}`).join(match[index + 1]);
    });
    // A query original sobrevive ao rewrite, como na Vercel.
    if (search) destination += (destination.includes('?') ? '&' : '?') + search;
    return destination;
  }
  return null;
}

export function readRewrites(vercelJsonPath) {
  return JSON.parse(readFileSync(vercelJsonPath, 'utf8')).rewrites || [];
}

/** O caminho existe como arquivo dentro de algum dos diretórios servidos? */
export function servesFile(directories, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = pathname;
  }
  // `normalize` colapsa os ".." antes da checagem; o prefixo confirma que o
  // caminho não escapou do diretório servido.
  const relative = normalize(decoded).replace(/^[\\/]+/, '');
  return directories.some(directory => {
    const base = resolve(directory);
    const target = resolve(join(base, relative));
    if (target !== base && !target.startsWith(base + sep)) return false;
    try {
      return statSync(target).isFile();
    } catch {
      return false;
    }
  });
}

export function vercelRewrites(vercelJsonPath) {
  let served = [];

  const middleware = (request, _response, next) => {
    // Só navegação/GET. Um POST reescrito viraria outro método na mesma URL.
    if (request.method !== 'GET' && request.method !== 'HEAD') return next();
    const [pathname] = String(request.url).split('?');
    if (servesFile(served, pathname)) return next();

    const rewritten = rewriteUrl(readRewrites(vercelJsonPath), request.url);
    if (rewritten) request.url = rewritten;
    next();
  };

  return {
    name: 'rapidex:vercel-rewrites',
    apply: 'serve',

    // Em dev o Vite serve a raiz do projeto E o publicDir; no preview, só o
    // outDir, onde os dois já foram fundidos pelo build.
    configureServer(server) {
      const { root, publicDir } = server.config;
      served = publicDir ? [root, publicDir] : [root];
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      served = [resolve(server.config.root, server.config.build.outDir)];
      server.middlewares.use(middleware);
    }
  };
}
