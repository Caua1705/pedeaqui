(function () {
  function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function fullAddress(branch = {}) {
    const address = branch.address && typeof branch.address === 'object' ? branch.address : {};
    return address.full_address
      || branch.full_address
      || [
        address.street || branch.address,
        address.number,
        address.neighborhood || branch.neighborhood,
        address.city || branch.city,
        address.state || branch.state
      ].filter(Boolean).join(', ');
  }

  function normalizeDelivery(delivery) {
    if (delivery === null || delivery === undefined) return null;
    return {
      ...delivery,
      delivers_to_address: delivery.delivers_to_address === true,
      distance_km: numberOrNull(delivery.distance_km),
      travel_time_min: numberOrNull(delivery.travel_time_min),
      delivery_fee: numberOrNull(delivery.delivery_fee),
      eta_min: numberOrNull(delivery.eta_min),
      eta_max: numberOrNull(delivery.eta_max)
    };
  }

  function normalizeAvailability(raw = {}) {
    const source = Array.isArray(raw.branches) ? raw.branches : [];
    return {
      restaurant_slug: raw.restaurant_slug || '',
      address_provided: raw.address_provided === true,
      default_branch_id: raw.default_branch_id || null,
      branches: source.map((branch, index) => ({
        ...branch,
        id: String(branch.id || branch.branch_id || index),
        name: branch.display_name || branch.name || '',
        branch_name: branch.name || '',
        label: branch.display_name || branch.name || '',
        full_address: fullAddress(branch),
        neighborhood: branch.address?.neighborhood || branch.neighborhood || '',
        city: branch.address?.city || branch.city || '',
        state: branch.address?.state || branch.state || '',
        is_open: branch.is_open_now === true,
        delivery: normalizeDelivery(branch.delivery)
      }))
    };
  }

  async function getAvailability(restaurantSlug, payload = {}) {
    const headers = window.PedeAquiCustomerAuth?.authHeaders?.() || {};
    const response = await window.PedeAquiApiClient.request(
      window.PedeAquiApiRoutes.branchAvailability(restaurantSlug),
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      }
    );
    return normalizeAvailability(response);
  }

  window.PedeAquiBranchAvailabilityService = {
    getAvailability,
    normalizeAvailability
  };
})();
