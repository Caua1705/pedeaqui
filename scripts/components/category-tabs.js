(function () {
  function toCategoryTabs(categories) {
    return categories.map(category => ({ id: category.id, label: category.name }));
  }

  window.PedeAquiCategoryTabs = { toCategoryTabs };
})();
