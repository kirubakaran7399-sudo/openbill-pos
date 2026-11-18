/**
 * src/core/cart.js
 * The Retro Cafeteria POS — Pure Cart & Order Items Engine
 * Immutability, boundary checks, kitchen dispatch tracking and safe quantity handling
 */

/**
 * Escapes HTML characters to prevent XSS.
 * @param {string} str 
 * @returns {string}
 */
function sanitizeText(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Creates a validated cart item object.
 * @param {object} params
 * @returns {object}
 */
function createCartItem(params) {
  if (!params || typeof params !== "object") {
    throw new Error("Invalid cart item specification");
  }

  const dishId = String(params.dishId || params.id || "").trim();
  if (!dishId) {
    throw new Error("Dish ID is required");
  }

  const name = sanitizeText(String(params.name || "Unnamed Item"));
  const shortCode = String(params.shortCode || params.code || "").toUpperCase().trim();
  const basePrice = Math.max(0, parseFloat(params.basePrice || params.price || 0) || 0);
  const qty = Math.max(1, parseInt(params.qty, 10) || 1);
  const note = sanitizeText(String(params.note || ""));
  const diet = params.diet === "veg" ? "veg" : "non-veg";
  const category = sanitizeText(String(params.category || "General"));
  const gstRate = parseFloat(params.gstRate || 5.0) || 5.0;

  // Addons processing
  let addonsList = [];
  let addonsCost = 0;
  if (Array.isArray(params.addons)) {
    params.addons.forEach(a => {
      if (typeof a === "object" && a !== null) {
        const aName = sanitizeText(String(a.name || "Addon"));
        const aPrice = Math.max(0, parseFloat(a.price || 0) || 0);
        addonsList.push(`${aName} (+₹${aPrice})`);
        addonsCost += aPrice;
      } else if (typeof a === "string") {
        addonsList.push(sanitizeText(a));
      }
    });
  }

  const unitPrice = Math.round((basePrice + addonsCost) * 100) / 100;

  return {
    id: params.id && !params.id.startsWith("temp_") ? params.id : `${dishId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    dishId,
    name,
    shortCode,
    category,
    basePrice,
    unitPrice,
    addons: addonsList,
    addonsCost,
    qty,
    note,
    diet,
    gstRate,
    sentToKitchen: Boolean(params.sentToKitchen),
    addedAt: params.addedAt || new Date().toISOString()
  };
}

/**
 * Adds an item to the cart, aggregating quantity if identical item exists (and not yet sent to kitchen).
 * Returns a new cart array (pure function).
 * @param {Array} cart 
 * @param {object} rawItem 
 * @returns {Array}
 */
function addItemToCart(cart, rawItem) {
  const item = createCartItem(rawItem);
  const currentCart = Array.isArray(cart) ? [...cart] : [];

  const addonsKey = (item.addons || []).join("|");
  // Check if identical unprinted item already in cart
  const existingIdx = currentCart.findIndex(it => 
    it.dishId === item.dishId &&
    it.name === item.name &&
    it.unitPrice === item.unitPrice &&
    (it.addons || []).join("|") === addonsKey &&
    (it.note || "") === item.note &&
    !it.sentToKitchen // If already sent to kitchen, start a new round line
  );

  if (existingIdx >= 0) {
    const existing = { ...currentCart[existingIdx] };
    existing.qty += item.qty;
    currentCart[existingIdx] = existing;
  } else {
    currentCart.push(item);
  }

  return currentCart;
}

/**
 * Updates quantity of a specific cart item. Removes item if qty <= 0.
 * @param {Array} cart 
 * @param {string} itemId 
 * @param {number} delta Change in quantity (+1 or -1)
 * @returns {Array}
 */
function updateCartItemQty(cart, itemId, delta) {
  if (!Array.isArray(cart)) return [];
  const nextCart = [];

  for (const item of cart) {
    if (item.id === itemId) {
      const newQty = item.qty + delta;
      if (newQty > 0) {
        nextCart.push({ ...item, qty: newQty });
      }
      // If newQty <= 0, item is omitted (deleted)
    } else {
      nextCart.push(item);
    }
  }

  return nextCart;
}

/**
 * Removes an item completely from cart.
 * @param {Array} cart 
 * @param {string} itemId 
 * @returns {Array}
 */
function removeCartItem(cart, itemId) {
  if (!Array.isArray(cart)) return [];
  return cart.filter(item => item.id !== itemId);
}

/**
 * Updates notes on a specific cart item.
 * @param {Array} cart 
 * @param {string} itemId 
 * @param {string} note 
 * @returns {Array}
 */
function updateCartItemNote(cart, itemId, note) {
  if (!Array.isArray(cart)) return [];
  return cart.map(item => {
    if (item.id === itemId) {
      return { ...item, note: sanitizeText(note) };
    }
    return item;
  });
}

/**
 * Marks all unsent items in cart as sent to kitchen (after printing KOT).
 * @param {Array} cart 
 * @returns {Array}
 */
function markItemsSentToKitchen(cart) {
  if (!Array.isArray(cart)) return [];
  return cart.map(item => ({ ...item, sentToKitchen: true }));
}

/**
 * Gets the unsent items for printing a kitchen slip.
 * @param {Array} cart 
 * @returns {Array}
 */
function getUnsentKitchenItems(cart) {
  if (!Array.isArray(cart)) return [];
  return cart.filter(item => !item.sentToKitchen);
}

/**
 * Calculates raw subtotal of items in cart.
 * @param {Array} cart 
 * @returns {number}
 */
function calculateCartSubtotal(cart) {
  if (!Array.isArray(cart)) return 0;
  return cart.reduce((sum, item) => {
    const q = item.qty || 1;
    const p = item.unitPrice || item.basePrice || 0;
    return sum + (q * p);
  }, 0);
}

// Module export for Node.js test runner and browser window
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    sanitizeText,
    createCartItem,
    addItemToCart,
    updateCartItemQty,
    removeCartItem,
    updateCartItemNote,
    markItemsSentToKitchen,
    getUnsentKitchenItems,
    calculateCartSubtotal
  };
}
if (typeof window !== "undefined") {
  window.PosCart = {
    sanitizeText,
    createCartItem,
    addItemToCart,
    updateCartItemQty,
    removeCartItem,
    updateCartItemNote,
    markItemsSentToKitchen,
    getUnsentKitchenItems,
    calculateCartSubtotal
  };
}
