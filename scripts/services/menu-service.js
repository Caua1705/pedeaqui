(function () {
  const slugify = text => window.PedeAquiSlugify?.slugify(text) || String(text || '').toLowerCase().replace(/\s+/g, '-');

  async function getRestaurantMenu(slug) {
    return normalizeMenuPayload(await window.PedeAquiApi.getRestaurantMenu(slug));
  }

  function normalizeMenuPayload(raw = {}) {
    let sourceCategories = Array.isArray(raw.categories) ? raw.categories : [];
    let sourceProducts = Array.isArray(raw.products) ? raw.products : [];

    if ((!sourceCategories.length || !sourceProducts.length) && raw.menu) {
      const menuList = Array.isArray(raw.menu) ? raw.menu : Object.values(raw.menu).filter(section => section && Array.isArray(section.items));
      sourceCategories = menuList.map((section, index) => ({
        id: slugify(section.category || index),
        name: section.category || 'Categoria',
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
      name: category.name || category.category || 'Categoria',
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
        name: product.name || 'Produto',
        slug: product.slug || slugify(product.name || product.id || index),
        description: product.description || product.desc || '',
        price: typeof product.price === 'number' ? product.price : Number(product.price),
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
      branches: Array.isArray(raw.branches) ? raw.branches : [],
      banners: Array.isArray(raw.banners) ? raw.banners.filter(banner => banner.is_active !== false) : [],
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
