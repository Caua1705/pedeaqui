(function () {
  const slugify = text => window.PedeAquiSlugify?.slugify(text) || String(text || '').toLowerCase().replace(/\s+/g, '-');
  const fallback = () => window.PedeAquiFallbackConfig || {};

  /**
   * Buscar o cardapio atravessava QUATRO camadas, e tres nao faziam nada:
   *
   *   restaurant-page  -> RestaurantService.getRestaurantMenu()   repasse puro
   *                    -> MenuService.getRestaurantMenu()         normaliza
   *                    -> Api.getRestaurantMenu()                 repasse puro
   *                    -> ApiClient.get()                         faz a chamada
   *
   * Sobraram as duas que trabalham. Camada que so repassa nao e abstracao: e
   * mais um lugar onde procurar quando a resposta vem errada, e mais um lugar
   * onde alguem pode meter uma regra que a camada de cima nao ve.
   */
  async function getRestaurantMenu(slug, branchId) {
    const routes = window.PedeAquiApiRoutes;
    return normalizeMenuPayload(await window.PedeAquiApiClient.get(routes.menu(slug, branchId)));
  }

  /**
   * De qual filial esta resposta está falando — a resposta INTEIRA, não só o
   * bloco `settings`.
   *
   * Leio `branch_id` e ignoro de propósito o `settings_branch_id`, que traz o
   * mesmo valor e está obsoleto: o nome descreve o passo anterior, quando só a
   * operação era da filial. Quem lê "settings_branch_id" não imagina que os
   * PRODUTOS também são dela.
   *
   * Nulo é resposta legítima: restaurante sem nenhuma filial ativa responde 200
   * com as listas vazias.
   */
  function menuBranchId(raw = {}) {
    const value = raw.branch_id;
    return value === undefined || value === null || value === '' ? null : String(value);
  }

  /**
   * A conferência que o backend pediu que a tela fizesse (§3.1 de
   * `cardapio-por-filial.md`): cada produto e cada categoria repetem a filial
   * da raiz. Divergir significa que a resposta misturou DUAS lojas numa lista
   * só — o modo de falha do rollback de imagem sem descer o banco, que responde
   * 200, com JSON válido, e sem uma linha de log dizendo por quê.
   *
   * Só avisa. Adivinhar qual metade é a certa aqui seria inventar cardápio.
   */
  function warnOnMixedBranches(raw, branchId, products, categories) {
    if (!branchId) return;
    const alheio = item => item?.branch_id && String(item.branch_id) !== String(branchId);
    if (!products.some(alheio) && !categories.some(alheio)) return;
    console.error(
      '[PedeAqui] O /menu voltou com produtos ou categorias de MAIS DE UMA filial. '
      + 'A resposta está misturando duas lojas — não confie nos preços desta tela.',
      { branch_id: branchId, restaurant: raw?.restaurant?.slug || '' }
    );
  }

  function normalizeBranches(raw = {}) {
    const source = Array.isArray(raw.branches) ? raw.branches : [];
    return source.map((branch, index) => {
      const name = branch.name || branch.branch_name || fallback().branchName?.(index) || '';
      const fullAddress = branch.full_address
        || [branch.address, branch.neighborhood, branch.city, branch.state].filter(Boolean).join(', ');
      return {
        ...branch,
        id: String(branch.id || branch.uuid || branch.branch_id || slugify(name) || index),
        restaurant_id: branch.restaurant_id || raw.restaurant?.id || '',
        name,
        label: branch.label || fallback().branchLabel?.(name) || '',
        address: branch.address || '',
        full_address: fullAddress,
        neighborhood: branch.neighborhood || '',
        city: branch.city || '',
        state: branch.state || '',
        phone: branch.phone || '',
        whatsapp: branch.whatsapp || '',
        is_open: branch.is_open !== undefined ? branch.is_open !== false : branch.is_active !== false,
        accepts_delivery: branch.accepts_delivery !== false,
        accepts_pickup: branch.accepts_pickup !== false,
        sort_order: Number(branch.sort_order ?? (branch.is_main ? -1 : index))
      };
    }).sort((a, b) => a.sort_order - b.sort_order);
  }

  function normalizeMenuPayload(raw = {}) {
    let sourceCategories = Array.isArray(raw.categories) ? raw.categories : [];
    let sourceProducts = Array.isArray(raw.products) ? raw.products : [];
    const sourceBanners = Array.isArray(raw.banners) ? raw.banners : [];
    const sourceHighlightBanners = Array.isArray(raw.highlight_banners) ? raw.highlight_banners : [];

    if ((!sourceCategories.length || !sourceProducts.length) && raw.menu) {
      const menuList = Array.isArray(raw.menu) ? raw.menu : Object.values(raw.menu).filter(section => section && Array.isArray(section.items));
      sourceCategories = menuList.map((section, index) => ({
        id: slugify(section.category || index),
        name: section.category || fallback().categoryName || '',
        slug: slugify(section.category || index),
        sort_order: index
      }));
      sourceProducts = menuList.flatMap((section, sectionIndex) => (section.items || []).map((item, index) => ({
        ...item,
        category: section.category,
        category_slug: slugify(section.category || sectionIndex),
        sort_order: index
      })));
    }

    const categories = sourceCategories.map((category, index) => ({
      id: String(category.id || category.slug || slugify(category.name || category.category || index)),
      name: category.name || category.category || fallback().categoryName || '',
      slug: category.slug || slugify(category.name || category.category || index),
      // `??`, e nao `||`: `sort_order` vale 0 por PADRAO no contrato
      // (CategoryResponse, ProductResponse e BannerResponse declaram os tres
      // `sort_order: number | null` com `@default 0`). Com `||`, o item de
      // MENOR ordem — o que tem de vir primeiro — era justamente o que perdia a
      // propria ordem e herdava a posicao de chegada no array.
      sort_order: Number(category.sort_order ?? index)
    })).sort((a, b) => a.sort_order - b.sort_order);

    const categoryById = new Map(categories.map(category => [String(category.id), category]));
    const categoryBySlug = new Map(categories.map(category => [String(category.slug), category]));

    const products = sourceProducts.map((product, index) => {
      const categoryId = String(product.category_id || product.category_slug || product.category || '');
      const category = categoryById.get(categoryId) || categoryBySlug.get(categoryId) || categoryBySlug.get(slugify(product.category));
      const sourceOptionGroups = Array.isArray(product.option_groups)
        ? product.option_groups
        : (Array.isArray(product.optionGroups) ? product.optionGroups : []);
      const optionGroups = sourceOptionGroups.length
        ? sourceOptionGroups.map((group, groupIndex) => ({
          ...group,
          id: String(group.id || group.option_group_id || groupIndex),
          name: group.name || group.title || '',
          min_select: Number(group.min_select ?? group.minSelect ?? group.min ?? 0),
          max_select: Number(group.max_select ?? group.maxSelect ?? group.max ?? 1),
          is_required: group.is_required === true || group.isRequired === true || Number(group.min_select ?? group.minSelect ?? group.min ?? 0) > 0,
          sort_order: Number(group.sort_order ?? groupIndex),
          options: Array.isArray(group.options)
            ? group.options.map((option, optionIndex) => ({
              ...option,
              id: String(option.id || option.option_id || optionIndex),
              name: option.name || option.title || '',
              description: option.description || option.desc || '',
              additional_price: Number(option.additional_price ?? option.additionalPrice ?? option.price ?? 0),
              sort_order: Number(option.sort_order ?? optionIndex)
            })).sort((a, b) => a.sort_order - b.sort_order)
            : []
        })).sort((a, b) => a.sort_order - b.sort_order)
        : [];
      return {
        id: String(product.id || product.slug || product.code || index),
        restaurant_id: product.restaurant_id || raw.restaurant?.id || '',
        category_id: product.category_id || category?.id || categoryId,
        code: product.code || '',
        name: product.name || fallback().productName || '',
        slug: product.slug || slugify(product.name || product.id || index),
        description: product.description || product.desc || '',
        price: typeof product.price === 'number' ? product.price : Number(product.price),
        old_price: product.old_price ?? product.original_price ?? product.price_old ?? product.compare_at_price ?? product.list_price ?? null,
        image_path: product.image_path || '',
        image_url: product.image_url || product.image_path || '',
        category_slug: product.category_slug || category?.slug || slugify(product.category || categoryId),
        category: product.category || category?.name || '',
        is_active: product.is_active !== false,
        is_available: product.is_available !== false,
        sort_order: Number(product.sort_order ?? index), // 0 e ordem, nao ausencia

        option_groups: optionGroups
      };
    }).sort((a, b) => a.sort_order - b.sort_order);

    const branchId = menuBranchId(raw);
    warnOnMixedBranches(raw, branchId, sourceProducts, sourceCategories);

    return {
      restaurant: raw.restaurant || {},
      // De qual filial é TUDO o que vem abaixo. Quem carrega o cardápio guarda
      // este valor: é ele, e não o que foi pedido, que diz o que está na tela.
      branch_id: branchId,
      settings: raw.settings || {},
      branches: normalizeBranches(raw),
      // BANNER NAO TEM TEXTO NO CONTRATO. `BannerResponse` declara sete
      // campos — banner_type, id, image_path, image_url, is_active,
      // restaurant_id, sort_order — e nenhum deles e titulo, nome, subtitulo ou
      // descricao. Ate 02/09/2026 esta normalizacao publicava
      // `title: banner.title || banner.name || ''` e o par dele para subtitulo:
      // duas chaves que valiam '' em 100% das respostas, e que faziam quem le
      // este arquivo acreditar que existe texto de banner vindo da API.
      // Quem escreve o alt do hero e o nome do restaurante, que existe.
      banners: sourceBanners
        .filter(banner => banner.is_active !== false)
        .map((banner, index) => ({
          ...banner,
          id: banner.id || `banner-${index}`,
          image_url: banner.image_url || banner.image_path || '',
          image_path: banner.image_path || banner.image_url || '',
          sort_order: Number(banner.sort_order ?? index) // 0 e ordem
        }))
        .sort((a, b) => a.sort_order - b.sort_order),
      highlight_banners: sourceHighlightBanners
        .filter(banner => banner.is_active !== false)
        .map((banner, index) => ({
          ...banner,
          id: banner.id || `highlight-${index}`,
          image_url: banner.image_url || banner.image_path || '',
          image_path: banner.image_path || banner.image_url || '',
          sort_order: Number(banner.sort_order ?? index) // 0 e ordem
        }))
        .sort((a, b) => a.sort_order - b.sort_order),
      // Home keeps the legacy public menu feed as its source. Do not apply
      // customer eligibility rules here: those belong exclusively to the
      // Club view and /coupons/available.
      coupons: Array.isArray(raw.coupons)
        ? raw.coupons.filter(coupon => coupon.is_active !== false)
        : [],
      categories,
      products
    };
  }

  window.PedeAquiMenuService = { getRestaurantMenu, normalizeMenuPayload };
})();
