(function () {
  function toProductCard(product) {
    return {
      id: product.id,
      name: product.name,
      description: product.description || product.desc || '',
      price: product.price,
      imagePath: product.image_path || null
    };
  }

  window.PedeAquiProductCard = { toProductCard };
})();
