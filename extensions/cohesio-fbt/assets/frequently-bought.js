(function () {
  "use strict";

  var ENDPOINT = "/apps/cohesio/paires";

  function formatPrice(amount, currencyCode) {
    var value = Number(amount);
    if (!currencyCode || !isFinite(value)) {
      return null;
    }
    var locale = document.documentElement.lang || undefined;
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: currencyCode,
      }).format(value);
    } catch (error) {
      return null;
    }
  }

  function buildMedia(item) {
    var media = document.createElement("div");
    media.className = "cohesio-fbt__media";

    if (item.imageUrl) {
      var image = document.createElement("img");
      image.className = "cohesio-fbt__image";
      image.src = item.imageUrl;
      image.alt = item.title || "";
      image.loading = "lazy";
      image.width = 300;
      image.height = 300;
      media.appendChild(image);
    } else {
      // Carré neutre avec l'initiale du titre quand le produit n'a pas d'image.
      var placeholder = document.createElement("span");
      placeholder.className = "cohesio-fbt__placeholder";
      placeholder.setAttribute("aria-hidden", "true");
      placeholder.textContent = (item.title || "?").trim().charAt(0).toUpperCase();
      media.appendChild(placeholder);
    }

    return media;
  }

  function buildCard(item, showPrices) {
    var card = document.createElement("li");
    card.className = "cohesio-fbt__card";

    var link = document.createElement("a");
    link.className = "cohesio-fbt__link";
    link.href = item.url;
    link.appendChild(buildMedia(item));

    var title = document.createElement("span");
    title.className = "cohesio-fbt__product-title";
    title.textContent = item.title;
    link.appendChild(title);

    if (showPrices) {
      var formatted = formatPrice(item.price, item.currencyCode);
      if (formatted) {
        var price = document.createElement("span");
        price.className = "cohesio-fbt__price";
        price.textContent = formatted;
        link.appendChild(price);
      }
    }

    card.appendChild(link);
    return card;
  }

  // N'accepte que des chemins relatifs de la boutique (/products/...).
  function isValidItem(item) {
    return (
      item &&
      typeof item.title === "string" &&
      typeof item.url === "string" &&
      item.url.indexOf("/products/") === 0
    );
  }

  function load(container) {
    if (container.getAttribute("data-cohesio-loaded")) {
      return;
    }
    container.setAttribute("data-cohesio-loaded", "true");

    var productId = container.getAttribute("data-product-id");
    var max = parseInt(container.getAttribute("data-max-products"), 10) || 3;
    var showPrices = container.getAttribute("data-show-prices") === "true";
    var grid = container.querySelector(".cohesio-fbt__grid");
    if (!productId || !grid) {
      return;
    }

    fetch(ENDPOINT + "?product_id=" + encodeURIComponent(productId), {
      headers: { Accept: "application/json" },
    })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (body) {
        var items =
          body && Array.isArray(body.recommendations)
            ? body.recommendations.filter(isValidItem).slice(0, max)
            : [];
        if (items.length === 0) {
          return;
        }

        grid.replaceChildren();
        items.forEach(function (item) {
          grid.appendChild(buildCard(item, showPrices));
        });
        grid.style.setProperty("--cohesio-fbt-columns", String(items.length));
        container.hidden = false;
      })
      .catch(function () {
        // Erreur réseau ou réponse illisible : le bloc reste caché.
      });
  }

  function init() {
    document.querySelectorAll("[data-cohesio-fbt]").forEach(load);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Éditeur de thème : le bloc est re-rendu quand ses réglages changent.
  document.addEventListener("shopify:section:load", init);
  document.addEventListener("shopify:block:select", init);
})();
