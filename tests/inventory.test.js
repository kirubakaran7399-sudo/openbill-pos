/**
 * tests/inventory.test.js
 * Automated regression tests for Inventory, Raw Materials, Recipe BOM & Stock Inward Engine
 */

const { test } = require('node:test');
const assert = require('node:assert');
const {
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
} = require('../src/core/inventory.js');

test('createInventoryItem sanitizes name and assigns valid UOM and defaults', () => {
  const item = createInventoryItem({
    id: "raw_test",
    name: "<b>Fresh</b> Milk",
    code: "milk-01",
    category: "Dairy",
    uom: "LTR",
    currentStock: 25.5,
    minStock: 5,
    unitCost: 45
  });

  assert.strictEqual(item.id, "raw_test");
  assert.strictEqual(item.name, "&lt;b&gt;Fresh&lt;/b&gt; Milk");
  assert.strictEqual(item.code, "MILK-01");
  assert.strictEqual(item.uom, "ltr");
  assert.strictEqual(item.currentStock, 25.5);
  assert.strictEqual(item.minStock, 5);
  assert.strictEqual(item.unitCost, 45);
});

test('createInventoryItem throws on missing name', () => {
  assert.throws(() => {
    createInventoryItem({ name: "" });
  }, /name is required/);
});

test('setDishRecipe and getRecipeForDish manage BOM mappings', () => {
  let recipes = [];
  recipes = setDishRecipe(recipes, "prod_cb", [
    { itemId: "raw_bun", qty: 1 },
    { itemId: "raw_chick_patty", qty: 1 }
  ]);

  const recipe = getRecipeForDish(recipes, "prod_cb");
  assert.ok(recipe);
  assert.strictEqual(recipe.ingredients.length, 2);
  assert.strictEqual(recipe.ingredients[0].itemId, "raw_bun");
  assert.strictEqual(recipe.ingredients[0].qty, 1);
});

test('calculateRecipeCost computes accurate cost of dish preparation', () => {
  const inventory = [
    { id: "raw_bun", name: "Bun", unitCost: 8 },
    { id: "raw_patty", name: "Patty", unitCost: 32 },
    { id: "raw_cheese", name: "Cheese", unitCost: 10 }
  ];

  const recipe = {
    dishId: "prod_cb",
    ingredients: [
      { itemId: "raw_bun", qty: 1 },
      { itemId: "raw_patty", qty: 1 },
      { itemId: "raw_cheese", qty: 1 }
    ]
  };

  const cost = calculateRecipeCost(recipe, inventory);
  assert.strictEqual(cost, 50.0);
});

test('deductRecipeStock decrements raw materials proportionally to sold dish quantity', () => {
  const inventory = [
    { id: "raw_bun", name: "Bun", currentStock: 50, uom: "pcs" },
    { id: "raw_patty", name: "Patty", currentStock: 40, uom: "pcs" }
  ];

  const recipes = [
    {
      dishId: "prod_cb",
      ingredients: [
        { itemId: "raw_bun", qty: 1 },
        { itemId: "raw_patty", qty: 1 }
      ]
    }
  ];

  const cartItems = [
    { dishId: "prod_cb", name: "Chicken Burger", qty: 3 }
  ];

  const result = deductRecipeStock(inventory, recipes, cartItems);
  const bun = result.updatedInventory.find(i => i.id === "raw_bun");
  const patty = result.updatedInventory.find(i => i.id === "raw_patty");

  assert.strictEqual(bun.currentStock, 47); // 50 - 3
  assert.strictEqual(patty.currentStock, 37); // 40 - 3
  assert.strictEqual(result.deductionsLog.length, 2);
  assert.strictEqual(result.deductionsLog[0].deductedQty, 3);
});

test('deductRecipeStock handles non-existent or 0 stock safely without dropping below 0', () => {
  const inventory = [
    { id: "raw_bun", name: "Bun", currentStock: 2, uom: "pcs" }
  ];

  const recipes = [
    {
      dishId: "prod_cb",
      ingredients: [{ itemId: "raw_bun", qty: 1 }]
    }
  ];

  const cartItems = [{ dishId: "prod_cb", qty: 5 }];
  const result = deductRecipeStock(inventory, recipes, cartItems);
  const bun = result.updatedInventory.find(i => i.id === "raw_bun");

  assert.strictEqual(bun.currentStock, 0); // Bounded at 0
});

test('restoreRecipeStock increases raw materials when a bill is cancelled', () => {
  const inventory = [
    { id: "raw_bun", name: "Bun", currentStock: 40, uom: "pcs" },
    { id: "raw_patty", name: "Patty", currentStock: 30, uom: "pcs" }
  ];

  const recipes = [
    {
      dishId: "prod_cb",
      ingredients: [
        { itemId: "raw_bun", qty: 1 },
        { itemId: "raw_patty", qty: 1 }
      ]
    }
  ];

  const cancelledItems = [{ dishId: "prod_cb", qty: 2 }];
  const restored = restoreRecipeStock(inventory, recipes, cancelledItems);

  const bun = restored.find(i => i.id === "raw_bun");
  const patty = restored.find(i => i.id === "raw_patty");

  assert.strictEqual(bun.currentStock, 42); // 40 + 2
  assert.strictEqual(patty.currentStock, 32); // 30 + 2
});

test('recordStockInward increases stock and updates weighted average unit cost', () => {
  const inventory = [
    { id: "raw_fries", name: "Frozen Fries", currentStock: 10, unitCost: 100, uom: "kg" }
  ];

  const inward = {
    supplier: "McCain Cold Chain",
    invoiceNo: "INV-9988",
    date: "2026-11-20",
    items: [
      { itemId: "raw_fries", qty: 10, unitCost: 120 }
    ]
  };

  const result = recordStockInward(inventory, inward);
  const fries = result.updatedInventory.find(i => i.id === "raw_fries");

  assert.strictEqual(fries.currentStock, 20); // 10 + 10
  // Weighted avg cost: ((10*100) + (10*120)) / 20 = 2200 / 20 = 110
  assert.strictEqual(fries.unitCost, 110);
  assert.strictEqual(result.inwardRecord.totalAmount, 1200);
});

test('recordStockWastage decrements inventory and calculates monetary loss', () => {
  const inventory = [
    { id: "raw_chick", name: "Chicken", currentStock: 15, unitCost: 200, category: "Meat", uom: "kg" }
  ];

  const result = recordStockWastage(inventory, {
    itemId: "raw_chick",
    qty: 2,
    reason: "Expired / Shelf Life",
    reportedBy: "Chef",
    note: "Freezer breakdown overnight"
  });

  const chick = result.updatedInventory.find(i => i.id === "raw_chick");
  assert.strictEqual(chick.currentStock, 13);
  assert.strictEqual(result.wastageRecord.costLoss, 400); // 2kg * 200
  assert.strictEqual(result.wastageRecord.reason, "Expired / Shelf Life");
});

test('reconcilePhysicalStock records variance and adjusts stock to physical count', () => {
  const inventory = [
    { id: "raw_bun", name: "Bun", currentStock: 50, unitCost: 10, uom: "pcs" }
  ];

  const result = reconcilePhysicalStock(inventory, {
    itemId: "raw_bun",
    physicalCount: 46,
    reason: "Evening Audit",
    auditedBy: "Kiruba"
  });

  const bun = result.updatedInventory.find(i => i.id === "raw_bun");
  assert.strictEqual(bun.currentStock, 46);
  assert.strictEqual(result.auditRecord.systemCount, 50);
  assert.strictEqual(result.auditRecord.variance, -4);
  assert.strictEqual(result.auditRecord.varianceCost, -40);
});

test('calculateInventoryValuation computes total value and reorder alerts accurately', () => {
  const inventory = [
    { id: "1", currentStock: 10, unitCost: 100, minStock: 5 }, // 1000
    { id: "2", currentStock: 3, unitCost: 50, minStock: 5 },   // 150 (Low stock)
    { id: "3", currentStock: 0, unitCost: 20, minStock: 2 }    // 0 (Out of stock)
  ];

  const valuation = calculateInventoryValuation(inventory);
  assert.strictEqual(valuation.totalItems, 3);
  assert.strictEqual(valuation.totalValuation, 1150);
  assert.strictEqual(valuation.lowStockCount, 2);
  assert.strictEqual(valuation.outOfStockCount, 1);
});

test('getLowStockItems filters items below minimum reorder threshold', () => {
  const inventory = [
    { id: "1", currentStock: 10, minStock: 5 },
    { id: "2", currentStock: 2, minStock: 5 },
    { id: "3", currentStock: 0, minStock: 10 }
  ];

  const low = getLowStockItems(inventory);
  assert.strictEqual(low.length, 2);
  assert.strictEqual(low[0].id, "2");
  assert.strictEqual(low[1].id, "3");
});

test('exportInventoryCSV formats proper CSV with quoted fields and headers', () => {
  const inventory = [
    { id: "1", code: "BUN-01", name: 'Sesame "King" Bun', category: "Bakery", uom: "pcs", currentStock: 20, minStock: 5, unitCost: 10, supplier: "Bakery A" }
  ];

  const csv = exportInventoryCSV(inventory);
  assert.ok(csv.includes("Item Name,Category,Unit,Current Stock"));
  assert.ok(csv.includes('"BUN-01"'));
  assert.ok(csv.includes('""King""'));
  assert.ok(csv.includes("200.00")); // total value
});
