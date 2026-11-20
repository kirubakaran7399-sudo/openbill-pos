/**
 * src/core/inventory.js
 * The Retro Cafeteria POS — Pure Inventory, Raw Materials & Recipe BOM Engine
 * 
 * Capabilities:
 * 1. Raw Materials & Ingredients Catalog with UOM & Reorder Thresholds
 * 2. Recipe / Bill of Materials (BOM) Auto-Deduction on Dish Settlement
 * 3. Stock Inward / Purchase Entry (GRN) with Weighted Cost Updating
 * 4. Kitchen Wastage & Spoilage Logging with Financial Loss Calculation
 * 5. Physical Stock Audit & Variance Reconciliation
 * 6. Inventory Valuation & Reorder Alerts
 * 
 * Optimized per REA analysis guidelines: O(1) indexed lookups, bounded memory,
 * immutable math, and zero external runtime dependencies.
 */

/**
 * Valid Units of Measurement for restaurant inventory.
 */
const VALID_UOMS = ["pcs", "kg", "gm", "ltr", "ml", "pkts", "boxes", "cans", "portions"];

/**
 * Standard wastage reasons for kitchen audit.
 */
const WASTAGE_REASONS = [
  "Expired / Shelf Life",
  "Burnt / Kitchen Error",
  "Dropped / Damaged",
  "Spoiled / Raw Quality Issue",
  "Customer Return / Replaced",
  "Tasting / Quality Audit",
  "Spillage / Evaporation"
];

/**
 * Sanitizes input text for safe HTML rendering.
 */
function sanitizeInvText(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Creates and validates a raw material inventory item.
 * @param {object} params 
 * @returns {object} Validated inventory item
 */
function createInventoryItem(params) {
  if (!params || typeof params !== "object") {
    throw new Error("Invalid inventory item specification");
  }

  const id = String(params.id || `raw_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`).trim();
  const name = sanitizeInvText(String(params.name || "").trim());
  if (!name) {
    throw new Error("Raw material name is required");
  }

  const code = String(params.code || params.sku || "").toUpperCase().trim() || "RAW";
  const category = sanitizeInvText(String(params.category || "General").trim());
  
  let uom = String(params.uom || "pcs").toLowerCase().trim();
  if (!VALID_UOMS.includes(uom)) {
    uom = "pcs";
  }

  const currentStock = Math.max(0, parseFloat(params.currentStock !== undefined ? params.currentStock : params.stockQty) || 0);
  const minStock = Math.max(0, parseFloat(params.minStock !== undefined ? params.minStock : params.minStockLevel) || 0);
  const unitCost = Math.max(0, parseFloat(params.unitCost) || 0);
  const supplier = sanitizeInvText(String(params.supplier || "").trim());

  return {
    id,
    name,
    code,
    category,
    uom,
    currentStock,
    stockQty: currentStock,
    minStock,
    minStockLevel: minStock,
    unitCost,
    supplier,
    updatedAt: params.updatedAt || new Date().toISOString()
  };
}

/**
 * Retrieves the recipe (BOM) for a specific menu dish.
 * @param {Array|object} recipes Map or array of recipes
 * @param {string} dishId 
 * @returns {object|null} Recipe object { dishId, ingredients: [{ itemId, qty }] }
 */
function getRecipeForDish(recipes, dishId) {
  if (!recipes || !dishId) return null;
  if (Array.isArray(recipes)) {
    return recipes.find(r => r.dishId === dishId) || null;
  }
  return recipes[dishId] || null;
}

/**
 * Sets or updates a recipe (Bill of Materials) for a dish.
 * @param {Array} recipes 
 * @param {string} dishId 
 * @param {Array} ingredients [{ itemId: string, qty: number }]
 * @returns {Array} Updated recipes array
 */
function setDishRecipe(recipes, dishId, ingredients) {
  if (!dishId) throw new Error("Dish ID is required for recipe");
  const cleanList = Array.isArray(recipes) ? [...recipes] : [];
  
  const validIngredients = (Array.isArray(ingredients) ? ingredients : [])
    .filter(ing => ing && ing.itemId && parseFloat(ing.qty) > 0)
    .map(ing => ({
      itemId: String(ing.itemId).trim(),
      qty: Math.max(0.0001, parseFloat(ing.qty) || 0)
    }));

  const existingIdx = cleanList.findIndex(r => r.dishId === dishId);
  if (validIngredients.length === 0) {
    // If ingredients empty, remove the recipe
    if (existingIdx >= 0) cleanList.splice(existingIdx, 1);
    return cleanList;
  }

  const recipeEntry = {
    dishId,
    ingredients: validIngredients,
    updatedAt: new Date().toISOString()
  };

  if (existingIdx >= 0) {
    cleanList[existingIdx] = recipeEntry;
  } else {
    cleanList.push(recipeEntry);
  }

  return cleanList;
}

/**
 * Calculates preparation cost of a dish based on its recipe and ingredient unit costs.
 * @param {object} recipe 
 * @param {Array} inventory 
 * @returns {number} Cost price in ₹
 */
function calculateRecipeCost(recipe, inventory) {
  if (!recipe || !Array.isArray(recipe.ingredients) || !Array.isArray(inventory)) {
    return 0;
  }

  const itemMap = new Map();
  for (let i = 0; i < inventory.length; i++) {
    const it = inventory[i];
    if (it && it.id) itemMap.set(it.id, it);
  }

  let totalCost = 0;
  for (let i = 0; i < recipe.ingredients.length; i++) {
    const ing = recipe.ingredients[i];
    const item = itemMap.get(ing.itemId);
    if (item && item.unitCost) {
      totalCost += (item.unitCost * (ing.qty || 0));
    }
  }

  return Math.round(totalCost * 100) / 100;
}

/**
 * Deducts raw material inventory according to Recipe BOM for billed order items.
 * Uses O(1) indexed lookups for lightning-fast batch deductions.
 * 
 * @param {Array} inventory Current inventory items
 * @param {Array} recipes Current recipe mappings
 * @param {Array} cartItems Items settled on the bill
 * @returns {object} { updatedInventory, deductionsLog }
 */
function deductRecipeStock(inventory, recipes, cartItems) {
  if (!Array.isArray(inventory)) return { updatedInventory: [], deductionsLog: [] };
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    return { updatedInventory: [...inventory], deductionsLog: [] };
  }

  // Pre-index recipes by dishId in O(R)
  const recipeMap = new Map();
  if (Array.isArray(recipes)) {
    for (let i = 0; i < recipes.length; i++) {
      const r = recipes[i];
      if (r && r.dishId) recipeMap.set(r.dishId, r);
    }
  }

  // Deep clone inventory as map in O(I)
  const invMap = new Map();
  for (let i = 0; i < inventory.length; i++) {
    const it = inventory[i];
    if (it && it.id) {
      invMap.set(it.id, { ...it });
    }
  }

  const deductionsLog = [];
  const nowIso = new Date().toISOString();

  // Deduct based on bill items
  for (let i = 0; i < cartItems.length; i++) {
    const cartItem = cartItems[i];
    const dishId = cartItem.dishId || cartItem.id;
    const soldQty = Math.max(1, parseInt(cartItem.qty, 10) || 1);

    const recipe = recipeMap.get(dishId);
    if (recipe && Array.isArray(recipe.ingredients)) {
      for (let j = 0; j < recipe.ingredients.length; j++) {
        const ing = recipe.ingredients[j];
        const rawItem = invMap.get(ing.itemId);
        if (rawItem) {
          const consumeQty = ing.qty * soldQty;
          const oldStock = rawItem.currentStock !== undefined ? rawItem.currentStock : (rawItem.stockQty || 0);
          const newStock = Math.max(0, Math.round((oldStock - consumeQty) * 1000) / 1000);
          rawItem.currentStock = newStock;
          rawItem.stockQty = newStock;
          rawItem.updatedAt = nowIso;

          deductionsLog.push({
            dishId,
            dishName: cartItem.name || "Item",
            soldQty,
            itemId: rawItem.id,
            itemName: rawItem.name,
            uom: rawItem.uom,
            deductedQty: consumeQty,
            remainingStock: newStock,
            timestamp: nowIso
          });
        }
      }
    }
  }

  return {
    updatedInventory: Array.from(invMap.values()),
    deductionsLog
  };
}

/**
 * Restores raw material inventory when a bill is cancelled.
 * 
 * @param {Array} inventory 
 * @param {Array} recipes 
 * @param {Array} cancelledItems 
 * @returns {Array} Restored inventory array
 */
function restoreRecipeStock(inventory, recipes, cancelledItems) {
  if (!Array.isArray(inventory) || !Array.isArray(cancelledItems) || cancelledItems.length === 0) {
    return Array.isArray(inventory) ? [...inventory] : [];
  }

  const recipeMap = new Map();
  if (Array.isArray(recipes)) {
    for (let i = 0; i < recipes.length; i++) {
      const r = recipes[i];
      if (r && r.dishId) recipeMap.set(r.dishId, r);
    }
  }

  const invMap = new Map();
  for (let i = 0; i < inventory.length; i++) {
    const it = inventory[i];
    if (it && it.id) invMap.set(it.id, { ...it });
  }

  const nowIso = new Date().toISOString();

  for (let i = 0; i < cancelledItems.length; i++) {
    const cartItem = cancelledItems[i];
    const dishId = cartItem.dishId || cartItem.id;
    const qty = Math.max(1, parseInt(cartItem.qty, 10) || 1);

    const recipe = recipeMap.get(dishId);
    if (recipe && Array.isArray(recipe.ingredients)) {
      for (let j = 0; j < recipe.ingredients.length; j++) {
        const ing = recipe.ingredients[j];
        const rawItem = invMap.get(ing.itemId);
        if (rawItem) {
          const restoreQty = ing.qty * qty;
          const oldStock = rawItem.currentStock !== undefined ? rawItem.currentStock : (rawItem.stockQty || 0);
          const newStock = Math.round((oldStock + restoreQty) * 1000) / 1000;
          rawItem.currentStock = newStock;
          rawItem.stockQty = newStock;
          rawItem.updatedAt = nowIso;
        }
      }
    }
  }

  return Array.from(invMap.values());
}

/**
 * Records a Stock Inward shipment / purchase entry (GRN).
 * Updates inventory levels and weighted-average unit costs.
 * 
 * @param {Array} inventory 
 * @param {object} inwardParams { supplier, invoiceNo, date, items: [{ itemId, qty, unitCost }] }
 * @returns {object} { updatedInventory, inwardRecord }
 */
function recordStockInward(inventory, inwardParams) {
  if (!Array.isArray(inventory)) inventory = [];
  if (!inwardParams || typeof inwardParams !== "object") {
    throw new Error("Invalid inward parameters");
  }

  const invMap = new Map();
  for (let i = 0; i < inventory.length; i++) {
    const it = inventory[i];
    if (it && it.id) invMap.set(it.id, { ...it });
  }

  const items = Array.isArray(inwardParams.items) ? inwardParams.items : [];
  if (items.length === 0) {
    throw new Error("Inward shipment must contain at least one item line");
  }

  const processedLines = [];
  let totalInwardAmount = 0;
  const nowIso = new Date().toISOString();

  items.forEach(line => {
    const itemId = String(line.itemId || "").trim();
    const qty = Math.max(0, parseFloat(line.qty) || 0);
    const unitCost = Math.max(0, parseFloat(line.unitCost) || 0);
    if (!itemId || qty <= 0) return;

    const rawItem = invMap.get(itemId);
    if (!rawItem) return;

    const lineTotal = Math.round(qty * unitCost * 100) / 100;
    totalInwardAmount += lineTotal;

    const oldStock = rawItem.currentStock !== undefined ? rawItem.currentStock : (rawItem.stockQty || 0);
    const oldCost = rawItem.unitCost || 0;
    const newStock = Math.round((oldStock + qty) * 1000) / 1000;

    // Weighted average cost update if new stock > 0
    let updatedCost = unitCost > 0 ? unitCost : oldCost;
    if (newStock > 0 && unitCost > 0) {
      updatedCost = Math.round(((oldStock * oldCost) + (qty * unitCost)) / newStock * 100) / 100;
    }

    rawItem.currentStock = newStock;
    rawItem.stockQty = newStock;
    rawItem.unitCost = updatedCost;
    rawItem.updatedAt = nowIso;
    if (inwardParams.supplier) {
      rawItem.supplier = sanitizeInvText(inwardParams.supplier);
    }

    processedLines.push({
      itemId: rawItem.id,
      name: rawItem.name,
      uom: rawItem.uom,
      qty,
      unitCost,
      lineTotal
    });
  });

  const inwardRecord = {
    id: `grn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    date: inwardParams.date || new Date().toISOString().split("T")[0],
    invoiceNo: sanitizeInvText(String(inwardParams.invoiceNo || "").trim()) || "DIRECT-INWARD",
    supplier: sanitizeInvText(String(inwardParams.supplier || "Direct Vendor").trim()),
    items: processedLines,
    totalAmount: Math.round(totalInwardAmount * 100) / 100,
    createdAt: nowIso
  };

  return {
    updatedInventory: Array.from(invMap.values()),
    inwardRecord
  };
}

/**
 * Records kitchen wastage, spoilage or damaged items with financial loss tracking.
 * 
 * @param {Array} inventory 
 * @param {object} wastageParams { itemId, qty, reason, reportedBy, note }
 * @returns {object} { updatedInventory, wastageRecord }
 */
function recordStockWastage(inventory, wastageParams) {
  if (!Array.isArray(inventory)) inventory = [];
  if (!wastageParams || !wastageParams.itemId) {
    throw new Error("Item ID is required to record wastage");
  }

  const itemId = String(wastageParams.itemId).trim();
  const qty = Math.max(0.001, parseFloat(wastageParams.qty) || 0);

  const invMap = new Map();
  for (let i = 0; i < inventory.length; i++) {
    const it = inventory[i];
    if (it && it.id) invMap.set(it.id, { ...it });
  }

  const item = invMap.get(itemId);
  if (!item) {
    throw new Error(`Inventory item "${itemId}" not found`);
  }

  const oldStock = item.currentStock !== undefined ? item.currentStock : (item.stockQty || 0);
  const newStock = Math.max(0, Math.round((oldStock - qty) * 1000) / 1000);
  item.currentStock = newStock;
  item.stockQty = newStock;
  item.updatedAt = new Date().toISOString();

  const costLoss = Math.round(qty * (item.unitCost || 0) * 100) / 100;

  const wastageRecord = {
    id: `wst_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    date: wastageParams.date || new Date().toISOString().split("T")[0],
    itemId: item.id,
    itemName: item.name,
    category: item.category,
    uom: item.uom,
    qty,
    unitCost: item.unitCost || 0,
    costLoss,
    reason: sanitizeInvText(String(wastageParams.reason || "Damaged").trim()),
    reportedBy: sanitizeInvText(String(wastageParams.reportedBy || "Kitchen Staff").trim()),
    note: sanitizeInvText(String(wastageParams.note || "").trim()),
    createdAt: new Date().toISOString()
  };

  return {
    updatedInventory: Array.from(invMap.values()),
    wastageRecord
  };
}

/**
 * Adjusts inventory to match physical stock count and calculates variance.
 * 
 * @param {Array} inventory 
 * @param {object} auditParams { itemId, physicalCount, reason, auditedBy }
 * @returns {object} { updatedInventory, auditRecord }
 */
function reconcilePhysicalStock(inventory, auditParams) {
  if (!Array.isArray(inventory)) inventory = [];
  if (!auditParams || !auditParams.itemId) {
    throw new Error("Item ID is required for stock reconciliation");
  }

  const itemId = String(auditParams.itemId).trim();
  const physicalCount = Math.max(0, parseFloat(auditParams.physicalCount) || 0);

  const invMap = new Map();
  for (let i = 0; i < inventory.length; i++) {
    const it = inventory[i];
    if (it && it.id) invMap.set(it.id, { ...it });
  }

  const item = invMap.get(itemId);
  if (!item) {
    throw new Error(`Inventory item "${itemId}" not found`);
  }

  const systemCount = item.currentStock !== undefined ? item.currentStock : (item.stockQty || 0);
  const variance = Math.round((physicalCount - systemCount) * 1000) / 1000;
  const varianceCost = Math.round(variance * (item.unitCost || 0) * 100) / 100;

  item.currentStock = physicalCount;
  item.stockQty = physicalCount;
  item.updatedAt = new Date().toISOString();

  const auditRecord = {
    id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    date: auditParams.date || new Date().toISOString().split("T")[0],
    itemId: item.id,
    itemName: item.name,
    uom: item.uom,
    systemCount,
    physicalCount,
    variance,
    varianceCost,
    reason: sanitizeInvText(String(auditParams.reason || "Physical Count Verification").trim()),
    auditedBy: sanitizeInvText(String(auditParams.auditedBy || "Manager").trim()),
    createdAt: new Date().toISOString()
  };

  return {
    updatedInventory: Array.from(invMap.values()),
    auditRecord
  };
}

/**
 * Calculates current total inventory valuation and health metrics.
 * @param {Array} inventory 
 * @returns {object} { totalItems, totalValuation, lowStockCount, outOfStockCount }
 */
function calculateInventoryValuation(inventory) {
  if (!Array.isArray(inventory)) {
    return { totalItems: 0, totalValuation: 0, lowStockCount: 0, outOfStockCount: 0 };
  }

  let totalValuation = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;

  for (let i = 0; i < inventory.length; i++) {
    const it = inventory[i];
    if (!it) continue;
    const stock = it.currentStock !== undefined ? it.currentStock : (it.stockQty || 0);
    const min = it.minStock !== undefined ? it.minStock : (it.minStockLevel || 5);
    const cost = it.unitCost || 0;
    totalValuation += (stock * cost);

    if (stock <= 0) {
      outOfStockCount++;
      lowStockCount++;
    } else if (stock <= min) {
      lowStockCount++;
    }
  }

  return {
    totalItems: inventory.length,
    totalValuation: Math.round(totalValuation * 100) / 100,
    lowStockCount,
    outOfStockCount
  };
}

/**
 * Returns list of raw materials that need immediate reordering.
 * @param {Array} inventory 
 * @returns {Array} Low stock items
 */
function getLowStockItems(inventory) {
  if (!Array.isArray(inventory)) return [];
  return inventory.filter(it => {
    if (!it) return false;
    const stock = it.currentStock !== undefined ? it.currentStock : (it.stockQty || 0);
    const min = it.minStock !== undefined ? it.minStock : (it.minStockLevel || 0);
    return stock <= min;
  });
}

/**
 * Exports inventory report to accountant-ready CSV string.
 * @param {Array} inventory 
 * @returns {string} CSV format
 */
function exportInventoryCSV(inventory) {
  if (!Array.isArray(inventory) || inventory.length === 0) {
    return "Code,Item Name,Category,Unit,Current Stock,Min Reorder Level,Unit Cost (INR),Total Value (INR),Supplier\n";
  }

  const rows = [
    ["Code", "Item Name", "Category", "Unit", "Current Stock", "Min Reorder Level", "Unit Cost (INR)", "Total Value (INR)", "Supplier"]
  ];

  inventory.forEach(it => {
    const stock = it.currentStock !== undefined ? it.currentStock : (it.stockQty || 0);
    const min = it.minStock !== undefined ? it.minStock : (it.minStockLevel || 0);
    const cost = it.unitCost || 0;
    const val = Math.round(stock * cost * 100) / 100;

    rows.push([
      `"${(it.code || '').replace(/"/g, '""')}"`,
      `"${(it.name || '').replace(/"/g, '""')}"`,
      `"${(it.category || '').replace(/"/g, '""')}"`,
      it.uom || 'pcs',
      stock,
      it.minStock || 0,
      cost.toFixed(2),
      val.toFixed(2),
      `"${(it.supplier || '').replace(/"/g, '""')}"`
    ]);
  });

  return rows.map(r => r.join(",")).join("\n");
}

/**
 * Official default raw materials for The Retro Cafeteria.
 */
const SAMPLE_INVENTORY_ITEMS = [
  { id: "raw_bun", name: "Sesame Burger Buns", code: "BUN-01", category: "Bakery", uom: "pcs", currentStock: 80, stockQty: 80, minStock: 25, minStockLevel: 25, unitCost: 8.50, supplier: "Fresh Daily Bakery" },
  { id: "raw_chick_patty", name: "Chicken Burger Patties", code: "PATTY-CHICK", category: "Poultry & Meat", uom: "pcs", currentStock: 65, stockQty: 65, minStock: 20, minStockLevel: 20, unitCost: 35.00, supplier: "Apex Cold Chain" },
  { id: "raw_veg_patty", name: "Veg Crispy Patties", code: "PATTY-VEG", category: "Produce", uom: "pcs", currentStock: 50, stockQty: 50, minStock: 15, minStockLevel: 15, unitCost: 18.00, supplier: "Apex Cold Chain" },
  { id: "raw_cheese_slice", name: "Cheddar Cheese Slices", code: "CHEESE-SL", category: "Dairy", uom: "pcs", currentStock: 120, stockQty: 120, minStock: 30, minStockLevel: 30, unitCost: 11.00, supplier: "Amul Dairy Distributor" },
  { id: "raw_fries_bag", name: "French Fries (Frozen 2.5kg)", code: "FRIES-FROZEN", category: "Produce", uom: "kg", currentStock: 18.5, stockQty: 18.5, minStock: 5.0, minStockLevel: 5.0, unitCost: 140.00, supplier: "McCain Foodservice" },
  { id: "raw_peri_season", name: "Peri Peri Seasoning", code: "SPICE-PERI", category: "Sauces & Condiments", uom: "gm", currentStock: 1500, stockQty: 1500, minStock: 300, minStockLevel: 300, unitCost: 0.45, supplier: "Keya Spices" },
  { id: "raw_retro_sauce", name: "Retro Secret Mayo Sauce", code: "SAUCE-MAYO", category: "Sauces & Condiments", uom: "gm", currentStock: 4200, stockQty: 4200, minStock: 1000, minStockLevel: 1000, unitCost: 0.25, supplier: "Veeba Food Services" },
  { id: "raw_pita", name: "Shawarma Pita Bread", code: "PITA-BREAD", category: "Bakery", uom: "pcs", currentStock: 45, stockQty: 45, minStock: 15, minStockLevel: 15, unitCost: 12.00, supplier: "Arabian Breads" },
  { id: "raw_shawarma_meat", name: "Marinated Chicken Thighs", code: "CHICK-SHAW", category: "Poultry & Meat", uom: "kg", currentStock: 12.0, stockQty: 12.0, minStock: 3.5, minStockLevel: 3.5, unitCost: 260.00, supplier: "Halal Fresh Cuts" },
  { id: "raw_pizza_base", name: "Pizza Crust (7 Inch Thin)", code: "PIZZA-BASE", category: "Bakery", uom: "pcs", currentStock: 35, stockQty: 35, minStock: 10, minStockLevel: 10, unitCost: 22.00, supplier: "Fresh Daily Bakery" },
  { id: "raw_mozzarella", name: "Mozzarella Diced Cheese", code: "MOZZ-CHEESE", category: "Dairy", uom: "kg", currentStock: 8.0, stockQty: 8.0, minStock: 2.0, minStockLevel: 2.0, unitCost: 380.00, supplier: "Amul Dairy Distributor" },
  { id: "raw_mojito_syrup", name: "Green Mint Mojito Syrup", code: "SYRUP-MOJITO", category: "Beverages & Syrups", uom: "ml", currentStock: 3500, stockQty: 3500, minStock: 800, minStockLevel: 800, unitCost: 0.30, supplier: "Monin India" },
  { id: "raw_soda", name: "Carbonated Club Soda (1.25L)", code: "DRINK-SODA", category: "Beverages & Syrups", uom: "ltr", currentStock: 30, stockQty: 30, minStock: 8, minStockLevel: 8, unitCost: 28.00, supplier: "Kinley Distributor" },
  { id: "raw_waffle_mix", name: "Belgian Waffle Batter Mix", code: "WAFFLE-MIX", category: "Bakery", uom: "kg", currentStock: 10.0, stockQty: 10.0, minStock: 2.5, minStockLevel: 2.5, unitCost: 165.00, supplier: "Golden Waffles Co." },
  { id: "raw_choc_fudge", name: "Dark Chocolate Truffle Sauce", code: "SAUCE-CHOC", category: "Sauces & Condiments", uom: "gm", currentStock: 2500, stockQty: 2500, minStock: 500, minStockLevel: 500, unitCost: 0.35, supplier: "Callebaut Express" },
  { id: "raw_burger_box", name: "Printed Kraft Burger Boxes", code: "PKG-BOX-BURGER", category: "Packaging", uom: "pcs", currentStock: 250, stockQty: 250, minStock: 50, minStockLevel: 50, unitCost: 4.20, supplier: "EcoPack Supplies" },
  { id: "raw_cup_straw", name: "Retro 350ml Drink Cup + Straw", code: "PKG-CUP-350", category: "Packaging", uom: "pcs", currentStock: 180, stockQty: 180, minStock: 40, minStockLevel: 40, unitCost: 5.50, supplier: "EcoPack Supplies" }
];

/**
 * Default Recipe BOM mappings linking menu dishes to raw materials.
 */
const SAMPLE_RECIPES = [
  {
    dishId: "prod_cb", // Chicken Burger
    ingredients: [
      { itemId: "raw_bun", qty: 1 },
      { itemId: "raw_chick_patty", qty: 1 },
      { itemId: "raw_cheese_slice", qty: 1 },
      { itemId: "raw_retro_sauce", qty: 25 },
      { itemId: "raw_burger_box", qty: 1 }
    ]
  },
  {
    dishId: "prod_vb", // Classic Veg Burger
    ingredients: [
      { itemId: "raw_bun", qty: 1 },
      { itemId: "raw_veg_patty", qty: 1 },
      { itemId: "raw_retro_sauce", qty: 20 },
      { itemId: "raw_burger_box", qty: 1 }
    ]
  },
  {
    dishId: "prod_pf", // Peri Peri Fries
    ingredients: [
      { itemId: "raw_fries_bag", qty: 0.16 }, // 160gm per large portion
      { itemId: "raw_peri_season", qty: 12 }  // 12gm seasoning
    ]
  },
  {
    dishId: "prod_sf", // Salted Fries Regular
    ingredients: [
      { itemId: "raw_fries_bag", qty: 0.12 }  // 120gm per portion
    ]
  },
  {
    dishId: "prod_mm", // Mint Mojito
    ingredients: [
      { itemId: "raw_mojito_syrup", qty: 35 }, // 35ml
      { itemId: "raw_soda", qty: 0.22 },       // 220ml
      { itemId: "raw_cup_straw", qty: 1 }
    ]
  },
  {
    dishId: "prod_cs", // Retro Chicken Shawarma
    ingredients: [
      { itemId: "raw_pita", qty: 1 },
      { itemId: "raw_shawarma_meat", qty: 0.14 }, // 140gm chicken
      { itemId: "raw_retro_sauce", qty: 30 }
    ]
  },
  {
    dishId: "prod_mp", // Margherita Pizza
    ingredients: [
      { itemId: "raw_pizza_base", qty: 1 },
      { itemId: "raw_mozzarella", qty: 0.11 } // 110gm cheese
    ]
  },
  {
    dishId: "prod_cw", // Belgian Chocolate Waffle
    ingredients: [
      { itemId: "raw_waffle_mix", qty: 0.10 }, // 100gm mix
      { itemId: "raw_choc_fudge", qty: 35 }    // 35gm fudge
    ]
  }
];

// Module exports for Node.js test runner and browser window
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    VALID_UOMS,
    WASTAGE_REASONS,
    createInventoryItem,
    getRecipeForDish,
    setDishRecipe,
    calculateRecipeCost,
    deductRecipeStock,
    restoreRecipeStock,
    recordStockInward,
    recordStockWastage,
    reconcilePhysicalStock,
    calculateInventoryValuation,
    getLowStockItems,
    exportInventoryCSV,
    SAMPLE_INVENTORY_ITEMS,
    SAMPLE_RECIPES
  };
}

if (typeof window !== "undefined") {
  window.PosInventory = {
    VALID_UOMS,
    WASTAGE_REASONS,
    createInventoryItem,
    getRecipeForDish,
    setDishRecipe,
    calculateRecipeCost,
    deductRecipeStock,
    restoreRecipeStock,
    recordStockInward,
    recordStockWastage,
    reconcilePhysicalStock,
    calculateInventoryValuation,
    getLowStockItems,
    exportInventoryCSV,
    SAMPLE_INVENTORY_ITEMS,
    SAMPLE_RECIPES
  };
}
