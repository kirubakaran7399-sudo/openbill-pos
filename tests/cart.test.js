/**
 * tests/cart.test.js
 * Automated regression test suite for Cart operations, line items and kitchen tracking
 */

const { test } = require('node:test');
const assert = require('node:assert');
const {
  createCartItem,
  addItemToCart,
  updateCartItemQty,
  removeCartItem,
  markItemsSentToKitchen,
  getUnsentKitchenItems,
  calculateCartSubtotal
} = require('../src/core/cart.js');

test('createCartItem validates mandatory fields and sanitizes text', () => {
  const item = createCartItem({
    dishId: "prod_1",
    name: "<b>Chicken</b> Burger",
    basePrice: 120,
    qty: 2,
    note: "No <script>alert(1)</script> onions"
  });

  assert.strictEqual(item.dishId, "prod_1");
  assert.strictEqual(item.name, "&lt;b&gt;Chicken&lt;/b&gt; Burger");
  assert.strictEqual(item.unitPrice, 120);
  assert.strictEqual(item.qty, 2);
  assert.strictEqual(item.sentToKitchen, false);
  assert.ok(!item.note.includes("<script>"));
});

test('addItemToCart aggregates identical unprinted items', () => {
  let cart = [];
  cart = addItemToCart(cart, { dishId: "cb", name: "Chicken Burger", basePrice: 120, qty: 1 });
  cart = addItemToCart(cart, { dishId: "cb", name: "Chicken Burger", basePrice: 120, qty: 2 });

  assert.strictEqual(cart.length, 1);
  assert.strictEqual(cart[0].qty, 3);
  assert.strictEqual(calculateCartSubtotal(cart), 360);
});

test('addItemToCart creates separate line if item has different note or modifier', () => {
  let cart = [];
  cart = addItemToCart(cart, { dishId: "cb", name: "Chicken Burger", basePrice: 120, qty: 1, note: "No onion" });
  cart = addItemToCart(cart, { dishId: "cb", name: "Chicken Burger", basePrice: 120, qty: 1, note: "Extra cheese" });

  assert.strictEqual(cart.length, 2);
  assert.strictEqual(cart[0].qty, 1);
  assert.strictEqual(cart[1].qty, 1);
});

test('Kitchen dispatch tracking marks items and detects new rounds', () => {
  let cart = [];
  cart = addItemToCart(cart, { dishId: "cb", name: "Chicken Burger", basePrice: 120, qty: 1 });
  
  assert.strictEqual(getUnsentKitchenItems(cart).length, 1);
  
  // Send round 1 to kitchen
  cart = markItemsSentToKitchen(cart);
  assert.strictEqual(getUnsentKitchenItems(cart).length, 0);

  // Add round 2 item
  cart = addItemToCart(cart, { dishId: "pf", name: "Peri Fries", basePrice: 90, qty: 1 });
  
  const unsent = getUnsentKitchenItems(cart);
  assert.strictEqual(unsent.length, 1);
  assert.strictEqual(unsent[0].dishId, "pf");
});

test('updateCartItemQty and removeCartItem manage item counts correctly', () => {
  let cart = addItemToCart([], { dishId: "cb", name: "Chicken Burger", basePrice: 120, qty: 2 });
  const itemId = cart[0].id;

  cart = updateCartItemQty(cart, itemId, 1);
  assert.strictEqual(cart[0].qty, 3);

  cart = updateCartItemQty(cart, itemId, -1);
  assert.strictEqual(cart[0].qty, 2);

  // Decrementing to 0 removes it
  cart = updateCartItemQty(cart, itemId, -2);
  assert.strictEqual(cart.length, 0);
});
