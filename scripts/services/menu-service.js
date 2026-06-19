(function () {
  const slugify = text => window.PedeAquiSlugify?.slugify(text) || String(text || '').toLowerCase().replace(/\s+/g, '-');
  const fallback = () => window.PedeAquiFallbackConfig || {};

  async function getRestaurantMenu(slug) {
    return normalizeMenuPayload(await window.PedeAquiApi.getRestaurantMenu(slug));
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
      sort_order: Number(category.sort_order || index)
    })).sort((a, b) => a.sort_order - b.sort_order);

    const categoryById = new Map(categories.map(category => [String(category.id), category]));
    const categoryBySlug = new Map(categories.map(category => [String(category.slug), category]));

    const products = sourceProducts.map((product, index) => {
      const categoryId = String(product.category_id || product.category_slug || product.category || '');
      const category = categoryById.get(categoryId) || categoryBySlug.get(categoryId) || categoryBySlug.get(slugify(product.category));
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
        sort_order: Number(product.sort_order || index)
      };
    }).sort((a, b) => a.sort_order - b.sort_order);

    return {
      restaurant: raw.restaurant || {},
      settings: raw.settings || {},
      branches: normalizeBranches(raw),
      banners: sourceBanners
        .filter(banner => banner.is_active !== false)
        .map((banner, index) => ({
          ...banner,
          id: banner.id || banner.uuid || `banner-${index}`,
          title: banner.title || banner.name || '',
          subtitle: banner.subtitle || banner.description || '',
          image_url: banner.image_url || banner.imageUrl || banner.image || banner.image_path || '',
          image_path: banner.image_path || banner.image || banner.image_url || banner.imageUrl || '',
          sort_order: Number(banner.sort_order || banner.order || index)
        }))
        .sort((a, b) => a.sort_order - b.sort_order),
      highlight_banners: sourceHighlightBanners
        .filter(banner => banner.is_active !== false)
        .map((banner, index) => ({
          ...banner,
          id: banner.id || banner.uuid || `highlight-${index}`,
          title: banner.title || banner.name || '',
          subtitle: banner.subtitle || banner.description || '',
          image_url: banner.image_url || banner.imageUrl || banner.image || banner.image_path || '',
          image_path: banner.image_path || banner.image || banner.image_url || banner.imageUrl || '',
          sort_order: Number(banner.sort_order || banner.order || index)
        }))
        .sort((a, b) => a.sort_order - b.sort_order),
      coupons: Array.isArray(raw.coupons)
        ? raw.coupons.filter(coupon => {
          const type = String(coupon.discount_type || '').toLowerCase();
          return coupon.is_active !== false && !['cashback', 'club', 'wallet'].includes(type);
        })
        : [],
      categories,
      products
    };
  }

  window.PedeAquiMenuService = { getRestaurantMenu, normalizeMenuPayload };
})();
