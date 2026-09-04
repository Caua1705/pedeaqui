(function () {
  // API base comes from Vite env (VITE_API_BASE_URL in .env — see .env.example),
  // falling back to the production URL so the app still boots without a .env.
  var envApiBase;
  var envRootDomains;
  var envGoogleClientId;
  try {
    envApiBase = (import.meta.env && import.meta.env.VITE_API_BASE_URL) || '';
    envRootDomains = (import.meta.env && import.meta.env.VITE_TENANT_ROOT_DOMAINS) || '';
    envGoogleClientId = (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) || '';
  } catch {
    envApiBase = '';
    envRootDomains = '';
    envGoogleClientId = '';
  }

  // Domínios em que um subdomínio significa "restaurante" (<slug>.rapidex.com).
  // Qualquer outro host (preview do Vercel, localhost, IP) resolve o tenant só
  // por path/query. Ver scripts/utils/restaurant-slug.js.
  const rootDomains = String(envRootDomains)
    .split(',')
    .map(domain => domain.trim().toLowerCase())
    .filter(Boolean);

  const APP_CONFIG = {
    API_BASE_URL: envApiBase || 'https://api.pederapidex.com',
    TENANT_ROOT_DOMAINS: rootDomains.length ? rootDomains : ['rapidex.com', 'pederapidex.com'],
    // Não existe DEFAULT_RESTAURANT_SLUG. Um slug ausente ou desconhecido tem
    // que virar "Restaurante não encontrado"; cair num restaurante padrão
    // mostraria cardápio, marca e preços de OUTRO tenant.
    // Cor da PLATAFORMA (Rapidex), não de um restaurante. Só é usada enquanto o
    // tema do tenant não chegou, ou quando a API não informa primary/secondary.
    // Assim que /menu responde, applyTheme() sobrescreve com a cor do tenant.
    PLATFORM_BRAND_PRIMARY: '#F36F21',
    PLATFORM_BRAND_SECONDARY: '#111111',
    // O client id do Google Identity Services. É PÚBLICO — ele vai no HTML de
    // toda página que mostra o botão, e o backend confere o `aud` do
    // `id_token` contra a própria lista dele. Está em env por ambiente, não por
    // sigilo: o client id de produção não vale num preview, porque a origem
    // autorizada é cadastrada no console do Google.
    //
    // VAZIO É O PADRÃO, e é uma decisão: sem client id o botão NÃO APARECE.
    // Mostrar um "Entrar com Google" que não pode funcionar é pior que não
    // mostrar nada — o cliente toca, nada acontece, e ele conclui que o app está
    // quebrado em vez de usar o caminho que funciona ao lado.
    GOOGLE_CLIENT_ID: envGoogleClientId
  };

  // Saíram daqui na auditoria de 29/08/2026, todos constantes que nada lia como
  // variável:
  //
  //   STORAGE_MODE ('api') e USE_MOCK_DATA (false) — o único leitor era o ramo
  //   de dados locais do api.js, que portanto nunca rodava. Não vinham de env:
  //   ligar o modo mock exigia editar este arquivo, o que ninguém fez em toda a
  //   história do repo.
  //   MOCK_DATA_BASE_PATH — caminho do ramo acima.
  //   STORAGE_PREFIX ('pedeaqui') — o prefixo real das chaves é `rapidex.` e
  //   mora em scripts/utils/storage-keys.js. Este valor só alimentava
  //   PedeAquiConfig.storagePrefix, e um prefixo errado publicado ao lado do
  //   certo é convite a gravar no lugar errado.
  //
  //   window.PedeAquiConfig inteiro — quatro campos, zero leitores. Quem lê
  //   configuração lê window.APP_CONFIG.
  window.APP_CONFIG = APP_CONFIG;
})();
