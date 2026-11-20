/**
 * app.js
 * The Retro Cafeteria POS — Master Application Controller
 * Handles state, reactive UI rendering, event dispatching, keyboard hotkeys & printing
 */

// Application State
let appState = null;
let currentView = "home";
let currentUser = null;
let activeOrderMode = "counter"; // "counter" | "takeaway" | "dinein"
let activeTableId = null;
let activeCustomer = { name: "", phone: "", gstin: "" };
let cart = [];
let activeDiscount = { type: "percent", value: 0, reason: "" };
let selectedPaymentMode = "CASH";
let cashTendered = 0;
let lastSelectedItemId = null;
let lockPinBuffer = "";
let pendingElevationAction = null;
let cancelTargetBillNo = null;

// Idle Lock Timer (Spec §3)
let idleTimer = null;

/**
 * Initializes the application on DOM ready.
 */
window.addEventListener("DOMContentLoaded", () => {
  initAppState();
  setupLiveClock();
  setupKeyboardShortcuts();
  resetIdleTimer();
  document.addEventListener("mousemove", resetIdleTimer);
  document.addEventListener("keydown", resetIdleTimer);

  // Initial render
  navigateTo("home");
  updateHeaderBadges();
  renderPosCategories();
  renderPosItems();
  renderTableSectionFilters();
  updateCustomerBadge();
});

/**
 * Escapes unsafe characters for HTML injection.
 */
function escapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Loads or initializes app state from LocalStorage.
 */
function initAppState() {
  const saved = localStorage.getItem(PosStorage.STORAGE_KEYS.STATE);
  if (saved) {
    appState = PosStorage.safeJsonParse(saved, null);
  }
  
  if (!appState || !appState.version) {
    // Blank catalog default per user preference (Q3)
    appState = PosCatalog.createInitialState(false);
    saveAppState();
  }

  // Ensure daily token resets if new date
  const todayStr = PosStorage.getLocalDateString();
  if (appState.dailyTokenDate !== todayStr) {
    appState.dailyTokenDate = todayStr;
    appState.dailyTokenCounter = 1;
    saveAppState();
  }

  // Set default logged in staff (Owner)
  currentUser = appState.staff[0];
  updateUserDisplay();
}

/**
 * Persists application state to LocalStorage.
 */
function saveAppState() {
  if (!appState) return;
  try {
    localStorage.setItem(PosStorage.STORAGE_KEYS.STATE, JSON.stringify(appState));
  } catch (err) {
    console.error("Failed to save state to LocalStorage:", err);
  }
}

/**
 * Resets or refreshes idle timeout for automatic locking (Spec §3).
 */
function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  const timeoutMinutes = appState?.store?.autoLockMinutes || 5;
  idleTimer = setTimeout(() => {
    lockScreen();
  }, timeoutMinutes * 60 * 1000);
}

/**
 * Locks the terminal and presents the PIN pad overlay (Spec §7.1).
 */
function lockScreen() {
  const overlay = document.getElementById("lock-screen-overlay");
  overlay.classList.remove("hidden");
  clearPin();
}

function unlockScreen(user) {
  currentUser = user;
  updateUserDisplay();
  document.getElementById("lock-screen-overlay").classList.add("hidden");
  clearPin();
}

function pressPinKey(digit) {
  if (lockPinBuffer.length >= 4) return;
  lockPinBuffer += digit;
  updatePinDots();

  if (lockPinBuffer.length === 4) {
    // Auto submit on 4th digit (Spec §7.1)
    setTimeout(submitLockPin, 100);
  }
}

function clearPin() {
  lockPinBuffer = "";
  updatePinDots();
  document.getElementById("lock-error-msg").textContent = "";
}

function backspacePin() {
  if (lockPinBuffer.length > 0) {
    lockPinBuffer = lockPinBuffer.slice(0, -1);
    updatePinDots();
  }
}

function updatePinDots() {
  const dots = document.querySelectorAll("#lock-pin-dots span");
  dots.forEach((dot, idx) => {
    if (idx < lockPinBuffer.length) {
      dot.className = "w-4 h-4 rounded-full border-2 border-[#C82026] bg-[#C82026] transition-all";
    } else {
      dot.className = "w-4 h-4 rounded-full border-2 border-stone-600 bg-transparent transition-all";
    }
  });
}

function submitLockPin() {
  const matched = PosAuth.authenticateStaff(lockPinBuffer, appState.staff);
  if (matched) {
    unlockScreen(matched);
  } else {
    document.getElementById("lock-error-msg").textContent = "Invalid PIN. Please try again.";
    lockPinBuffer = "";
    updatePinDots();
  }
}

function updateUserDisplay() {
  if (!currentUser) return;
  document.getElementById("active-user-name").textContent = currentUser.name;
  const roleEl = document.getElementById("active-user-role");
  roleEl.textContent = currentUser.role;
  roleEl.className = currentUser.role === "owner" 
    ? "text-[10px] uppercase font-bold text-[#C82026]" 
    : "text-[10px] uppercase font-bold text-[#6B4226]";
}

/**
 * Real-time header clock.
 */
function setupLiveClock() {
  function tick() {
    const now = new Date();
    document.getElementById("live-clock").textContent = now.toLocaleTimeString("en-IN", { hour12: false });
    document.getElementById("live-date").textContent = now.toLocaleDateString("en-IN", { day: '2-digit', month: 'short', year: 'numeric' });
  }
  tick();
  setInterval(tick, 1000);
}

/**
 * Screen routing.
 */
function navigateTo(viewName) {
  // Check permission for restricted screens: Reports, Menu, Settings need Owner
  if (["reports", "menu", "settings"].includes(viewName)) {
    if (!PosAuth.checkRolePermission(currentUser.role, "owner")) {
      requestOwnerElevation(`Access ${viewName.toUpperCase()} section`, () => {
        doNavigate(viewName);
      });
      return;
    }
  }
  doNavigate(viewName);
}

function doNavigate(viewName) {
  currentView = viewName;

  // Toggle active panels
  document.querySelectorAll(".view-panel").forEach(panel => {
    panel.classList.add("hidden");
  });
  const targetPanel = document.getElementById(`view-${viewName}`);
  if (targetPanel) {
    targetPanel.classList.remove("hidden");
  }

  // Update navigation button active state
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.remove("bg-white", "shadow-sm", "border", "border-[#E5DDD3]");
  });
  const activeBtn = document.getElementById(`nav-${viewName}`);
  if (activeBtn) {
    activeBtn.classList.add("bg-white", "shadow-sm", "border", "border-[#E5DDD3]");
  }

  // Screen-specific updates
  if (viewName === "home") {
    refreshHomeStats();
  } else if (viewName === "tables") {
    renderTableSectionFilters();
    renderTablesGrid();
  } else if (viewName === "history") {
    renderBillHistory();
  } else if (viewName === "reports") {
    renderOwnerReports();
  } else if (viewName === "crm") {
    renderCRMDirectory();
  } else if (viewName === "menu") {
    renderMenuManager();
  } else if (viewName === "settings") {
    loadSettingsForm();
  } else if (viewName === "pos") {
    updateCustomerBadge();
    renderCart();
  }
}

/**
 * Updates header badges (Held orders count, occupied tables count, critical stock count).
 */
function updateHeaderBadges() {
  const heldCount = (appState.heldOrders || []).length;
  document.getElementById("header-held-count").textContent = heldCount;
  updateHeaderStockBadge();

  const occupiedTables = Object.keys(appState.openOrders || {}).filter(k => k.startsWith("tbl_")).length;
  const tableBadge = document.getElementById("header-occupied-badge");
  if (occupiedTables > 0) {
    tableBadge.textContent = occupiedTables;
    tableBadge.classList.remove("hidden");
  } else {
    tableBadge.classList.add("hidden");
  }

  // Home launcher badge
  const homeTableStatus = document.getElementById("home-tables-status");
  if (homeTableStatus) {
    homeTableStatus.textContent = occupiedTables > 0 ? `${occupiedTables} Table(s) Active` : "Select Table";
  }
}

/**
 * Refreshes Home summary KPI cards.
 */
function refreshHomeStats() {
  const report = PosStorage.aggregateSalesSummary(appState.salesLedger, {
    startDate: PosStorage.getLocalDateString()
  });

  document.getElementById("home-gross-sales").textContent = `₹${report.grossSales.toFixed(2)}`;
  document.getElementById("home-bill-count").textContent = report.billCount;
  document.getElementById("home-cash-sales").textContent = `₹${report.payments.cash.total.toFixed(2)}`;
  document.getElementById("home-cash-count").textContent = report.payments.cash.count;
  const digitalTotal = report.payments.upi.total + report.payments.card.total;
  const digitalCount = report.payments.upi.count + report.payments.card.count;
  document.getElementById("home-digital-sales").textContent = `₹${digitalTotal.toFixed(2)}`;
  document.getElementById("home-digital-count").textContent = digitalCount;
  document.getElementById("home-gst-total").textContent = `₹${report.totalTax.toFixed(2)}`;
  document.getElementById("home-cgst").textContent = report.cgst.toFixed(2);
  document.getElementById("home-sgst").textContent = report.sgst.toFixed(2);

  updateHeaderBadges();
}

// -------------------------------------------------------------
// POS ORDER ENTRY & CART
// -------------------------------------------------------------

function startNewOrder(mode = "counter", tableId = null) {
  activeOrderMode = mode;
  activeTableId = tableId;
  activeCustomer = { name: "", phone: "", gstin: "" };
  activeDiscount = { type: "percent", value: 0, reason: "" };

  if (mode === "dinein" && tableId && appState.openOrders[tableId]) {
    // Resume existing open order for this table
    const existing = appState.openOrders[tableId];
    cart = existing.items || [];
    activeDiscount = existing.discount || activeDiscount;
    activeCustomer = existing.customer || activeCustomer;
  } else {
    cart = [];
  }

  updatePosHeaderDisplay();
  navigateTo("pos");
  renderCart();
  setTimeout(() => {
    document.getElementById("pos-search-input")?.focus();
  }, 100);
}

function setPosOrderType(mode) {
  if (mode === "dinein" && !activeTableId) {
    navigateTo("tables");
    return;
  }
  activeOrderMode = mode;
  updatePosHeaderDisplay();
  renderCart();
}

function updatePosHeaderDisplay() {
  const btnCounter = document.getElementById("btn-mode-counter");
  const btnTakeaway = document.getElementById("btn-mode-takeaway");
  const btnDinein = document.getElementById("btn-mode-dinein");
  const tableSelector = document.getElementById("pos-table-selector-wrap");

  [btnCounter, btnTakeaway, btnDinein].forEach(b => {
    b.className = "px-3 py-1 rounded-lg text-xs font-bold transition-all text-[#5C534B] hover:text-[#171717]";
  });

  if (activeOrderMode === "counter") {
    btnCounter.className = "px-3 py-1 rounded-lg text-xs font-bold transition-all bg-[#171717] text-white";
    tableSelector.classList.add("hidden");
    document.getElementById("cart-order-type").textContent = "Counter Sale";
    document.getElementById("cart-table-or-token").textContent = `Token #${appState.dailyTokenCounter}`;
  } else if (activeOrderMode === "takeaway") {
    btnTakeaway.className = "px-3 py-1 rounded-lg text-xs font-bold transition-all bg-[#171717] text-white";
    tableSelector.classList.add("hidden");
    document.getElementById("cart-order-type").textContent = "Takeaway Parcel";
    document.getElementById("cart-table-or-token").textContent = `Token #${appState.dailyTokenCounter}`;
  } else if (activeOrderMode === "dinein") {
    btnDinein.className = "px-3 py-1 rounded-lg text-xs font-bold transition-all bg-[#6B4226] text-white";
    tableSelector.classList.remove("hidden");
    populateTableDropdown();
    const tableObj = (appState.tables || []).find(t => t.id === activeTableId);
    document.getElementById("cart-order-type").textContent = "Dine-in";
    document.getElementById("cart-table-or-token").textContent = tableObj ? tableObj.name : "Select Table";
  }

  updateCustomerBadge();
}

/**
 * Updates the POS customer button badge text and active styling.
 */
function updateCustomerBadge() {
  const badge = document.getElementById("pos-customer-badge");
  if (!badge) return;
  const btn = badge.closest("button");
  const hasCust = Boolean(activeCustomer && (activeCustomer.name || activeCustomer.phone));

  if (hasCust) {
    const label = activeCustomer.name ? `👤 ${activeCustomer.name}` : `👤 ${activeCustomer.phone}`;
    badge.textContent = label;
    if (btn) {
      btn.className = "px-2.5 py-1.5 rounded-xl border border-[#171717] bg-[#171717] text-white text-xs font-bold flex items-center gap-1 shadow-sm transition-all";
    }
  } else {
    badge.textContent = "Customer";
    if (btn) {
      btn.className = "px-2.5 py-1.5 rounded-xl border border-[#E5DDD3] bg-white text-xs font-semibold text-[#5C534B] hover:text-[#171717] flex items-center gap-1 transition-all";
    }
  }
}

/**
 * Opens Customer Details & CRM recognition modal.
 */
function openCustomerInfoModal() {
  const modal = document.getElementById("customer-modal");
  if (!modal) return;

  const phoneInput = document.getElementById("cust-modal-phone");
  const nameInput = document.getElementById("cust-modal-name");
  const gstinInput = document.getElementById("cust-modal-gstin");

  if (phoneInput) phoneInput.value = activeCustomer.phone || "";
  if (nameInput) nameInput.value = activeCustomer.name || "";
  if (gstinInput) gstinInput.value = activeCustomer.gstin || "";

  if (activeCustomer.phone) {
    onCustomerModalPhoneInput(activeCustomer.phone);
  } else {
    const crmCard = document.getElementById("cust-modal-crm-card");
    if (crmCard) crmCard.classList.add("hidden");
  }

  modal.classList.remove("hidden");
  if (phoneInput) phoneInput.focus();
}

/**
 * Closes Customer Details modal.
 */
function closeCustomerInfoModal() {
  const modal = document.getElementById("customer-modal");
  if (modal) modal.classList.add("hidden");
}

/**
 * Live CRM lookup as cashier types customer phone number.
 */
function onCustomerModalPhoneInput(phone) {
  const crmCard = document.getElementById("cust-modal-crm-card");
  const nameInput = document.getElementById("cust-modal-name");
  const gstinInput = document.getElementById("cust-modal-gstin");

  if (!phone || phone.length < 10) {
    if (crmCard) crmCard.classList.add("hidden");
    return;
  }

  const cust = PosStorage.getCustomerByPhone(appState.salesLedger || [], phone);
  if (cust && crmCard) {
    document.getElementById("cust-modal-crm-name").textContent = cust.name || "Returning Guest";
    document.getElementById("cust-modal-crm-details").textContent = `${cust.totalVisits} visits • ₹${cust.lifetimeSpend.toFixed(2)} spent • Favorite: ${cust.favoriteDish || 'Treats'}`;
    crmCard.classList.remove("hidden");

    if (nameInput && !nameInput.value.trim() && cust.name) {
      nameInput.value = cust.name;
    }
    if (gstinInput && !gstinInput.value.trim() && cust.gstin) {
      gstinInput.value = cust.gstin;
    }
  } else if (crmCard) {
    crmCard.classList.add("hidden");
  }
}

/**
 * 1-click repeat customer last order from modal.
 */
function repeatCustomerOrderFromModal() {
  const phone = document.getElementById("cust-modal-phone")?.value.trim();
  closeCustomerInfoModal();
  if (phone) {
    repeatCustomerLastOrderFromCRM(phone);
  }
}

/**
 * Saves customer information to active order.
 */
function saveCustomerInfo(event) {
  if (event) event.preventDefault();

  const phone = document.getElementById("cust-modal-phone")?.value.trim() || "";
  const name = document.getElementById("cust-modal-name")?.value.trim() || "";
  const gstin = document.getElementById("cust-modal-gstin")?.value.trim().toUpperCase() || "";

  activeCustomer = { name, phone, gstin };

  // Sync with Dine-in open order if any
  if (activeOrderMode === "dinein" && activeTableId && appState.openOrders && appState.openOrders[activeTableId]) {
    appState.openOrders[activeTableId].customer = activeCustomer;
    saveAppState();
  }

  // Sync with Payment Modal fields
  const payCustName = document.getElementById("pay-cust-name");
  const payCustPhone = document.getElementById("pay-cust-phone");
  const payCustGstin = document.getElementById("pay-cust-gstin");
  if (payCustName) payCustName.value = name;
  if (payCustPhone) payCustPhone.value = phone;
  if (payCustGstin) payCustGstin.value = gstin;

  updateCustomerBadge();
  closeCustomerInfoModal();
}

/**
 * Resets customer details back to walk-in guest.
 */
function clearCustomerInfo() {
  activeCustomer = { name: "", phone: "", gstin: "" };

  const phoneInput = document.getElementById("cust-modal-phone");
  const nameInput = document.getElementById("cust-modal-name");
  const gstinInput = document.getElementById("cust-modal-gstin");
  if (phoneInput) phoneInput.value = "";
  if (nameInput) nameInput.value = "";
  if (gstinInput) gstinInput.value = "";

  const crmCard = document.getElementById("cust-modal-crm-card");
  if (crmCard) crmCard.classList.add("hidden");

  if (activeOrderMode === "dinein" && activeTableId && appState.openOrders && appState.openOrders[activeTableId]) {
    appState.openOrders[activeTableId].customer = activeCustomer;
    saveAppState();
  }

  const payCustName = document.getElementById("pay-cust-name");
  const payCustPhone = document.getElementById("pay-cust-phone");
  const payCustGstin = document.getElementById("pay-cust-gstin");
  if (payCustName) payCustName.value = "";
  if (payCustPhone) payCustPhone.value = "";
  if (payCustGstin) payCustGstin.value = "";

  updateCustomerBadge();
  closeCustomerInfoModal();
}

function populateTableDropdown() {
  const select = document.getElementById("pos-table-select");
  select.innerHTML = '<option value="">Select Table...</option>';
  (appState.tables || []).filter(t => t.isActive).forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = `${t.name} (${t.section})`;
    if (t.id === activeTableId) opt.selected = true;
    select.appendChild(opt);
  });
}

function onPosTableSelected(tableId) {
  if (!tableId) return;
  startNewOrder("dinein", tableId);
}

function renderPosCategories() {
  const container = document.getElementById("pos-categories-list");
  container.innerHTML = "";

  // "All Items" Category button
  const allBtn = document.createElement("button");
  allBtn.className = "cat-pill p-2.5 rounded-xl text-left text-xs font-bold flex items-center justify-between transition-all bg-[#171717] text-white";
  allBtn.innerHTML = `<span>All Menu</span><span class="text-[10px] bg-stone-700 px-1.5 py-0.2 rounded-full">${(appState.products || []).length}</span>`;
  allBtn.onclick = () => filterPosCategory("all", allBtn);
  container.appendChild(allBtn);

  (appState.categories || []).forEach(cat => {
    const count = (appState.products || []).filter(p => p.category === cat.name).length;
    const btn = document.createElement("button");
    btn.className = "cat-pill p-2.5 rounded-xl text-left text-xs font-semibold flex items-center justify-between transition-all text-[#5C534B] hover:bg-[#F6F2EC]";
    btn.innerHTML = `<span>${cat.name}</span><span class="text-[10px] bg-stone-200 text-stone-600 px-1.5 py-0.2 rounded-full">${count}</span>`;
    btn.onclick = () => filterPosCategory(cat.name, btn);
    container.appendChild(btn);
  });
}

let activePosCategoryFilter = "all";

function filterPosCategory(categoryName, btnEl) {
  activePosCategoryFilter = categoryName;
  document.querySelectorAll(".cat-pill").forEach(b => {
    b.className = "cat-pill p-2.5 rounded-xl text-left text-xs font-semibold flex items-center justify-between transition-all text-[#5C534B] hover:bg-[#F6F2EC]";
  });
  if (btnEl) {
    btnEl.className = "cat-pill p-2.5 rounded-xl text-left text-xs font-bold flex items-center justify-between transition-all bg-[#171717] text-white";
  }
  renderPosItems();
}

function renderPosItems() {
  const grid = document.getElementById("pos-items-grid");
  const emptyHelper = document.getElementById("pos-empty-catalog-msg");
  grid.innerHTML = "";

  const products = appState.products || [];
  if (products.length === 0) {
    grid.classList.add("hidden");
    emptyHelper.classList.remove("hidden");
    return;
  } else {
    grid.classList.remove("hidden");
    emptyHelper.classList.add("hidden");
  }

  const query = (document.getElementById("pos-search-input")?.value || "").toLowerCase().trim();

  const filtered = products.filter(p => {
    if (activePosCategoryFilter !== "all" && p.category !== activePosCategoryFilter) return false;
    if (query) {
      const matchName = p.name.toLowerCase().includes(query);
      const matchCode = (p.shortCode || "").toLowerCase() === query || (p.shortCode || "").toLowerCase().includes(query);
      return matchName || matchCode;
    }
    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-12 text-center text-[#5C534B] text-xs">
        No dishes matching "${query}". Try searching another name or short-code.
      </div>`;
    return;
  }

  filtered.forEach(prod => {
    const inCartItem = cart.find(it => it.dishId === prod.id);
    const cartQty = inCartItem ? inCartItem.qty : 0;

    const isSoldOut = !prod.isAvailable || (prod.trackStock && (prod.stockQty === undefined || prod.stockQty <= 0));
    const isLowStock = prod.trackStock && !isSoldOut && prod.stockQty <= (prod.lowStockThreshold || 5);

    let stockBadgeHtml = "";
    if (prod.trackStock) {
      if (isSoldOut) {
        stockBadgeHtml = '<span class="text-[9px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded">SOLD OUT</span>';
      } else if (isLowStock) {
        stockBadgeHtml = `<span class="text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded animate-pulse">⚠️ ${prod.stockQty} left</span>`;
      } else {
        stockBadgeHtml = `<span class="text-[9px] font-semibold text-emerald-700 bg-emerald-50 px-1 py-0.5 rounded">${prod.stockQty} left</span>`;
      }
    } else if (!prod.isAvailable) {
      stockBadgeHtml = '<span class="text-[9px] font-bold text-red-600 bg-red-50 px-1 rounded">SOLD OUT</span>';
    }

    const card = document.createElement("div");
    card.className = `bg-white p-3.5 rounded-2xl border-2 transition-all flex flex-col justify-between h-32 cursor-pointer shadow-sm hover:shadow-md relative select-none ${
      cartQty > 0 ? 'border-[#C82026]' : 'border-[#E5DDD3] hover:border-[#171717]'
    } ${isSoldOut ? 'opacity-50 pointer-events-none' : ''}`;

    card.onclick = () => addDishToCart(prod);

    // Diet mark HTML
    const dietHtml = prod.diet === "veg"
      ? `<span class="diet-veg" title="Vegetarian"><span class="diet-veg-dot"></span></span>`
      : `<span class="diet-non-veg" title="Non-Vegetarian"><span class="diet-non-veg-dot"></span></span>`;

    // Quantity in cart badge
    const qtyBadge = cartQty > 0
      ? `<span class="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-[#C82026] text-white text-xs font-extrabold flex items-center justify-center shadow-md animate-pop">${cartQty}</span>`
      : '';

    card.innerHTML = `
      ${qtyBadge}
      <div>
        <div class="flex items-center justify-between gap-1">
          <div class="flex items-center gap-1.5">
            ${dietHtml}
            <span class="text-[10px] font-mono font-bold bg-[#F6F2EC] px-1.5 py-0.5 rounded text-[#5C534B]">${prod.shortCode || 'ITEM'}</span>
          </div>
          ${stockBadgeHtml}
        </div>
        <h4 class="text-xs font-bold text-[#171717] mt-2 line-clamp-2 leading-tight">${prod.name}</h4>
      </div>
      <div class="flex items-center justify-between pt-2 border-t border-[#F6F2EC]">
        <span class="text-sm font-extrabold font-mono text-[#171717]">₹${prod.price.toFixed(2)}</span>
        <button class="w-6 h-6 rounded-lg bg-[#F6F2EC] hover:bg-[#171717] hover:text-white flex items-center justify-center text-[#171717] transition-all">
          <span class="material-symbols-outlined text-[16px]">add</span>
        </button>
      </div>
    `;

    grid.appendChild(card);
  });
}

// -------------------------------------------------------------
// ITEM CUSTOMIZATION & OPTIONS (Sizes & Add-ons)
// -------------------------------------------------------------
let currentOptionsDish = null;
let selectedOptionSize = null;
let selectedOptionAddons = [];
let selectedOptionNotes = [];

function openItemOptionsModal(dish) {
  currentOptionsDish = dish;
  selectedOptionAddons = [];
  selectedOptionNotes = [];
  
  document.getElementById("opt-dish-name").textContent = dish.name;
  document.getElementById("opt-dish-category").textContent = dish.category || "General";
  
  // Sizes list
  const sizesContainer = document.getElementById("opt-sizes-container");
  const sizesList = document.getElementById("opt-sizes-list");
  sizesList.innerHTML = "";
  
  const sizes = Array.isArray(dish.sizes) && dish.sizes.length > 0 ? dish.sizes : [];
  if (sizes.length > 0) {
    sizesContainer.classList.remove("hidden");
    selectedOptionSize = sizes[0];
    sizes.forEach((s, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `p-2 rounded-xl text-xs font-bold border transition-all text-left flex justify-between items-center ${
        idx === 0 ? 'bg-[#171717] text-white border-[#171717]' : 'bg-[#F6F2EC] text-[#171717] border-[#E5DDD3] hover:bg-white'
      }`;
      btn.innerHTML = `<span>${s.name}</span><span class="font-mono">₹${s.price}</span>`;
      btn.onclick = () => {
        selectedOptionSize = s;
        Array.from(sizesList.children).forEach(b => {
          b.className = 'p-2 rounded-xl text-xs font-bold border transition-all text-left flex justify-between items-center bg-[#F6F2EC] text-[#171717] border-[#E5DDD3] hover:bg-white';
        });
        btn.className = 'p-2 rounded-xl text-xs font-bold border transition-all text-left flex justify-between items-center bg-[#171717] text-white border-[#171717]';
        updateOptionsPricePreview();
      };
      sizesList.appendChild(btn);
    });
  } else {
    sizesContainer.classList.add("hidden");
    selectedOptionSize = { name: "", price: dish.price };
  }

  // Addons list
  const addonsContainer = document.getElementById("opt-addons-container");
  const addonsList = document.getElementById("opt-addons-list");
  addonsList.innerHTML = "";
  
  const addons = Array.isArray(dish.addons) && dish.addons.length > 0 ? dish.addons : [];
  if (addons.length > 0) {
    addonsContainer.classList.remove("hidden");
    addons.forEach(a => {
      const label = document.createElement("label");
      label.className = "flex items-center justify-between p-2 bg-[#F6F2EC] rounded-xl cursor-pointer hover:bg-white border border-[#E5DDD3]";
      label.innerHTML = `
        <div class="flex items-center gap-2">
          <input type="checkbox" class="w-4 h-4 accent-[#171717]" value="${a.name}">
          <span class="text-xs font-semibold text-[#171717]">${a.name}</span>
        </div>
        <span class="text-xs font-mono font-bold text-[#5C534B]">+₹${a.price}</span>
      `;
      const chk = label.querySelector("input");
      chk.onchange = () => {
        if (chk.checked) {
          selectedOptionAddons.push(a);
        } else {
          selectedOptionAddons = selectedOptionAddons.filter(item => item.name !== a.name);
        }
        updateOptionsPricePreview();
      };
      addonsList.appendChild(label);
    });
  } else {
    addonsContainer.classList.add("hidden");
  }

  // Quick notes chips
  const notesChips = document.getElementById("opt-notes-chips");
  notesChips.innerHTML = "";
  (dish.quickNotes || []).forEach(n => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "px-2.5 py-1 rounded-full text-[11px] font-semibold border border-[#E5DDD3] bg-[#F6F2EC] text-[#5C534B] hover:bg-white transition-all";
    chip.textContent = n;
    chip.onclick = () => {
      if (selectedOptionNotes.includes(n)) {
        selectedOptionNotes = selectedOptionNotes.filter(x => x !== n);
        chip.className = "px-2.5 py-1 rounded-full text-[11px] font-semibold border border-[#E5DDD3] bg-[#F6F2EC] text-[#5C534B] hover:bg-white transition-all";
      } else {
        selectedOptionNotes.push(n);
        chip.className = "px-2.5 py-1 rounded-full text-[11px] font-semibold border border-[#171717] bg-[#171717] text-white transition-all";
      }
    };
    notesChips.appendChild(chip);
  });
  document.getElementById("opt-custom-note").value = "";

  updateOptionsPricePreview();
  document.getElementById("item-options-modal").classList.remove("hidden");
}

function updateOptionsPricePreview() {
  if (!currentOptionsDish) return;
  const base = selectedOptionSize?.price !== undefined ? selectedOptionSize.price : currentOptionsDish.price;
  const addonsTotal = selectedOptionAddons.reduce((sum, a) => sum + (parseFloat(a.price) || 0), 0);
  document.getElementById("opt-total-price").textContent = `₹${(base + addonsTotal).toFixed(2)}`;
}

function closeItemOptionsModal() {
  document.getElementById("item-options-modal").classList.add("hidden");
  currentOptionsDish = null;
}

function confirmAddItemWithOptions() {
  if (!currentOptionsDish) return;
  const base = selectedOptionSize?.price !== undefined ? selectedOptionSize.price : currentOptionsDish.price;
  const sizeName = selectedOptionSize?.name ? ` (${selectedOptionSize.name})` : "";
  const itemName = `${currentOptionsDish.name}${sizeName}`;
  
  const customNote = document.getElementById("opt-custom-note").value.trim();
  const allNotes = [...selectedOptionNotes];
  if (customNote) allNotes.push(customNote);
  
  cart = PosCart.addItemToCart(cart, {
    dishId: currentOptionsDish.id,
    name: itemName,
    shortCode: currentOptionsDish.shortCode,
    category: currentOptionsDish.category,
    basePrice: base,
    diet: currentOptionsDish.diet,
    gstRate: currentOptionsDish.gstRate || 5.0,
    addons: selectedOptionAddons,
    note: allNotes.join(", ")
  });

  closeItemOptionsModal();
  renderCart();
  renderPosItems();
  persistActiveOrderDraft();
}

/**
 * Adds dish to current cart using pure PosCart engine.
 * Opens options modal if the dish has sizes or add-ons.
 */
function addDishToCart(dish) {
  const hasSizes = Array.isArray(dish.sizes) && dish.sizes.length > 0;
  const hasAddons = Array.isArray(dish.addons) && dish.addons.length > 0;
  if (hasSizes || hasAddons) {
    openItemOptionsModal(dish);
    return;
  }

  cart = PosCart.addItemToCart(cart, {
    dishId: dish.id,
    name: dish.name,
    shortCode: dish.shortCode,
    category: dish.category,
    basePrice: dish.price,
    diet: dish.diet,
    gstRate: dish.gstRate || 5.0
  });

  renderCart();
  renderPosItems();
  persistActiveOrderDraft();
}

function updateCartQty(itemId, delta) {
  cart = PosCart.updateCartItemQty(cart, itemId, delta);
  renderCart();
  renderPosItems();
  persistActiveOrderDraft();
}

function removeCartLine(itemId) {
  cart = PosCart.removeCartItem(cart, itemId);
  renderCart();
  renderPosItems();
  persistActiveOrderDraft();
}

function promptItemNote(itemId) {
  const item = cart.find(it => it.id === itemId);
  if (!item) return;

  const current = item.note || "";
  const note = prompt(`Enter special notes / instructions for "${item.name}":`, current);
  if (note !== null) {
    cart = PosCart.updateCartItemNote(cart, itemId, note);
    renderCart();
    persistActiveOrderDraft();
  }
}

function clearCurrentCart() {
  if (cart.length === 0) return;
  if (confirm("Are you sure you want to clear this order?")) {
    cart = [];
    activeDiscount = { type: "percent", value: 0, reason: "" };
    renderCart();
    renderPosItems();
    persistActiveOrderDraft();
  }
}

/**
 * Persists open table drafts or active orders.
 */
function persistActiveOrderDraft() {
  if (activeOrderMode === "dinein" && activeTableId) {
    if (cart.length > 0) {
      if (!appState.openOrders) appState.openOrders = {};
      appState.openOrders[activeTableId] = {
        tableId: activeTableId,
        orderType: "dinein",
        items: cart,
        discount: activeDiscount,
        customer: activeCustomer,
        startedAt: appState.openOrders[activeTableId]?.startedAt || new Date().toISOString()
      };
    } else {
      delete appState.openOrders[activeTableId];
    }
    saveAppState();
    updateHeaderBadges();
  }
}

/**
 * Calculates financial totals using PosTax engine and renders live check.
 */
function renderCart() {
  const listContainer = document.getElementById("cart-items-list");
  listContainer.innerHTML = "";

  const subtotal = PosCart.calculateCartSubtotal(cart);
  const taxMode = appState?.store?.taxMode || "exclusive";
  const invoiceType = appState?.store?.invoiceType || "tax_invoice";
  const gstRate = appState?.store?.gstRate || 5.0;

  const taxTotals = PosTax.calculateBillTotals(subtotal, activeDiscount, {
    gstRate,
    inclusive: taxMode === "inclusive",
    compositionScheme: invoiceType === "bill_of_supply",
    rounding: appState?.store?.roundOffEnabled ? "round" : "none"
  });

  // Render totals in check panel
  document.getElementById("cart-subtotal").textContent = `₹${taxTotals.subtotal.toFixed(2)}`;
  
  const discountRow = document.getElementById("cart-discount-row");
  if (taxTotals.discountAmount > 0) {
    discountRow.classList.remove("hidden");
    document.getElementById("cart-discount-label").textContent = `${activeDiscount.value}${activeDiscount.type === 'percent' ? '%' : '₹'}`;
    document.getElementById("cart-discount-amt").textContent = `-₹${taxTotals.discountAmount.toFixed(2)}`;
  } else {
    document.getElementById("cart-discount-label").textContent = "0%";
    document.getElementById("cart-discount-amt").textContent = "-₹0.00";
  }

  document.getElementById("cart-taxable-amt").textContent = `₹${taxTotals.taxableAmount.toFixed(2)}`;
  document.getElementById("cart-cgst-amt").textContent = `₹${taxTotals.cgst.toFixed(2)}`;
  document.getElementById("cart-sgst-amt").textContent = `₹${taxTotals.sgst.toFixed(2)}`;
  document.getElementById("cart-roundoff-amt").textContent = (taxTotals.roundoff > 0 ? `+₹${taxTotals.roundoff.toFixed(2)}` : `₹${taxTotals.roundoff.toFixed(2)}`);
  document.getElementById("cart-grand-total").textContent = `₹${taxTotals.grandTotal.toFixed(2)}`;
  document.getElementById("cart-items-count").textContent = `${cart.reduce((s, it) => s + it.qty, 0)} items`;

  if (cart.length === 0) {
    listContainer.innerHTML = `
      <div class="flex-1 flex flex-col items-center justify-center p-8 text-center text-[#5C534B]">
        <span class="material-symbols-outlined text-[36px] text-stone-300">shopping_cart</span>
        <p class="text-xs font-semibold mt-2">Check is Empty</p>
        <p class="text-[11px] text-stone-400">Click a dish or type short-code + Enter</p>
      </div>`;
    return;
  }

  cart.forEach(item => {
    const lineTotal = item.unitPrice * item.qty;
    const itemCard = document.createElement("div");
    itemCard.className = `bg-white p-2.5 rounded-xl border border-[#E5DDD3] flex flex-col gap-1.5 shadow-sm ${
      !item.sentToKitchen ? 'cart-item-unsent' : ''
    }`;

    itemCard.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="text-xs font-bold text-[#171717] truncate">${item.name}</span>
          </div>
          ${item.note ? `<p class="text-[10px] text-amber-800 bg-amber-50 px-1 rounded inline-block mt-0.5">* ${item.note}</p>` : ''}
        </div>
        <span class="text-xs font-bold font-mono text-[#171717]">₹${lineTotal.toFixed(2)}</span>
      </div>

      <div class="flex items-center justify-between pt-1 border-t border-[#F6F2EC]">
        <button onclick="promptItemNote('${item.id}')" class="text-[11px] text-[#5C534B] hover:text-[#C82026] flex items-center gap-0.5">
          <span class="material-symbols-outlined text-[14px]">edit_note</span> Notes
        </button>

        <!-- Stepper Controls -->
        <div class="flex items-center gap-2">
          <button onclick="updateCartQty('${item.id}', -1)" class="w-6 h-6 rounded bg-[#F6F2EC] hover:bg-stone-300 flex items-center justify-center font-bold text-xs">
            -
          </button>
          <span class="w-5 text-center font-mono font-bold text-xs">${item.qty}</span>
          <button onclick="updateCartQty('${item.id}', 1)" class="w-6 h-6 rounded bg-[#F6F2EC] hover:bg-stone-300 flex items-center justify-center font-bold text-xs">
            +
          </button>
        </div>
      </div>
    `;

    listContainer.appendChild(itemCard);
  });
}

// -------------------------------------------------------------
// KITCHEN ORDER TICKET (KOT) (Spec §7.6 & §8.4)
// -------------------------------------------------------------

function printKitchenSlip() {
  const unsent = PosCart.getUnsentKitchenItems(cart);
  if (unsent.length === 0) {
    alert("All items in this order have already been printed to the kitchen.");
    return;
  }

  const tableObj = (appState.tables || []).find(t => t.id === activeTableId);
  const kotData = {
    orderType: activeOrderMode,
    tableName: tableObj ? tableObj.name : null,
    tokenNumber: activeOrderMode !== "dinein" ? appState.dailyTokenCounter : null,
    time: new Date().toLocaleTimeString("en-IN", { hour: '2-digit', minute: '2-digit' }),
    items: unsent
  };

  const printerWidth = appState?.store?.printerWidth === "58mm" ? 32 : 48;
  const slipText = PosEscpos.formatKitchenKOT(kotData, printerWidth);

  // Mark items as sent in state
  cart = PosCart.markItemsSentToKitchen(cart);
  renderCart();
  persistActiveOrderDraft();

  // Show thermal preview
  openThermalPreview(slipText, "Kitchen Slip (KOT)");
}

// -------------------------------------------------------------
// HOLD ORDERS (Spec §7.8)
// -------------------------------------------------------------

function holdCurrentOrder() {
  if (cart.length === 0) {
    alert("Cannot hold an empty order.");
    return;
  }

  const tableObj = (appState.tables || []).find(t => t.id === activeTableId);
  const heldEntry = {
    id: `held_${Date.now()}`,
    orderType: activeOrderMode,
    tableName: tableObj ? tableObj.name : null,
    tableId: activeTableId,
    tokenNumber: appState.dailyTokenCounter,
    items: [...cart],
    discount: activeDiscount,
    customer: activeCustomer,
    heldAt: new Date().toLocaleTimeString("en-IN"),
    total: PosCart.calculateCartSubtotal(cart)
  };

  if (!appState.heldOrders) appState.heldOrders = [];
  appState.heldOrders.push(heldEntry);

  if (activeOrderMode === "dinein" && activeTableId) {
    delete appState.openOrders[activeTableId];
  } else {
    // Advance token for next counter order
    appState.dailyTokenCounter++;
  }

  saveAppState();
  updateHeaderBadges();

  alert("Order held successfully.");
  startNewOrder(activeOrderMode);
}

function openHeldOrdersModal() {
  const modal = document.getElementById("held-orders-modal");
  const list = document.getElementById("held-orders-list");
  list.innerHTML = "";

  const helds = appState.heldOrders || [];
  if (helds.length === 0) {
    list.innerHTML = `
      <div class="py-12 text-center text-[#5C534B] text-xs">
        <span class="material-symbols-outlined text-[32px] text-stone-300">pause_circle</span>
        <p class="font-bold mt-2">No Held Orders</p>
      </div>`;
  } else {
    helds.forEach((h, index) => {
      const card = document.createElement("div");
      card.className = "bg-white p-3.5 rounded-xl border border-[#E5DDD3] shadow-sm flex flex-col gap-2";
      card.innerHTML = `
        <div class="flex items-center justify-between">
          <span class="text-xs font-extrabold uppercase text-[#171717]">${h.tableName || `Token #${h.tokenNumber}`} (${h.orderType})</span>
          <span class="text-xs font-mono font-bold text-emerald-700">₹${h.total.toFixed(2)}</span>
        </div>
        <p class="text-[11px] text-[#5C534B]">${h.items.length} items • Held at ${h.heldAt}</p>
        <div class="flex gap-2 mt-1">
          <button onclick="resumeHeldOrder(${index})" class="btn-primary flex-1 !min-h-[34px] !py-1 !text-xs">
            Resume Order
          </button>
          <button onclick="discardHeldOrder(${index})" class="btn-danger-outline !min-h-[34px] !py-1 !text-xs">
            Discard
          </button>
        </div>
      `;
      list.appendChild(card);
    });
  }

  modal.classList.remove("hidden");
}

function closeHeldOrdersModal() {
  document.getElementById("held-orders-modal").classList.add("hidden");
}

function resumeHeldOrder(index) {
  const held = appState.heldOrders[index];
  if (!held) return;

  activeOrderMode = held.orderType;
  activeTableId = held.tableId;
  cart = held.items || [];
  activeDiscount = held.discount || { type: "percent", value: 0 };
  activeCustomer = held.customer || { name: "", phone: "", gstin: "" };

  appState.heldOrders.splice(index, 1);
  saveAppState();
  updateHeaderBadges();
  closeHeldOrdersModal();

  updatePosHeaderDisplay();
  navigateTo("pos");
  renderCart();
}

function discardHeldOrder(index) {
  if (confirm("Discard this held order?")) {
    appState.heldOrders.splice(index, 1);
    saveAppState();
    updateHeaderBadges();
    openHeldOrdersModal();
  }
}

// -------------------------------------------------------------
// PAY & SETTLE DRAWER (Spec §7.7)
// -------------------------------------------------------------

function openPaymentDrawer() {
  if (cart.length === 0) {
    alert("Please add at least one dish to the check before proceeding to payment.");
    return;
  }

  const subtotal = PosCart.calculateCartSubtotal(cart);
  const taxMode = appState?.store?.taxMode || "exclusive";
  const invoiceType = appState?.store?.invoiceType || "tax_invoice";
  const gstRate = appState?.store?.gstRate || 5.0;

  const totals = PosTax.calculateBillTotals(subtotal, activeDiscount, {
    gstRate,
    inclusive: taxMode === "inclusive",
    compositionScheme: invoiceType === "bill_of_supply",
    rounding: appState?.store?.roundOffEnabled ? "round" : "none"
  });

  document.getElementById("pay-grand-total").textContent = `₹${totals.grandTotal.toFixed(2)}`;
  document.getElementById("pay-mode-info").textContent = totals.isComposition 
    ? "Bill of Supply (Composition Scheme)" 
    : `Tax Invoice (5% GST: CGST ₹${totals.cgst.toFixed(2)} + SGST ₹${totals.sgst.toFixed(2)})`;

  selectPaymentMode("CASH");
  document.getElementById("pay-cash-input").value = totals.grandTotal;
  calculateChangeDue();

  // Populate customer fields if already filled
  document.getElementById("pay-cust-name").value = activeCustomer.name || "";
  document.getElementById("pay-cust-phone").value = activeCustomer.phone || "";
  document.getElementById("pay-cust-gstin").value = activeCustomer.gstin || "";

  document.getElementById("payment-modal").classList.remove("hidden");
}

function closePaymentDrawer() {
  document.getElementById("payment-modal").classList.add("hidden");
}

function selectPaymentMode(mode) {
  selectedPaymentMode = mode;
  document.querySelectorAll(".pay-mode-btn").forEach(btn => {
    btn.className = "pay-mode-btn p-3 rounded-xl border-2 border-[#E5DDD3] bg-white font-bold text-xs flex flex-col items-center gap-1";
  });

  const activeBtn = document.getElementById(`pay-btn-${mode.toLowerCase()}`);
  if (activeBtn) {
    activeBtn.className = "pay-mode-btn p-3 rounded-xl border-2 border-[#171717] bg-[#F6F2EC] font-bold text-xs flex flex-col items-center gap-1";
  }

  const cashWrap = document.getElementById("pay-cash-calc-wrap");
  const upiWrap = document.getElementById("pay-upi-qr-wrap");

  if (mode === "CASH") {
    if (cashWrap) cashWrap.classList.remove("hidden");
    if (upiWrap) upiWrap.classList.add("hidden");
  } else if (mode === "UPI") {
    if (cashWrap) cashWrap.classList.add("hidden");
    if (upiWrap) {
      upiWrap.classList.remove("hidden");
      renderDynamicUpiQr();
    }
  } else {
    if (cashWrap) cashWrap.classList.add("hidden");
    if (upiWrap) upiWrap.classList.add("hidden");
  }
}

function renderDynamicUpiQr(amount) {
  const wrap = document.getElementById("pay-upi-qr-wrap");
  const qrBox = document.getElementById("pay-upi-qr-code");
  const idDisplay = document.getElementById("pay-upi-id-display");
  if (!wrap || !qrBox) return;

  const store = appState?.store || {};
  const upiId = store.upiId || "retrocafe@upi";
  const grandTotal = amount !== undefined ? amount : getActiveGrandTotal();
  const billNo = PosStorage.formatBillNumber(appState.billSequence, new Date());

  if (typeof PosQR !== "undefined" && PosQR.generateUPIPaymentString) {
    const upiUri = PosQR.generateUPIPaymentString({
      upiId,
      storeName: store.name || "THE RETRO CAFETERIA",
      amount: grandTotal,
      billNumber: billNo
    });

    const svgMarkup = PosQR.createQrSvg(upiUri, { size: 160 });
    qrBox.innerHTML = svgMarkup;
  }
  if (idDisplay) {
    idDisplay.textContent = `UPI: ${upiId} • ₹${grandTotal.toFixed(2)}`;
  }
}

function calculateChangeDue() {
  const grandTotal = getActiveGrandTotal();
  const tendered = parseFloat(document.getElementById("pay-cash-input").value) || 0;
  const change = Math.max(0, tendered - grandTotal);
  document.getElementById("pay-change-due").textContent = `₹${change.toFixed(2)}`;
}

function setCashTenderedExact() {
  document.getElementById("pay-cash-input").value = getActiveGrandTotal();
  calculateChangeDue();
}

function addCashTenderPreset(amount) {
  document.getElementById("pay-cash-input").value = amount;
  calculateChangeDue();
}

function getActiveGrandTotal() {
  const subtotal = PosCart.calculateCartSubtotal(cart);
  const totals = PosTax.calculateBillTotals(subtotal, activeDiscount, {
    gstRate: appState?.store?.gstRate || 5.0,
    inclusive: appState?.store?.taxMode === "inclusive",
    compositionScheme: appState?.store?.invoiceType === "bill_of_supply",
    rounding: appState?.store?.roundOffEnabled ? "round" : "none"
  });
  return totals.grandTotal;
}

/**
 * Executes final payment settlement, assigns consecutive invoice number,
 * saves to sales ledger, and triggers thermal printing.
 */
function executePaymentAndPrint() {
  const subtotal = PosCart.calculateCartSubtotal(cart);
  const taxMode = appState?.store?.taxMode || "exclusive";
  const invoiceType = appState?.store?.invoiceType || "tax_invoice";
  const gstRate = appState?.store?.gstRate || 5.0;

  const totals = PosTax.calculateBillTotals(subtotal, activeDiscount, {
    gstRate,
    inclusive: taxMode === "inclusive",
    compositionScheme: invoiceType === "bill_of_supply",
    rounding: appState?.store?.roundOffEnabled ? "round" : "none"
  });

  // Consecutive bill number per financial year (Spec §1.1 & §9)
  const billNo = PosStorage.formatBillNumber(appState.billSequence, new Date());
  appState.billSequence = (appState.billSequence || 1) + 1;

  // Tendered & change
  const tendered = selectedPaymentMode === "CASH" 
    ? (parseFloat(document.getElementById("pay-cash-input").value) || totals.grandTotal)
    : totals.grandTotal;
  const changeDue = Math.max(0, tendered - totals.grandTotal);

  // Customer details
  activeCustomer.name = document.getElementById("pay-cust-name").value.trim();
  activeCustomer.phone = document.getElementById("pay-cust-phone").value.trim();
  activeCustomer.gstin = document.getElementById("pay-cust-gstin").value.trim();

  const tableObj = (appState.tables || []).find(t => t.id === activeTableId);

  const billRecord = {
    billNo,
    timestamp: new Date().toLocaleString("en-IN"),
    date: PosStorage.getLocalDateString(),
    time: new Date().toLocaleTimeString("en-IN", { hour: '2-digit', minute: '2-digit' }),
    orderType: activeOrderMode,
    tableName: tableObj ? tableObj.name : null,
    tableId: activeTableId,
    tokenNumber: activeOrderMode !== "dinein" ? appState.dailyTokenCounter : null,
    cashier: currentUser ? currentUser.name : "Cashier",
    customerName: activeCustomer.name,
    customerPhone: activeCustomer.phone,
    customerGstin: activeCustomer.gstin,
    items: [...cart],
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    discountReason: totals.discountReason,
    taxableAmount: totals.taxableAmount,
    sacCode: totals.sacCode,
    gstRate: totals.gstRate,
    cgstRate: totals.cgstRate,
    sgstRate: totals.sgstRate,
    cgst: totals.cgst,
    sgst: totals.sgst,
    totalTax: totals.totalTax,
    roundoff: totals.roundoff,
    grandTotal: totals.grandTotal,
    paymentMode: selectedPaymentMode,
    amountTendered: tendered,
    changeDue,
    isComposition: totals.isComposition,
    isCancelled: false
  };

  // Decrement critical stock for tracked items
  decrementSoldProductStock(billRecord.items);

  // Add to ledger
  if (!appState.salesLedger) appState.salesLedger = [];
  appState.salesLedger.unshift(billRecord);

  // Clean up order state
  if (activeOrderMode === "dinein" && activeTableId) {
    delete appState.openOrders[activeTableId];
  } else {
    appState.dailyTokenCounter++;
  }

  saveAppState();
  renderPosItems();
  updateHeaderStockBadge();
  triggerAutomatedBackup();
  closePaymentDrawer();

  // Generate ESC/POS thermal text
  const is58mm = appState?.store?.printerWidth === "58mm";
  const W = is58mm ? 32 : 48;
  const receiptText = is58mm 
    ? PosEscpos.formatBill58mm(billRecord, appState.store)
    : PosEscpos.formatBill80mm(billRecord, appState.store);

  let finalPrintSlip = receiptText;

  // Auto-Print Kitchen Slip (KOT) on order settlement (Spec §7.6 & User Rule 5)
  if (appState?.store?.autoPrintKOT !== false) {
    const unsent = PosCart.getUnsentKitchenItems(billRecord.items || cart);
    if (unsent.length > 0) {
      const kotData = {
        orderType: activeOrderMode,
        tableName: tableObj ? tableObj.name : null,
        tokenNumber: billRecord.tokenNumber,
        time: billRecord.time,
        items: unsent
      };
      const kotText = PosEscpos.formatKitchenKOT(kotData, W);
      // Prepend Kitchen Slip before the Customer Tax Invoice for single thermal roll tear-off
      finalPrintSlip = kotText + "\n" + "=".repeat(W) + "\n\n" + receiptText;
    }
  }

  // Cash Drawer Auto-Kick pulse on Cash settlement (Spec §7.12 & User Rule 6)
  if (selectedPaymentMode === "CASH" && appState?.store?.autoKickCashDrawer !== false) {
    console.log("[POS] Cash Drawer Kick pulse triggered (ESC/POS 1B 70 00 19 FA).");
  }

  // Attempt non-blocking direct spool to Xprinter via local terminal server
  fetch("/api/print", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: finalPrintSlip })
  }).catch(() => {});

  // Open thermal preview
  openThermalPreview(finalPrintSlip, `Tax Invoice ${billNo}`);

  // Reset order for next customer
  startNewOrder(activeOrderMode);
  refreshHomeStats();
}

/**
 * Decrements stock count for items tracking critical inventory.
 * Automatically marks products as isAvailable = false if stock reaches 0.
 */
function decrementSoldProductStock(items) {
  if (!Array.isArray(items) || !Array.isArray(appState.products)) return;
  items.forEach(it => {
    const prod = appState.products.find(p => p.id === it.dishId || p.name === it.name);
    if (prod && prod.trackStock) {
      prod.stockQty = Math.max(0, (prod.stockQty || 0) - (it.qty || 1));
      if (prod.stockQty === 0) {
        prod.isAvailable = false;
      }
    }
  });
}

/**
 * Initiates Complimentary / Non-Chargeable (NC) bill workflow.
 * Enforces Owner PIN elevation before displaying reason prompt.
 */
function promptNCBillSettlement() {
  if (cart.length === 0) {
    alert("Please add at least one dish to the check before issuing a complimentary bill.");
    return;
  }

  requestOwnerElevation("Authorize Complimentary / NC Bill (₹0.00)", () => {
    openNCReasonModal();
  });
}

function openNCReasonModal() {
  document.getElementById("nc-reason-modal").classList.remove("hidden");
}

function closeNCReasonModal() {
  document.getElementById("nc-reason-modal").classList.add("hidden");
}

function onNCReasonSelectChange(val) {
  const customWrap = document.getElementById("nc-custom-reason-wrap");
  if (val === "Other") {
    customWrap.classList.remove("hidden");
  } else {
    customWrap.classList.add("hidden");
  }
}

function confirmNCBillSettlement() {
  const selectVal = document.getElementById("nc-reason-select").value;
  let reason = selectVal;
  if (selectVal === "Other") {
    const custom = document.getElementById("nc-custom-reason").value.trim();
    if (!custom) {
      alert("Please provide a specific reason for this complimentary bill.");
      return;
    }
    reason = custom;
  }

  settleNCBill(reason);
}

/**
 * Settles bill with 100% complimentary waiver (₹0.00), logs audit reason,
 * decrements stock, prints NC slip, and sends immediate alert to Store Owner on WhatsApp.
 */
function settleNCBill(reason) {
  const subtotal = PosCart.calculateCartSubtotal(cart);
  const gstRate = appState?.store?.gstRate || 5.0;

  const totals = PosTax.calculateBillTotals(subtotal, null, {
    isNC: true,
    ncReason: reason,
    gstRate
  });

  const billNo = PosStorage.formatBillNumber(appState.billSequence, new Date());
  appState.billSequence = (appState.billSequence || 1) + 1;

  // Customer details
  activeCustomer.name = document.getElementById("pay-cust-name").value.trim() || "Guest (NC)";
  activeCustomer.phone = document.getElementById("pay-cust-phone").value.trim();
  activeCustomer.gstin = document.getElementById("pay-cust-gstin").value.trim();

  const tableObj = (appState.tables || []).find(t => t.id === activeTableId);

  const billRecord = {
    billNo,
    timestamp: new Date().toLocaleString("en-IN"),
    date: PosStorage.getLocalDateString(),
    time: new Date().toLocaleTimeString("en-IN", { hour: '2-digit', minute: '2-digit' }),
    orderType: activeOrderMode,
    tableName: tableObj ? tableObj.name : null,
    tableId: activeTableId,
    tokenNumber: activeOrderMode !== "dinein" ? appState.dailyTokenCounter : null,
    cashier: currentUser ? currentUser.name : "Cashier",
    customerName: activeCustomer.name,
    customerPhone: activeCustomer.phone,
    customerGstin: activeCustomer.gstin,
    items: [...cart],
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    discountReason: reason,
    isNC: true,
    ncReason: reason,
    taxableAmount: 0,
    sacCode: totals.sacCode,
    gstRate: totals.gstRate,
    cgstRate: totals.cgstRate,
    sgstRate: totals.sgstRate,
    cgst: 0,
    sgst: 0,
    totalTax: 0,
    roundoff: 0,
    grandTotal: 0,
    paymentMode: "COMPLIMENTARY",
    amountTendered: 0,
    changeDue: 0,
    isComposition: false,
    isCancelled: false
  };

  // Decrement critical stock for tracked items
  decrementSoldProductStock(billRecord.items);

  // Add to sales ledger
  if (!appState.salesLedger) appState.salesLedger = [];
  appState.salesLedger.unshift(billRecord);

  // Clean up order state
  if (activeOrderMode === "dinein" && activeTableId) {
    delete appState.openOrders[activeTableId];
  } else {
    appState.dailyTokenCounter++;
  }

  saveAppState();
  renderPosItems();
  updateHeaderStockBadge();
  triggerAutomatedBackup();
  closeNCReasonModal();
  closePaymentDrawer();

  // Send Automatic WhatsApp Alert to Store Owner
  const alertText = PosStorage.formatNCAlertMessage(billRecord, appState.store);
  const ownerPhone = appState?.store?.ownerWhatsApp || appState?.store?.ownerPhone;
  if (ownerPhone) {
    const cleanPhone = PosStorage.normalizePhoneNumber(ownerPhone);
    if (cleanPhone) {
      window.open(`https://wa.me/91${cleanPhone}?text=${encodeURIComponent(alertText)}`, "_blank");
    }
  }

  // Generate ESC/POS thermal text with COMPLIMENTARY banner
  const is58mm = appState?.store?.printerWidth === "58mm";
  const W = is58mm ? 32 : 48;
  const receiptText = is58mm 
    ? PosEscpos.formatBill58mm(billRecord, appState.store)
    : PosEscpos.formatBill80mm(billRecord, appState.store);

  let finalPrintSlip = receiptText;

  // Auto-Print Kitchen Slip (KOT)
  if (appState?.store?.autoPrintKOT !== false) {
    const unsent = PosCart.getUnsentKitchenItems(billRecord.items || cart);
    if (unsent.length > 0) {
      const kotData = {
        orderType: activeOrderMode,
        tableName: tableObj ? tableObj.name : null,
        tokenNumber: billRecord.tokenNumber,
        time: billRecord.time,
        items: unsent
      };
      const kotText = PosEscpos.formatKitchenKOT(kotData, W);
      finalPrintSlip = kotText + "\n" + "=".repeat(W) + "\n\n" + receiptText;
    }
  }

  // Attempt direct spool to Xprinter via local terminal server
  fetch("/api/print", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: finalPrintSlip })
  }).catch(() => {});

  // Open thermal preview
  openThermalPreview(finalPrintSlip, `Complimentary Invoice ${billNo}`);

  // Reset order
  startNewOrder(activeOrderMode);
  refreshHomeStats();
}

// -------------------------------------------------------------
// THERMAL RECEIPT PREVIEW & BROWSER PRINT
// -------------------------------------------------------------

function openThermalPreview(plainText, title = "Receipt Preview") {
  const modal = document.getElementById("thermal-preview-modal");
  const paper = document.getElementById("thermal-paper-slip");
  const is58mm = appState?.store?.printerWidth === "58mm";

  paper.className = `receipt-paper ${is58mm ? 'receipt-58mm' : 'receipt-80mm'}`;
  paper.textContent = plainText;

  document.getElementById("preview-width-label").textContent = is58mm ? "58mm ESC/POS" : "80mm ESC/POS";
  document.getElementById("printable-text").textContent = plainText;

  modal.classList.remove("hidden");
}

function closeThermalPreview() {
  document.getElementById("thermal-preview-modal").classList.add("hidden");
}

function testThermalPrint() {
  const testBill = {
    billNo: "TEST/000001",
    date: PosStorage.getLocalDateString(),
    time: new Date().toLocaleTimeString("en-IN", { hour: '2-digit', minute: '2-digit' }),
    orderType: "Counter",
    tokenNumber: 99,
    cashier: currentUser ? currentUser.name : "Cashier",
    items: [
      { name: "Chicken Burger", qty: 2, unitPrice: 120 },
      { name: "Peri Peri Fries (L)", qty: 1, unitPrice: 90 },
      { name: "Mint Mojito", qty: 2, unitPrice: 80 }
    ],
    subtotal: 490,
    taxableAmount: 490,
    cgst: 12.25,
    sgst: 12.25,
    roundoff: 0.50,
    grandTotal: 515,
    paymentMode: "Cash",
    changeDue: 85
  };

  const is58mm = appState?.store?.printerWidth === "58mm";
  const text = is58mm 
    ? PosEscpos.formatBill58mm(testBill, appState.store)
    : PosEscpos.formatBill80mm(testBill, appState.store);

  openThermalPreview(text, "Thermal Printer Test");
}

// -------------------------------------------------------------
// DINE-IN TABLES FLOOR PLAN (Spec §7.4)
// -------------------------------------------------------------

let activeTableSectionFilter = "all";

/**
 * Dynamically renders section filter buttons with active pill animation.
 */
function renderTableSectionFilters() {
  const container = document.getElementById("table-section-filters");
  if (!container) return;

  const tables = appState?.tables || [];
  const rawSections = tables.filter(t => t.isActive).map(t => t.section || "Main Hall");
  const uniqueSections = Array.from(new Set(rawSections));
  if (uniqueSections.length === 0) {
    uniqueSections.push("Main Hall");
  }

  // If currently active section filter no longer exists, reset to "all"
  if (activeTableSectionFilter !== "all" && !uniqueSections.includes(activeTableSectionFilter)) {
    activeTableSectionFilter = "all";
  }

  const allSections = ["all", ...uniqueSections];
  container.innerHTML = "";

  allSections.forEach(sec => {
    const isAct = activeTableSectionFilter === sec;
    const label = sec === "all" ? "All" : sec;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `px-3 py-1 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer ${
      isAct
        ? "bg-[#171717] text-white shadow-sm scale-[1.02]"
        : "text-[#5C534B] hover:text-[#171717] hover:bg-stone-200/50"
    }`;
    btn.textContent = label;
    btn.onclick = () => filterTableSection(sec);
    container.appendChild(btn);
  });
}

/**
 * Filters floor tables by floor section with smooth tab movement.
 */
function filterTableSection(section) {
  activeTableSectionFilter = section;
  renderTableSectionFilters();
  renderTablesGrid();
}

/**
 * Renders floor plan grid with live table occupancy and quick edit/delete actions.
 */
function renderTablesGrid() {
  const grid = document.getElementById("tables-floor-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const tables = appState?.tables || [];
  const openOrders = appState?.openOrders || {};

  const filtered = tables.filter(t => {
    if (!t.isActive) return false;
    if (activeTableSectionFilter !== "all" && (t.section || "Main Hall") !== activeTableSectionFilter) return false;
    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-12 text-center text-[#5C534B] text-xs">
        No active tables in "${activeTableSectionFilter === 'all' ? 'Floor Plan' : activeTableSectionFilter}". Click "+ Add Table" to add one.
      </div>`;
    return;
  }

  filtered.forEach(tbl => {
    const order = openOrders[tbl.id];
    const isOccupied = Boolean(order && order.items && order.items.length > 0);

    const card = document.createElement("div");
    card.className = `p-4 rounded-2xl border-2 flex flex-col justify-between h-40 cursor-pointer shadow-sm hover:shadow-md transition-all select-none relative group ${
      isOccupied ? 'table-card-occupied' : 'table-card-free hover:border-[#171717]'
    }`;

    card.onclick = () => {
      startNewOrder("dinein", tbl.id);
    };

    const statusBadge = isOccupied
      ? `<span class="chip chip-brown !text-[10px] !py-0.5 !px-2"><span class="w-1.5 h-1.5 rounded-full bg-[#6B4226]"></span> Occupied</span>`
      : `<span class="chip !text-[10px] !py-0.5 !px-2 bg-stone-100 text-stone-600">Free</span>`;

    const runningTotal = isOccupied
      ? `₹${PosCart.calculateCartSubtotal(order.items).toFixed(2)}`
      : '—';

    card.innerHTML = `
      <div>
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-[#5C534B]">${tbl.section || 'Main Hall'}</span>
          <div class="flex items-center gap-1">
            ${statusBadge}
            <button onclick="event.stopPropagation(); openAddTableModal('${tbl.id}')" 
              class="p-1 rounded-md text-stone-400 hover:text-[#171717] hover:bg-white/80 transition-all opacity-80 group-hover:opacity-100" title="Edit Table Name / Seats">
              <span class="material-symbols-outlined text-[15px]">edit</span>
            </button>
            <button onclick="event.stopPropagation(); deleteTable('${tbl.id}', event)" 
              class="p-1 rounded-md text-stone-400 hover:text-red-600 hover:bg-red-50 transition-all opacity-80 group-hover:opacity-100" title="Delete Table">
              <span class="material-symbols-outlined text-[15px]">delete</span>
            </button>
          </div>
        </div>
        <h3 class="text-xl font-extrabold text-[#171717] mt-2">${tbl.name}</h3>
        <p class="text-[11px] text-[#5C534B]">${tbl.seats || 4} Seats</p>
      </div>

      <div class="flex items-center justify-between pt-2 border-t border-[#E5DDD3]">
        <span class="text-xs text-[#5C534B] font-semibold">${isOccupied ? `${order.items.length} items` : 'Ready'}</span>
        <span class="text-sm font-extrabold font-mono text-[#171717]">${runningTotal}</span>
      </div>
    `;

    grid.appendChild(card);
  });
}

/**
 * Opens Add or Edit Table dialog.
 */
function openAddTableModal(tableId = null) {
  const modal = document.getElementById("table-modal");
  if (!modal) return;

  const titleEl = document.getElementById("table-modal-title");
  const submitBtn = document.getElementById("table-modal-submit-btn");
  const idInput = document.getElementById("tbl-form-id");
  const nameInput = document.getElementById("tbl-form-name");
  const sectionInput = document.getElementById("tbl-form-section");
  const seatsInput = document.getElementById("tbl-form-seats");

  if (tableId) {
    const tbl = (appState?.tables || []).find(t => t.id === tableId);
    if (tbl) {
      if (titleEl) titleEl.textContent = "Edit Table";
      if (submitBtn) submitBtn.textContent = "Update Table";
      idInput.value = tbl.id;
      nameInput.value = tbl.name;
      sectionInput.value = tbl.section || "Main Hall";
      seatsInput.value = tbl.seats || 4;
    }
  } else {
    if (titleEl) titleEl.textContent = "Add New Table";
    if (submitBtn) submitBtn.textContent = "Save Table";
    idInput.value = "";
    nameInput.value = "";
    sectionInput.value = activeTableSectionFilter !== "all" ? activeTableSectionFilter : "Main Hall";
    seatsInput.value = 4;
  }

  modal.classList.remove("hidden");
  nameInput.focus();
}

/**
 * Closes Table dialog.
 */
function closeTableModal() {
  const modal = document.getElementById("table-modal");
  if (modal) modal.classList.add("hidden");
}

/**
 * Saves new or modified table record to state.
 */
function saveTableForm(event) {
  if (event) event.preventDefault();

  const id = document.getElementById("tbl-form-id")?.value;
  const name = document.getElementById("tbl-form-name")?.value.trim();
  const section = document.getElementById("tbl-form-section")?.value.trim() || "Main Hall";
  const seats = parseInt(document.getElementById("tbl-form-seats")?.value, 10) || 4;

  if (!name) {
    alert("Please enter a valid table name.");
    return;
  }

  if (!appState.tables) appState.tables = [];

  if (id) {
    const existing = appState.tables.find(t => t.id === id);
    if (existing) {
      existing.name = name;
      existing.section = section;
      existing.seats = seats;
    }
  } else {
    const newTbl = {
      id: `tbl_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      name,
      section,
      seats,
      isActive: true
    };
    appState.tables.push(newTbl);
  }

  saveAppState();
  closeTableModal();
  renderTableSectionFilters();
  renderTablesGrid();
  populateTableDropdown();
}

/**
 * Removes a table from the floor plan after ensuring no active orders are open.
 */
function deleteTable(tableId, event) {
  if (event) event.stopPropagation();

  const openOrders = appState?.openOrders || {};
  const order = openOrders[tableId];
  if (order && order.items && order.items.length > 0) {
    alert("Cannot delete an occupied table! Please settle or cancel the active order first.");
    return;
  }

  const tbl = (appState?.tables || []).find(t => t.id === tableId);
  const tblName = tbl ? tbl.name : "this table";
  if (!confirm(`Are you sure you want to remove ${tblName} from the floor plan?`)) {
    return;
  }

  appState.tables = (appState.tables || []).filter(t => t.id !== tableId);
  if (appState.openOrders && appState.openOrders[tableId]) {
    delete appState.openOrders[tableId];
  }

  saveAppState();
  renderTableSectionFilters();
  renderTablesGrid();
  populateTableDropdown();
}

// -------------------------------------------------------------
// BILL HISTORY, REPRINT & AUDIT CANCELLATION (Spec §7.9)
// -------------------------------------------------------------

function renderBillHistory() {
  const tbody = document.getElementById("history-table-body");
  tbody.innerHTML = "";

  const sales = appState.salesLedger || [];
  const query = (document.getElementById("history-search-input")?.value || "").toLowerCase().trim();
  const statusFilter = document.getElementById("history-status-filter")?.value || "all";

  const filtered = sales.filter(bill => {
    if (statusFilter === "active" && bill.isCancelled) return false;
    if (statusFilter === "cancelled" && !bill.isCancelled) return false;

    if (query) {
      const matchNo = bill.billNo.toLowerCase().includes(query);
      const matchPhone = (bill.customerPhone || "").includes(query);
      const matchDate = (bill.date || "").includes(query);
      return matchNo || matchPhone || matchDate;
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="p-8 text-center text-[#5C534B] text-xs">No invoices found.</td>
      </tr>`;
    return;
  }

  filtered.forEach(bill => {
    const tr = document.createElement("tr");
    tr.className = bill.isCancelled ? "bg-red-50/40 text-stone-500" : "hover:bg-[#FCFAF8]";

    const statusBadge = bill.isCancelled
      ? `<span class="chip chip-danger !text-[10px] !py-0.5 !px-2">CANCELLED</span>`
      : `<span class="chip chip-success !text-[10px] !py-0.5 !px-2">PAID</span>`;

    tr.innerHTML = `
      <td class="p-3 font-mono font-bold text-[#171717]">${bill.billNo}</td>
      <td class="p-3 text-[#5C534B]">${bill.timestamp}</td>
      <td class="p-3 font-semibold">${bill.tableName || bill.orderType}</td>
      <td class="p-3 text-[#5C534B]">${bill.cashier || 'Cashier'}</td>
      <td class="p-3 font-bold text-xs">${bill.paymentMode}</td>
      <td class="p-3 text-right font-mono">₹${(bill.taxableAmount || 0).toFixed(2)}</td>
      <td class="p-3 text-right font-mono">₹${(bill.totalTax || 0).toFixed(2)}</td>
      <td class="p-3 text-right font-mono font-bold text-[#171717]">₹${(bill.grandTotal || 0).toFixed(2)}</td>
      <td class="p-3 text-center">${statusBadge}</td>
      <td class="p-3 text-center">
        <div class="flex items-center justify-center gap-1">
          <button onclick="reprintBill('${bill.billNo}')" class="px-2 py-1 rounded bg-[#F6F2EC] hover:bg-[#171717] hover:text-white text-xs font-semibold" title="Reprint (Duplicate)">
            Reprint
          </button>
          ${!bill.isCancelled ? `
            <button onclick="openCancelBillModal('${bill.billNo}')" class="px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-100 text-xs font-semibold" title="Cancel Bill (Owner PIN)">
              Cancel
            </button>
          ` : ''}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function filterBillHistory() {
  renderBillHistory();
}

function reprintBill(billNo) {
  const bill = (appState.salesLedger || []).find(b => b.billNo === billNo);
  if (!bill) return;

  const duplicateBill = { ...bill, isDuplicate: true };
  const is58mm = appState?.store?.printerWidth === "58mm";
  const text = is58mm
    ? PosEscpos.formatBill58mm(duplicateBill, appState.store)
    : PosEscpos.formatBill80mm(duplicateBill, appState.store);

  openThermalPreview(text, `Reprint ${billNo} (DUPLICATE)`);
}

function openCancelBillModal(billNo) {
  cancelTargetBillNo = billNo;
  const bill = (appState.salesLedger || []).find(b => b.billNo === billNo);
  if (!bill) return;

  document.getElementById("cancel-bill-no-label").textContent = `Bill No: ${bill.billNo}`;
  document.getElementById("cancel-bill-amt-label").textContent = `Amount: ₹${bill.grandTotal.toFixed(2)} (${bill.paymentMode})`;
  document.getElementById("cancel-reason-input").value = "";
  document.getElementById("cancel-owner-pin").value = "";

  document.getElementById("cancel-bill-modal").classList.remove("hidden");
}

function closeCancelBillModal() {
  document.getElementById("cancel-bill-modal").classList.add("hidden");
}

function executeCancelBill() {
  const reason = document.getElementById("cancel-reason-input").value.trim();
  const pin = document.getElementById("cancel-owner-pin").value.trim();

  if (!reason) {
    alert("Mandatory cancellation reason is required for audit compliance.");
    return;
  }

  if (!PosAuth.verifyOwnerPin(pin, appState.staff)) {
    alert("Invalid Owner PIN. Bill cancellation requires authorized owner PIN.");
    return;
  }

  const bill = (appState.salesLedger || []).find(b => b.billNo === cancelTargetBillNo);
  if (!bill) return;

  bill.isCancelled = true;
  bill.cancelReason = reason;
  bill.cancelledAt = new Date().toISOString();
  bill.cancelledBy = "Owner";

  saveAppState();
  closeCancelBillModal();
  renderBillHistory();
  refreshHomeStats();

  alert(`Tax Invoice ${cancelTargetBillNo} has been marked CANCELLED. Excluded from sales reports.`);
}

// -------------------------------------------------------------
// OWNER REPORTS & Z-REPORT (Spec §7.10)
// -------------------------------------------------------------

function renderOwnerReports() {
  const summary = PosStorage.aggregateSalesSummary(appState.salesLedger);

  document.getElementById("report-kpi-sales").textContent = `₹${summary.grossSales.toFixed(2)}`;
  document.getElementById("report-kpi-bills").textContent = summary.billCount;
  document.getElementById("report-kpi-cgst").textContent = `₹${summary.cgst.toFixed(2)}`;
  document.getElementById("report-kpi-sgst").textContent = `₹${summary.sgst.toFixed(2)}`;

  document.getElementById("report-tender-cash").textContent = `₹${summary.payments.cash.total.toFixed(2)}`;
  document.getElementById("report-tender-upi").textContent = `₹${summary.payments.upi.total.toFixed(2)}`;
  document.getElementById("report-tender-card").textContent = `₹${summary.payments.card.total.toFixed(2)}`;
  document.getElementById("report-drawer-cash").textContent = `₹${summary.payments.cash.total.toFixed(2)}`;

  const itemTbody = document.getElementById("report-items-table-body");
  itemTbody.innerHTML = "";

  if (summary.itemSales.length === 0) {
    itemTbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-[#5C534B]">No item sales recorded.</td></tr>`;
  } else {
    summary.itemSales.forEach(it => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="p-2 font-bold text-[#171717]">${it.name}</td>
        <td class="p-2 text-[#5C534B]">${it.category}</td>
        <td class="p-2 text-right font-mono font-bold">${it.qty}</td>
        <td class="p-2 text-right font-mono font-bold">₹${it.revenue.toFixed(2)}</td>
      `;
      itemTbody.appendChild(tr);
    });
  }

  // Menu Engineering: Top 5 Best Sellers vs Bottom 5 Slow Movers (Feature 8)
  const topSellersContainer = document.getElementById("report-top-sellers");
  const slowMoversContainer = document.getElementById("report-slow-movers");
  if (topSellersContainer && slowMoversContainer) {
    topSellersContainer.innerHTML = "";
    slowMoversContainer.innerHTML = "";

    const products = appState.products || [];
    const salesMap = {};
    summary.itemSales.forEach(it => {
      salesMap[it.id] = it;
      salesMap[it.name] = it;
    });

    const catalogMetrics = products.map(p => {
      const s = salesMap[p.id] || salesMap[p.name];
      return {
        id: p.id,
        name: p.name,
        category: p.category || "General",
        price: p.price,
        qty: s ? s.qty : 0,
        revenue: s ? s.revenue : 0
      };
    });

    // Top 5 Star Performers
    const stars = [...catalogMetrics].sort((a, b) => b.qty - a.qty).slice(0, 5);
    if (stars.length === 0 || stars.every(s => s.qty === 0)) {
      topSellersContainer.innerHTML = '<div class="py-3 text-center text-[#5C534B]">No sales recorded yet.</div>';
    } else {
      stars.forEach((st, idx) => {
        const row = document.createElement("div");
        row.className = "flex items-center justify-between py-2";
        row.innerHTML = `
          <div class="flex items-center gap-2">
            <span class="w-5 h-5 rounded-full bg-amber-100 text-amber-800 font-extrabold text-[10px] flex items-center justify-center">#${idx + 1}</span>
            <div>
              <div class="font-bold text-[#171717]">${st.name}</div>
              <div class="text-[10px] text-[#5C534B]">${st.category}</div>
            </div>
          </div>
          <div class="text-right">
            <span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold font-mono text-[11px]">${st.qty} sold</span>
            <div class="font-bold font-mono text-[#171717] mt-0.5">₹${st.revenue.toFixed(2)}</div>
          </div>
        `;
        topSellersContainer.appendChild(row);
      });
    }

    // Bottom 5 Slow Movers
    const slow = [...catalogMetrics].sort((a, b) => a.qty - b.qty).slice(0, 5);
    if (slow.length === 0) {
      slowMoversContainer.innerHTML = '<div class="py-3 text-center text-[#5C534B]">No menu items found.</div>';
    } else {
      slow.forEach(sl => {
        const row = document.createElement("div");
        row.className = "flex items-center justify-between py-2";
        row.innerHTML = `
          <div>
            <div class="font-bold text-[#171717]">${sl.name}</div>
            <div class="text-[10px] text-[#5C534B]">${sl.category} • Base ₹${sl.price}</div>
          </div>
          <div class="text-right">
            <span class="px-2 py-0.5 rounded-full ${sl.qty === 0 ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'} font-bold font-mono text-[11px]">
              ${sl.qty === 0 ? '0 sold (Dead item)' : `${sl.qty} sold`}
            </span>
          </div>
        `;
        slowMoversContainer.appendChild(row);
      });
    }
  }
}

/**
 * Sends a 1-click formatted daily summary directly to Owner's WhatsApp (Feature 7).
 */
function shareWhatsAppSummary() {
  const summary = PosStorage.aggregateSalesSummary(appState.salesLedger, {
    startDate: PosStorage.getLocalDateString()
  });
  summary.date = PosStorage.getLocalDateString();
  const msg = PosStorage.formatWhatsAppDailySummary(summary, appState.store || {});

  let phone = (appState.store?.ownerWhatsApp || appState.store?.phone || "").replace(/[^0-9]/g, "");
  if (phone.length === 10) {
    phone = "91" + phone;
  }

  const encoded = encodeURIComponent(msg);
  const waUrl = phone ? `https://wa.me/${phone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
  window.open(waUrl, "_blank");
}

function printDailyZReport() {
  const summary = PosStorage.aggregateSalesSummary(appState.salesLedger, {
    startDate: PosStorage.getLocalDateString()
  });
  summary.date = PosStorage.getLocalDateString();

  const is58mm = appState?.store?.printerWidth === "58mm";
  const zText = PosEscpos.formatZReportSlip(summary, appState.store, is58mm ? 32 : 48);

  openThermalPreview(zText, "Daily Sales Z-Report");
}

function exportReportsCSV() {
  const sales = appState.salesLedger || [];
  if (sales.length === 0) {
    alert("No sales data to export.");
    return;
  }

  let csv = "Bill Number,Date,Time,Order Type,Cashier,Mode,Subtotal,Discount,Taxable (SAC 9963),CGST (2.5%),SGST (2.5%),Grand Total,Status,Cancel Reason\n";
  sales.forEach(b => {
    csv += `"${b.billNo}","${b.date}","${b.time}","${b.orderType}","${b.cashier}","${b.paymentMode}",${b.subtotal},${b.discountAmount || 0},${b.taxableAmount},${b.cgst},${b.sgst},${b.grandTotal},"${b.isCancelled ? 'CANCELLED' : 'PAID'}","${b.cancelReason || ''}"\n`;
  });

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Retro_Cafeteria_Sales_${PosStorage.getLocalDateString()}.csv`;
  a.click();
}

// -------------------------------------------------------------
// MENU & PRODUCT MANAGEMENT (Spec §7.11)
// -------------------------------------------------------------

function renderMenuManager() {
  const tbody = document.getElementById("menu-products-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const products = appState?.products || [];
  const categories = appState?.categories || [];

  // Update category filter dropdown in menu manager header
  const catFilterSelect = document.getElementById("menu-manager-category-filter");
  if (catFilterSelect) {
    const currentVal = catFilterSelect.value || "all";
    catFilterSelect.innerHTML = '<option value="all">All Categories</option>';
    categories.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.name;
      opt.textContent = c.name;
      if (c.name === currentVal) opt.selected = true;
      catFilterSelect.appendChild(opt);
    });
  }

  const query = (document.getElementById("menu-manager-search")?.value || "").toLowerCase().trim();
  const selectedCat = catFilterSelect?.value || "all";

  const filtered = products.filter(p => {
    if (selectedCat !== "all" && p.category !== selectedCat) return false;
    if (query) {
      const matchName = (p.name || "").toLowerCase().includes(query);
      const matchCode = (p.shortCode || "").toLowerCase().includes(query);
      if (!matchName && !matchCode) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    const emptyMsg = products.length === 0
      ? 'No products in menu. Click "Add Product" or "Sample Menu" to populate.'
      : 'No dishes match the selected category or search filter.';
    tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-[#5C534B]">${emptyMsg}</td></tr>`;
    return;
  }

  filtered.forEach(p => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-[#FCFAF8]";

    const dietMark = p.diet === "veg"
      ? `<span class="diet-veg" title="Vegetarian"><span class="diet-veg-dot"></span></span>`
      : `<span class="diet-non-veg" title="Non-Vegetarian"><span class="diet-non-veg-dot"></span></span>`;

    const sizesCount = Array.isArray(p.sizes) ? p.sizes.length : 0;
    const addonsCount = Array.isArray(p.addons) ? p.addons.length : 0;

    const sizesBadge = sizesCount > 0
      ? `<span class="text-[10px] font-mono font-bold bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded ml-1" title="${p.sizes.map(s => `${s.name}: ₹${s.price}`).join(', ')}">${sizesCount} sizes</span>`
      : '';

    const addonsBadge = addonsCount > 0
      ? `<span class="text-[10px] font-mono font-bold bg-blue-50 text-blue-800 border border-blue-200 px-1.5 py-0.5 rounded ml-1" title="${p.addons.map(a => `${a.name}: +₹${a.price}`).join(', ')}">${addonsCount} add-ons</span>`
      : '';

    tr.innerHTML = `
      <td class="p-3 font-bold text-[#171717]">
        <div class="flex items-center flex-wrap gap-1">
          <span>${p.name}</span>
          ${sizesBadge}
          ${addonsBadge}
        </div>
      </td>
      <td class="p-3 font-mono font-bold text-xs bg-stone-100 rounded px-1">${p.shortCode || '—'}</td>
      <td class="p-3 text-[#5C534B] font-medium">${p.category || 'General'}</td>
      <td class="p-3 text-right font-mono font-bold text-[#171717]">₹${(p.price || 0).toFixed(2)}</td>
      <td class="p-3 text-center font-mono">${p.gstRate || 5.0}%</td>
      <td class="p-3 text-center">${dietMark}</td>
      <td class="p-3 text-center">
        <button onclick="toggleProductAvailability('${p.id}')" class="px-2 py-0.5 rounded text-[11px] font-bold ${p.isAvailable ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}">
          ${p.isAvailable ? 'In Stock' : 'Sold Out'}
        </button>
      </td>
      <td class="p-3 text-center">
        <div class="flex items-center justify-center gap-1">
          <button onclick="editProduct('${p.id}')" class="p-1 rounded hover:bg-[#F6F2EC] text-[#5C534B] hover:text-[#171717]" title="Edit Dish">
            <span class="material-symbols-outlined text-[16px]">edit</span>
          </button>
          <button onclick="duplicateProduct('${p.id}')" class="p-1 rounded hover:bg-stone-100 text-stone-500 hover:text-[#171717]" title="Duplicate / Clone Dish">
            <span class="material-symbols-outlined text-[16px]">content_copy</span>
          </button>
          <button onclick="deleteProduct('${p.id}')" class="p-1 rounded text-red-600 hover:bg-red-50" title="Delete Dish">
            <span class="material-symbols-outlined text-[16px]">delete</span>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// -------------------------------------------------------------
// CATEGORY MANAGEMENT (Add, Rename, Delete Categories)
// -------------------------------------------------------------

function openCategoryManagerModal() {
  const modal = document.getElementById("category-modal");
  if (!modal) return;

  cancelEditCategory();
  renderCategoryTable();
  modal.classList.remove("hidden");
}

function closeCategoryModal() {
  const modal = document.getElementById("category-modal");
  if (modal) modal.classList.add("hidden");
  populateProductCategorySelect();
  renderPosCategories();
  renderMenuManager();
}

function renderCategoryTable() {
  const tbody = document.getElementById("category-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const categories = appState?.categories || [];
  const products = appState?.products || [];

  if (categories.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="p-6 text-center text-[#5C534B]">No categories defined. Add your first category above!</td></tr>`;
    return;
  }

  categories.forEach(cat => {
    const dishCount = products.filter(p => p.category === cat.name).length;
    const tr = document.createElement("tr");
    tr.className = "hover:bg-[#FCFAF8]";
    tr.innerHTML = `
      <td class="p-2.5 font-bold text-[#171717]">${cat.name}</td>
      <td class="p-2.5 text-center font-mono font-bold text-[#5C534B]">${dishCount}</td>
      <td class="p-2.5 text-right">
        <div class="flex items-center justify-end gap-1">
          <button onclick="startEditCategory('${cat.id}')" class="p-1 rounded text-stone-500 hover:text-[#171717] hover:bg-stone-100" title="Rename Category">
            <span class="material-symbols-outlined text-[16px]">edit</span>
          </button>
          <button onclick="deleteCategory('${cat.id}')" class="p-1 rounded text-red-500 hover:text-red-700 hover:bg-red-50" title="Delete Category">
            <span class="material-symbols-outlined text-[16px]">delete</span>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function startEditCategory(catId) {
  const cat = (appState?.categories || []).find(c => c.id === catId);
  if (!cat) return;

  const idInput = document.getElementById("cat-form-id");
  const nameInput = document.getElementById("cat-form-name");
  const labelEl = document.getElementById("cat-form-label");
  const submitBtn = document.getElementById("cat-form-submit-btn");
  const cancelBtn = document.getElementById("cat-form-cancel-edit-btn");

  if (idInput) idInput.value = cat.id;
  if (nameInput) nameInput.value = cat.name;
  if (labelEl) labelEl.textContent = "Edit Category Name";
  if (submitBtn) submitBtn.innerHTML = '<span class="material-symbols-outlined text-[15px]">check</span> Update';
  if (cancelBtn) cancelBtn.classList.remove("hidden");
  if (nameInput) nameInput.focus();
}

function cancelEditCategory() {
  const idInput = document.getElementById("cat-form-id");
  const nameInput = document.getElementById("cat-form-name");
  const labelEl = document.getElementById("cat-form-label");
  const submitBtn = document.getElementById("cat-form-submit-btn");
  const cancelBtn = document.getElementById("cat-form-cancel-edit-btn");

  if (idInput) idInput.value = "";
  if (nameInput) nameInput.value = "";
  if (labelEl) labelEl.textContent = "Category Name";
  if (submitBtn) submitBtn.innerHTML = '<span class="material-symbols-outlined text-[15px]">add</span> Add Category';
  if (cancelBtn) cancelBtn.classList.add("hidden");
}

function saveCategoryForm(event) {
  if (event) event.preventDefault();

  const id = document.getElementById("cat-form-id")?.value;
  const name = document.getElementById("cat-form-name")?.value.trim();

  if (!name) {
    alert("Please enter a category name.");
    return;
  }

  if (!appState.categories) appState.categories = [];

  if (id) {
    const cat = appState.categories.find(c => c.id === id);
    if (cat) {
      const oldName = cat.name;
      const clash = appState.categories.find(c => c.id !== id && c.name.toLowerCase() === name.toLowerCase());
      if (clash) {
        alert(`A category named "${name}" already exists.`);
        return;
      }
      cat.name = name;
      (appState.products || []).forEach(p => {
        if (p.category === oldName) {
          p.category = name;
        }
      });
    }
  } else {
    const clash = appState.categories.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (clash) {
      alert(`A category named "${name}" already exists.`);
      return;
    }
    const newCat = {
      id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      name,
      icon: "category",
      sortOrder: appState.categories.length + 1
    };
    appState.categories.push(newCat);
  }

  saveAppState();
  cancelEditCategory();
  renderCategoryTable();
  populateProductCategorySelect();
  renderPosCategories();
  renderMenuManager();
}

function deleteCategory(catId) {
  const cat = (appState?.categories || []).find(c => c.id === catId);
  if (!cat) return;

  const count = (appState.products || []).filter(p => p.category === cat.name).length;
  if (count > 0) {
    if (!confirm(`Category "${cat.name}" has ${count} dish(es). Deleting it will reassign these dishes to "General". Proceed?`)) {
      return;
    }
    (appState.products || []).forEach(p => {
      if (p.category === cat.name) {
        p.category = "General";
      }
    });
    if (!appState.categories.some(c => c.name === "General")) {
      appState.categories.push({ id: "cat_general", name: "General", icon: "category", sortOrder: 99 });
    }
  } else {
    if (!confirm(`Are you sure you want to delete category "${cat.name}"?`)) {
      return;
    }
  }

  appState.categories = appState.categories.filter(c => c.id !== catId);
  saveAppState();
  cancelEditCategory();
  renderCategoryTable();
  populateProductCategorySelect();
  renderPosCategories();
  renderMenuManager();
}

function quickAddCategoryPrompt() {
  const name = prompt("Enter new category name:");
  if (!name || !name.trim()) return;
  const cleanName = name.trim();

  if (!appState.categories) appState.categories = [];
  const existing = appState.categories.find(c => c.name.toLowerCase() === cleanName.toLowerCase());
  if (existing) {
    populateProductCategorySelect(existing.name);
    return;
  }

  const newCat = {
    id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
    name: cleanName,
    icon: "category",
    sortOrder: appState.categories.length + 1
  };
  appState.categories.push(newCat);
  saveAppState();
  populateProductCategorySelect(cleanName);
  renderPosCategories();
}

// -------------------------------------------------------------
// PRODUCT PORTION SIZES & ADD-ONS BUILDERS
// -------------------------------------------------------------

function addProductSizeRow(name = "", price = "") {
  const container = document.getElementById("prod-sizes-rows-container");
  if (!container) return;

  const row = document.createElement("div");
  row.className = "flex items-center gap-2 size-row";
  row.innerHTML = `
    <input type="text" placeholder="Size Name (e.g. Regular, Large, Half)" value="${escapeHtml(name)}" 
      class="size-name-input flex-1 p-2 bg-white border border-[#E5DDD3] rounded-lg text-xs font-semibold focus:outline-none focus:border-[#171717]">
    <div class="flex items-center w-28">
      <span class="px-2 py-2 bg-stone-100 border border-r-0 border-[#E5DDD3] rounded-l-lg text-xs font-bold text-[#5C534B]">₹</span>
      <input type="number" step="1" min="0" placeholder="Price" value="${price !== undefined && price !== null ? price : ''}" 
        class="size-price-input w-full p-2 bg-white border border-[#E5DDD3] rounded-r-lg font-mono font-bold text-xs focus:outline-none focus:border-[#171717]">
    </div>
    <button type="button" onclick="this.closest('.size-row').remove()" class="p-1.5 rounded-lg text-stone-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Remove Size">
      <span class="material-symbols-outlined text-[16px]">close</span>
    </button>
  `;
  container.appendChild(row);
}

function addProductAddonRow(name = "", price = "") {
  const container = document.getElementById("prod-addons-rows-container");
  if (!container) return;

  const row = document.createElement("div");
  row.className = "flex items-center gap-2 addon-row";
  row.innerHTML = `
    <input type="text" placeholder="Add-on Name (e.g. Extra Cheese)" value="${escapeHtml(name)}" 
      class="addon-name-input flex-1 p-2 bg-white border border-[#E5DDD3] rounded-lg text-xs font-semibold focus:outline-none focus:border-[#171717]">
    <div class="flex items-center w-28">
      <span class="px-2 py-2 bg-stone-100 border border-r-0 border-[#E5DDD3] rounded-l-lg text-xs font-bold text-[#5C534B]">+₹</span>
      <input type="number" step="1" min="0" placeholder="Extra" value="${price !== undefined && price !== null ? price : ''}" 
        class="addon-price-input w-full p-2 bg-white border border-[#E5DDD3] rounded-r-lg font-mono font-bold text-xs focus:outline-none focus:border-[#171717]">
    </div>
    <button type="button" onclick="this.closest('.addon-row').remove()" class="p-1.5 rounded-lg text-stone-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Remove Add-on">
      <span class="material-symbols-outlined text-[16px]">close</span>
    </button>
  `;
  container.appendChild(row);
}

function duplicateProduct(productId) {
  const prod = (appState?.products || []).find(p => p.id === productId);
  if (!prod) return;

  let newCode = `${prod.shortCode || 'ITEM'}1`;
  let counter = 1;
  while ((appState.products || []).some(p => p.shortCode === newCode)) {
    counter++;
    newCode = `${prod.shortCode || 'ITEM'}${counter}`;
  }

  const copy = {
    ...JSON.parse(JSON.stringify(prod)),
    id: `prod_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    name: `${prod.name} (Copy)`,
    shortCode: newCode,
    sortOrder: (appState.products || []).length + 1
  };

  appState.products.push(copy);
  saveAppState();
  renderMenuManager();
  renderPosCategories();
  renderPosItems();
  alert(`Cloned "${prod.name}" as "${copy.name}" [${copy.shortCode}].`);
}

function openAddProductModal() {
  document.getElementById("product-modal-title").textContent = "Add New Product";
  document.getElementById("prod-id").value = "";
  document.getElementById("prod-name").value = "";
  document.getElementById("prod-code").value = "";
  document.getElementById("prod-price").value = "";
  document.getElementById("prod-desc").value = "";
  document.getElementById("prod-notes").value = "";
  document.getElementById("prod-available").checked = true;
  document.getElementById("prod-track-stock").checked = false;
  document.getElementById("prod-stock-qty").value = "";
  document.getElementById("prod-stock-threshold").value = "5";
  document.getElementById("prod-stock-fields").classList.add("hidden");

  // Reset portion sizes and add-ons containers
  const sizesContainer = document.getElementById("prod-sizes-rows-container");
  if (sizesContainer) sizesContainer.innerHTML = "";
  const addonsContainer = document.getElementById("prod-addons-rows-container");
  if (addonsContainer) addonsContainer.innerHTML = "";

  populateProductCategorySelect();
  document.getElementById("product-modal").classList.remove("hidden");
  document.getElementById("prod-name").focus();
}

function toggleStockInputs(checked) {
  const fields = document.getElementById("prod-stock-fields");
  if (fields) {
    if (checked) fields.classList.remove("hidden");
    else fields.classList.add("hidden");
  }
}

function populateProductCategorySelect(selectedCat = "") {
  const select = document.getElementById("prod-category");
  if (!select) return;
  select.innerHTML = "";
  const categories = appState?.categories || [];
  if (categories.length === 0) {
    const defaultCats = ["Burgers", "Fried Chicken", "Pizza", "Shawarma", "Sides & Fries", "Shakes & Mojitos", "Desserts", "General"];
    defaultCats.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      if (c === selectedCat) opt.selected = true;
      select.appendChild(opt);
    });
  } else {
    categories.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.name;
      opt.textContent = c.name;
      if (c.name === selectedCat) opt.selected = true;
      select.appendChild(opt);
    });
  }
}

function closeProductModal() {
  document.getElementById("product-modal").classList.add("hidden");
}

function saveProduct(event) {
  event.preventDefault();
  const id = document.getElementById("prod-id").value;
  const name = document.getElementById("prod-name").value.trim();
  const shortCode = document.getElementById("prod-code").value.trim().toUpperCase();
  const category = document.getElementById("prod-category").value;
  let price = parseFloat(document.getElementById("prod-price").value) || 0;
  const diet = document.getElementById("prod-diet").value;
  const description = document.getElementById("prod-desc").value.trim();
  const notesStr = document.getElementById("prod-notes").value.trim();
  const isAvailable = document.getElementById("prod-available").checked;
  const trackStock = document.getElementById("prod-track-stock").checked;
  const stockQty = parseInt(document.getElementById("prod-stock-qty").value, 10) || 0;
  const lowStockThreshold = parseInt(document.getElementById("prod-stock-threshold").value, 10) || 5;

  const quickNotes = notesStr ? notesStr.split(",").map(s => s.trim()).filter(Boolean) : [];

  // Read Portion Sizes rows
  const sizeRows = Array.from(document.querySelectorAll("#prod-sizes-rows-container .size-row"));
  const sizes = sizeRows.map(row => {
    const sName = row.querySelector(".size-name-input")?.value.trim() || "";
    const sPrice = parseFloat(row.querySelector(".size-price-input")?.value) || 0;
    return { name: sName, price: sPrice };
  }).filter(s => s.name.length > 0);

  // If base price was 0 or omitted but portion sizes exist, default base price to first size
  if (price === 0 && sizes.length > 0) {
    price = sizes[0].price;
  }

  // Read Add-ons rows
  const addonRows = Array.from(document.querySelectorAll("#prod-addons-rows-container .addon-row"));
  const addons = addonRows.map(row => {
    const aName = row.querySelector(".addon-name-input")?.value.trim() || "";
    const aPrice = parseFloat(row.querySelector(".addon-price-input")?.value) || 0;
    return { name: aName, price: aPrice };
  }).filter(a => a.name.length > 0);

  if (!appState.products) appState.products = [];

  // Check unique short-code clash
  const clashing = appState.products.find(p => p.shortCode === shortCode && p.id !== id);
  if (clashing) {
    alert(`Short-code "${shortCode}" is already in use by "${clashing.name}". Please choose a distinct code.`);
    return;
  }

  if (id) {
    // Edit existing product
    const idx = appState.products.findIndex(p => p.id === id);
    if (idx >= 0) {
      appState.products[idx] = {
        ...appState.products[idx],
        name,
        shortCode,
        category,
        price,
        sizes,
        addons,
        diet,
        description,
        quickNotes,
        trackStock,
        stockQty,
        lowStockThreshold,
        isAvailable
      };
    }
  } else {
    // Create new product
    const newProd = {
      id: `prod_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name,
      shortCode,
      category,
      price,
      sizes,
      addons,
      gstRate: appState?.store?.gstRate || 5.0,
      diet,
      description,
      quickNotes,
      trackStock,
      stockQty,
      lowStockThreshold,
      isAvailable,
      sortOrder: appState.products.length + 1
    };
    appState.products.push(newProd);
  }

  saveAppState();
  updateHeaderStockBadge();
  closeProductModal();
  renderMenuManager();
  renderPosCategories();
  renderPosItems();
}

function editProduct(productId) {
  const prod = (appState?.products || []).find(p => p.id === productId);
  if (!prod) return;

  document.getElementById("product-modal-title").textContent = "Edit Product";
  document.getElementById("prod-id").value = prod.id;
  document.getElementById("prod-name").value = prod.name;
  document.getElementById("prod-code").value = prod.shortCode || "";
  document.getElementById("prod-price").value = prod.price;
  document.getElementById("prod-diet").value = prod.diet || "non-veg";
  document.getElementById("prod-desc").value = prod.description || "";
  document.getElementById("prod-notes").value = (prod.quickNotes || []).join(", ");
  document.getElementById("prod-available").checked = prod.isAvailable !== false;
  document.getElementById("prod-track-stock").checked = Boolean(prod.trackStock);
  document.getElementById("prod-stock-qty").value = prod.stockQty !== undefined ? prod.stockQty : "";
  document.getElementById("prod-stock-threshold").value = prod.lowStockThreshold || 5;

  if (prod.trackStock) {
    document.getElementById("prod-stock-fields").classList.remove("hidden");
  } else {
    document.getElementById("prod-stock-fields").classList.add("hidden");
  }

  // Populate Portion Sizes rows
  const sizesContainer = document.getElementById("prod-sizes-rows-container");
  if (sizesContainer) {
    sizesContainer.innerHTML = "";
    if (Array.isArray(prod.sizes) && prod.sizes.length > 0) {
      prod.sizes.forEach(s => addProductSizeRow(s.name, s.price));
    }
  }

  // Populate Add-ons rows
  const addonsContainer = document.getElementById("prod-addons-rows-container");
  if (addonsContainer) {
    addonsContainer.innerHTML = "";
    if (Array.isArray(prod.addons) && prod.addons.length > 0) {
      prod.addons.forEach(a => addProductAddonRow(a.name, a.price));
    }
  }

  populateProductCategorySelect(prod.category);
  document.getElementById("product-modal").classList.remove("hidden");
  document.getElementById("prod-name").focus();
}

function toggleProductAvailability(productId) {
  const prod = (appState.products || []).find(p => p.id === productId);
  if (prod) {
    prod.isAvailable = !prod.isAvailable;
    saveAppState();
    renderMenuManager();
    renderPosItems();
  }
}

function deleteProduct(productId) {
  if (confirm("Delete this product from menu?")) {
    appState.products = (appState.products || []).filter(p => p.id !== productId);
    saveAppState();
    renderMenuManager();
    renderPosCategories();
    renderPosItems();
  }
}

function loadSampleCatalogData() {
  if (confirm("Load official The Retro Cafeteria sample menu and floor tables?")) {
    appState.categories = [...PosCatalog.SAMPLE_CATEGORIES];
    appState.products = [...PosCatalog.SAMPLE_PRODUCTS];
    appState.tables = [...PosCatalog.SAMPLE_TABLES];
    saveAppState();
    renderPosCategories();
    renderPosItems();
    renderMenuManager();
    renderTablesGrid();
    alert("The Retro Cafeteria sample menu loaded successfully!");
  }
}

// Bulk Price Editor
function openBulkPriceModal() {
  const select = document.getElementById("bulk-category-select");
  select.innerHTML = '<option value="all">All Categories</option>';
  (appState.categories || []).forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = c.name;
    select.appendChild(opt);
  });
  document.getElementById("bulk-price-modal").classList.remove("hidden");
}

function closeBulkPriceModal() {
  document.getElementById("bulk-price-modal").classList.add("hidden");
}

function executeBulkPriceChange() {
  const category = document.getElementById("bulk-category-select").value;
  const type = document.getElementById("bulk-type-select").value;
  const val = parseFloat(document.getElementById("bulk-value-input").value);

  if (isNaN(val) || val === 0) {
    alert("Please enter a valid non-zero adjustment value.");
    return;
  }

  let count = 0;
  (appState.products || []).forEach(p => {
    if (category === "all" || p.category === category) {
      if (type === "percent") {
        p.price = Math.round(p.price * (1 + (val / 100)));
      } else {
        p.price = Math.max(1, p.price + val);
      }
      count++;
    }
  });

  saveAppState();
  closeBulkPriceModal();
  renderMenuManager();
  renderPosItems();
  alert(`Updated prices for ${count} dish(es).`);
}

// -------------------------------------------------------------
// SETTINGS & CONFIGURATION (Spec §7.12)
// -------------------------------------------------------------

function loadSettingsForm() {
  const store = appState.store || {};
  document.getElementById("set-name").value = store.name || "";
  document.getElementById("set-tagline").value = store.tagline || "";
  document.getElementById("set-address1").value = store.address1 || "";
  document.getElementById("set-address2").value = store.address2 || "";
  document.getElementById("set-phone").value = store.phone || "";
  document.getElementById("set-gstin").value = store.gstin || "";
  document.getElementById("set-fssai").value = store.fssai || "";
  document.getElementById("set-ownerwhatsapp").value = store.ownerWhatsApp || "";
  document.getElementById("set-upiid").value = store.upiId || "retrocafe@upi";
  document.getElementById("set-printupiqr").value = (store.printUpiQrOnBill !== false) ? "true" : "false";
  document.getElementById("set-gstrate").value = store.gstRate || 5.0;
  document.getElementById("set-taxmode").value = store.taxMode || "exclusive";
  document.getElementById("set-invoicetype").value = store.invoiceType || "tax_invoice";
  document.getElementById("set-printerwidth").value = store.printerWidth || "80mm";
  document.getElementById("set-autoprintkot").value = (store.autoPrintKOT !== false) ? "true" : "false";
  document.getElementById("set-autokickdrawer").value = (store.autoKickCashDrawer !== false) ? "true" : "false";
  document.getElementById("set-backupfolder").value = store.backupFolder || "";
  document.getElementById("set-autobackup").value = (store.autoBackupEnabled !== false) ? "true" : "false";
  document.getElementById("set-discountlimit").value = store.cashierDiscountLimit || 10;

  const cashier = (appState.staff || []).find(s => s.role === "cashier");
  const owner = (appState.staff || []).find(s => s.role === "owner");
  document.getElementById("set-cashierpin").value = cashier ? cashier.pin : "0000";
  document.getElementById("set-ownerpin").value = owner ? owner.pin : "1234";
}

function saveSettings(event) {
  event.preventDefault();
  if (!appState.store) appState.store = {};

  appState.store.name = document.getElementById("set-name").value.trim();
  appState.store.tagline = document.getElementById("set-tagline").value.trim();
  appState.store.address1 = document.getElementById("set-address1").value.trim();
  appState.store.address2 = document.getElementById("set-address2").value.trim();
  appState.store.phone = document.getElementById("set-phone").value.trim();
  appState.store.gstin = document.getElementById("set-gstin").value.trim();
  appState.store.fssai = document.getElementById("set-fssai").value.trim();
  appState.store.ownerWhatsApp = document.getElementById("set-ownerwhatsapp").value.trim();
  appState.store.ownerPhone = document.getElementById("set-ownerwhatsapp").value.trim();
  appState.store.upiId = document.getElementById("set-upiid").value.trim() || "retrocafe@upi";
  appState.store.printUpiQrOnBill = document.getElementById("set-printupiqr").value === "true";
  appState.store.gstRate = parseFloat(document.getElementById("set-gstrate").value) || 5.0;
  appState.store.taxMode = document.getElementById("set-taxmode").value;
  appState.store.invoiceType = document.getElementById("set-invoicetype").value;
  appState.store.printerWidth = document.getElementById("set-printerwidth").value;
  appState.store.autoPrintKOT = document.getElementById("set-autoprintkot").value === "true";
  appState.store.autoKickCashDrawer = document.getElementById("set-autokickdrawer").value === "true";
  appState.store.backupFolder = document.getElementById("set-backupfolder").value.trim();
  appState.store.autoBackupEnabled = document.getElementById("set-autobackup").value === "true";
  appState.store.cashierDiscountLimit = parseInt(document.getElementById("set-discountlimit").value, 10) || 10;

  // Save PINs
  const cPin = document.getElementById("set-cashierpin").value.trim();
  const oPin = document.getElementById("set-ownerpin").value.trim();
  if (PosAuth.isValidPinFormat(cPin)) {
    const cashier = (appState.staff || []).find(s => s.role === "cashier");
    if (cashier) cashier.pin = cPin;
  }
  if (PosAuth.isValidPinFormat(oPin)) {
    const owner = (appState.staff || []).find(s => s.role === "owner");
    if (owner) owner.pin = oPin;
  }

  saveAppState();
  document.getElementById("printer-label").textContent = `${appState.store.printerWidth} Ready`;
  triggerAutomatedBackup();
  alert("Settings saved successfully.");
}

async function triggerAutomatedBackup() {
  if (!appState || appState?.store?.autoBackupEnabled === false) return;
  try {
    const folder = appState?.store?.backupFolder || "";
    const res = await fetch("/api/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folder: folder,
        state: appState
      })
    });
    if (res.ok) {
      const result = await res.json();
      console.log("[POS Auto-Backup] Successfully written to:", result.path);
    }
  } catch (err) {
    console.warn("[POS Auto-Backup] Server unreachable:", err);
  }
}

function exportLocalBackup() {
  const snapshot = JSON.stringify(appState, null, 2);
  const blob = new Blob([snapshot], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Retro_Cafeteria_Backup_${PosStorage.getLocalDateString()}.json`;
  a.click();
}

function importLocalBackup(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (parsed && parsed.version) {
        if (confirm("Restore this database backup? Current unsaved orders will be replaced.")) {
          appState = parsed;
          saveAppState();
          alert("Database successfully restored!");
          window.location.reload();
        }
      } else {
        alert("Invalid backup file format.");
      }
    } catch (err) {
      alert("Corrupted or unreadable backup file.");
    }
  };
  reader.readAsText(file);
}

function confirmResetDemoData() {
  if (confirm("Are you sure you want to reset the database to a blank state? All sales history will be reset.")) {
    appState = PosCatalog.createInitialState(false);
    saveAppState();
    window.location.reload();
  }
}

// -------------------------------------------------------------
// DISCOUNT MODAL & ELEVATION
// -------------------------------------------------------------

function openDiscountModal() {
  document.getElementById("discount-val-input").value = activeDiscount.value || "";
  setDiscountType(activeDiscount.type || "percent");
  document.getElementById("discount-modal").classList.remove("hidden");
}

function closeDiscountModal() {
  document.getElementById("discount-modal").classList.add("hidden");
}

let activeDiscountType = "percent";
let activeDiscountReason = "";

function setDiscountType(type) {
  activeDiscountType = type;
  const btnPct = document.getElementById("disc-btn-pct");
  const btnFlat = document.getElementById("disc-btn-flat");
  if (type === "percent") {
    btnPct.className = "flex-1 py-1.5 rounded-xl border-2 border-[#171717] bg-[#F6F2EC] text-xs font-bold";
    btnFlat.className = "flex-1 py-1.5 rounded-xl border-2 border-[#E5DDD3] bg-white text-xs font-bold";
  } else {
    btnPct.className = "flex-1 py-1.5 rounded-xl border-2 border-[#E5DDD3] bg-white text-xs font-bold";
    btnFlat.className = "flex-1 py-1.5 rounded-xl border-2 border-[#171717] bg-[#F6F2EC] text-xs font-bold";
  }
}

function setDiscountReason(reason) {
  activeDiscountReason = reason;
}

function applyDiscount() {
  const val = parseFloat(document.getElementById("discount-val-input").value) || 0;
  if (val < 0) return;

  // Check cashier discount limit
  const limit = appState?.store?.cashierDiscountLimit || 10;
  if (!PosAuth.isDiscountAllowed(val, currentUser.role, limit)) {
    requestOwnerElevation(`Authorize ${val}% discount (Cashier limit is ${limit}%)`, () => {
      activeDiscount = {
        type: activeDiscountType,
        value: val,
        reason: activeDiscountReason || "Manager Discretion"
      };
      closeDiscountModal();
      renderCart();
    });
    return;
  }

  activeDiscount = {
    type: activeDiscountType,
    value: val,
    reason: activeDiscountReason
  };

  closeDiscountModal();
  renderCart();
}

function requestOwnerElevation(actionDesc, onSuccessCallback) {
  pendingElevationAction = onSuccessCallback;
  document.getElementById("elevation-action-desc").textContent = actionDesc;
  document.getElementById("elevation-pin-input").value = "";
  document.getElementById("elevation-error-msg").textContent = "";
  document.getElementById("owner-elevation-modal").classList.remove("hidden");
  setTimeout(() => {
    document.getElementById("elevation-pin-input")?.focus();
  }, 100);
}

function closeOwnerElevationModal() {
  pendingElevationAction = null;
  document.getElementById("owner-elevation-modal").classList.add("hidden");
}

function submitOwnerElevation() {
  const pin = document.getElementById("elevation-pin-input").value.trim();
  if (PosAuth.verifyOwnerPin(pin, appState.staff)) {
    const cb = pendingElevationAction;
    closeOwnerElevationModal();
    if (cb) cb();
  } else {
    document.getElementById("elevation-error-msg").textContent = "Invalid Owner PIN.";
  }
}

// -------------------------------------------------------------
// SHORTCUTS & SEARCH BAR INPUT
// -------------------------------------------------------------

function toggleShortcutsModal() {
  document.getElementById("shortcuts-modal").classList.toggle("hidden");
}

function setupKeyboardShortcuts() {
  const searchInput = document.getElementById("pos-search-input");

  // Instant short-code resolution on Enter
  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const code = searchInput.value.trim().toUpperCase();
      if (!code) return;

      const matched = (appState.products || []).find(p => (p.shortCode || "").toUpperCase() === code);
      if (matched) {
        addDishToCart(matched);
        searchInput.value = "";
        renderPosItems();
      } else {
        // Find best partial match
        const partial = (appState.products || []).find(p => p.name.toLowerCase().includes(code.toLowerCase()));
        if (partial) {
          addDishToCart(partial);
          searchInput.value = "";
          renderPosItems();
        }
      }
    }
  });

  searchInput?.addEventListener("input", () => {
    renderPosItems();
  });

  // Global hotkeys (Spec §12)
  window.addEventListener("keydown", (e) => {
    // If Options modal is open, Enter confirms addition
    const optModal = document.getElementById("item-options-modal");
    if (e.key === "Enter" && optModal && !optModal.classList.contains("hidden")) {
      e.preventDefault();
      confirmAddItemWithOptions();
      return;
    }

    // If typing in an input or textarea (except search), skip F-keys
    const tag = (e.target.tagName || "").toLowerCase();
    const isInput = tag === "input" || tag === "textarea" || tag === "select";

    if (e.key === "F1") {
      e.preventDefault();
      startNewOrder("counter");
    } else if (e.key === "F2") {
      e.preventDefault();
      navigateTo("tables");
    } else if (e.key === "F3") {
      e.preventDefault();
      startNewOrder("takeaway");
    } else if (e.key === "F4") {
      e.preventDefault();
      openHeldOrdersModal();
    } else if (e.key === "F6") {
      e.preventDefault();
      printKitchenSlip();
    } else if (e.key === "F8") {
      e.preventDefault();
      openDiscountModal();
    } else if (e.key === "F9") {
      e.preventDefault();
      holdCurrentOrder();
    } else if (e.key === "F12" || (e.ctrlKey && e.key === "Enter")) {
      e.preventDefault();
      if (document.getElementById("payment-modal").classList.contains("hidden")) {
        openPaymentDrawer();
      } else {
        executePaymentAndPrint();
      }
    } else if (e.key === "/" && !isInput) {
      e.preventDefault();
      searchInput?.focus();
      searchInput?.select();
    } else if (e.key === "Escape") {
      // Close open modals
      document.querySelectorAll(".fixed:not(#lock-screen-overlay)").forEach(m => m.classList.add("hidden"));
    } else if (e.key === "?" && !isInput) {
      e.preventDefault();
      toggleShortcutsModal();
    }
  });
}

// -------------------------------------------------------------
// CRM & GUEST RELATIONSHIP MANAGEMENT
// -------------------------------------------------------------

let activeCRMFilter = "all";
let lastMatchedCustomer = null;

function setCRMFilter(filterName) {
  activeCRMFilter = filterName;
  document.querySelectorAll("#crm-filter-all, #crm-filter-regulars, #crm-filter-vips").forEach(btn => {
    btn.className = "px-3 py-1 rounded-lg text-xs font-bold text-[#5C534B] hover:text-[#171717]";
  });
  const activeBtn = document.getElementById(`crm-filter-${filterName}`);
  if (activeBtn) activeBtn.className = "px-3 py-1 rounded-lg text-xs font-bold bg-[#171717] text-white";
  renderCRMDirectory();
}

function renderCRMDirectory() {
  const tbody = document.getElementById("crm-table-body");
  const empty = document.getElementById("crm-empty-state");
  if (!tbody) return;
  tbody.innerHTML = "";

  const profiles = PosStorage.aggregateCustomerCRM(appState.salesLedger || []);
  const totalGuests = profiles.length;
  const repeatGuests = profiles.filter(p => p.totalVisits >= 2).length;
  const repeatRate = totalGuests > 0 ? Math.round((repeatGuests / totalGuests) * 100) : 0;
  const totalRevenue = profiles.reduce((acc, p) => acc + p.lifetimeSpend, 0);
  const avgSpend = totalGuests > 0 ? Math.round(totalRevenue / totalGuests) : 0;

  document.getElementById("crm-kpi-guests").textContent = totalGuests;
  document.getElementById("crm-kpi-repeat").textContent = `${repeatRate}%`;
  document.getElementById("crm-kpi-revenue").textContent = `₹${totalRevenue.toFixed(2)}`;
  document.getElementById("crm-kpi-avg").textContent = `₹${avgSpend.toFixed(2)}`;

  const query = (document.getElementById("crm-search-input")?.value || "").toLowerCase().trim();

  let filtered = profiles.filter(p => {
    if (activeCRMFilter === "regulars" && p.totalVisits < 2) return false;
    if (activeCRMFilter === "vips" && p.lifetimeSpend < 1000) return false;
    if (query) {
      const matchName = (p.name || "").toLowerCase().includes(query);
      const matchPhone = (p.phone || "").includes(query);
      return matchName || matchPhone;
    }
    return true;
  });

  if (filtered.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  filtered.forEach(p => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-[#FCFAF8] transition-colors";

    tr.innerHTML = `
      <td class="p-3 pl-4">
        <div class="font-bold text-[#171717] text-sm">${p.name}</div>
        <a href="https://wa.me/91${p.phone}" target="_blank" class="text-[11px] font-mono text-emerald-700 hover:underline flex items-center gap-1 mt-0.5" title="Click to chat on WhatsApp">
          <span class="material-symbols-outlined text-[13px]">chat</span> +91 ${p.phone}
        </a>
      </td>
      <td class="p-3 text-center">
        <span class="px-2 py-0.5 rounded-full font-bold text-xs ${p.totalVisits >= 3 ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-[#171717]'}">
          ${p.totalVisits} ${p.totalVisits === 1 ? 'visit' : 'visits'}
        </span>
      </td>
      <td class="p-3 text-right font-mono font-bold text-sm text-[#171717]">₹${p.lifetimeSpend.toFixed(2)}</td>
      <td class="p-3 text-right font-mono text-xs text-[#5C534B]">₹${p.averageOrder.toFixed(2)}</td>
      <td class="p-3">
        <span class="font-semibold text-xs text-[#171717]">${p.favoriteDish}</span>
        ${p.topFavorites && p.topFavorites.length > 1 ? `<div class="text-[10px] text-[#5C534B]">${p.topFavorites.join(", ")}</div>` : ''}
      </td>
      <td class="p-3 text-xs text-[#5C534B] whitespace-nowrap">${p.lastVisit || '--'}</td>
      <td class="p-3 pr-4 text-right">
        <div class="flex items-center justify-end gap-1.5">
          <button onclick="sendCustomerWhatsAppPromo('${p.phone}', '${escapeString(p.name)}', '${escapeString(p.favoriteDish)}')"
            class="px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-lg text-xs font-semibold hover:bg-emerald-100 flex items-center gap-1" title="Send WhatsApp Promo">
            <span class="material-symbols-outlined text-[14px]">send</span> WhatsApp
          </button>
          <button onclick="repeatCustomerLastOrderFromCRM('${p.phone}')"
            class="px-2.5 py-1 bg-[#171717] text-white rounded-lg text-xs font-bold hover:bg-stone-800 flex items-center gap-1" title="Repeat their last order">
            <span class="material-symbols-outlined text-[14px]">replay</span> Repeat
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function escapeString(str) {
  return String(str || "").replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function sendCustomerWhatsAppPromo(phone, name, favoriteDish) {
  const storeName = appState?.store?.name || "The Retro Cafeteria";
  const msg = `Hello ${name || 'there'}! Greetings from *${storeName}*.\n\nWe would love to welcome you back today! Your favorite *${favoriteDish || 'treat'}* is freshly prepared and waiting for you.\n\nVisit us today or reply to place your order!`;
  window.open(`https://wa.me/91${phone}?text=${encodeURIComponent(msg)}`, "_blank");
}

function repeatCustomerLastOrderFromCRM(phone) {
  const cust = PosStorage.getCustomerByPhone(appState.salesLedger || [], phone);
  if (!cust || !cust.lastBill || !Array.isArray(cust.lastBill.items) || cust.lastBill.items.length === 0) {
    alert("No previous order items found for this customer.");
    return;
  }

  cart = cust.lastBill.items.map(it => ({ ...it, isPrintedToKitchen: false }));
  activeCustomer.name = cust.name;
  activeCustomer.phone = cust.phone;
  updateCartUI();
  navigateTo("pos");
  alert(`Loaded ${cart.length} item(s) from ${cust.name}'s last bill (${cust.lastBill.billNo}).`);
}

function onCustomerPhoneInput(phone) {
  const banner = document.getElementById("pay-crm-match-banner");
  const nameInput = document.getElementById("pay-cust-name");
  if (!phone || phone.length < 10) {
    if (banner) banner.classList.add("hidden");
    lastMatchedCustomer = null;
    return;
  }

  const cust = PosStorage.getCustomerByPhone(appState.salesLedger || [], phone);
  if (cust) {
    lastMatchedCustomer = cust;
    if (nameInput && !nameInput.value.trim()) {
      nameInput.value = cust.name;
    }
    if (banner) {
      document.getElementById("pay-crm-match-name").textContent = cust.name;
      document.getElementById("pay-crm-match-details").textContent = `${cust.totalVisits} Visits • ₹${cust.lifetimeSpend.toFixed(2)} spent • Likes: ${cust.favoriteDish}`;
      banner.classList.remove("hidden");
    }
  } else {
    lastMatchedCustomer = null;
    if (banner) banner.classList.add("hidden");
  }
}

function repeatCustomerLastOrder() {
  if (!lastMatchedCustomer || !lastMatchedCustomer.lastBill || !Array.isArray(lastMatchedCustomer.lastBill.items)) {
    alert("No previous order items found.");
    return;
  }
  cart = lastMatchedCustomer.lastBill.items.map(it => ({ ...it, isPrintedToKitchen: false }));
  updateCartUI();
  closePaymentDrawer();
  alert(`Loaded ${cart.length} item(s) from ${lastMatchedCustomer.name}'s previous order.`);
}

function exportCRMCSV() {
  const profiles = PosStorage.aggregateCustomerCRM(appState.salesLedger || []);
  if (profiles.length === 0) {
    alert("No customer records to export.");
    return;
  }

  const headers = "Phone,Name,Total Visits,Lifetime Spend (INR),Average Order (INR),Favorite Dish,Last Visit Date";
  const rows = profiles.map(p => {
    return `"${p.phone}","${(p.name || '').replace(/"/g, '""')}",${p.totalVisits},${p.lifetimeSpend.toFixed(2)},${p.averageOrder.toFixed(2)},"${(p.favoriteDish || '').replace(/"/g, '""')}","${p.lastVisit || ''}"`;
  });

  const csv = `${headers}\n${rows.join("\n")}\n`;
  downloadTextFile(csv, `CRM_Guests_${PosStorage.getLocalDateString()}.csv`, "text/csv");
}

// -------------------------------------------------------------
// STATUTORY AUDITOR GST EXPORTS (GSTR-1 B2CS & CA REGISTER)
// -------------------------------------------------------------

function exportGSTR1B2CSCSV() {
  const exportData = PosStorage.generateGSTR1B2CSExport(appState.salesLedger || [], {}, appState.store);
  downloadTextFile(exportData.csv, `GSTR1_Table7_B2CS_${PosStorage.getLocalDateString()}.csv`, "text/csv");
}

function exportAuditorSalesRegisterCSV() {
  const csv = PosStorage.generateAuditorSalesRegisterCSV(appState.salesLedger || [], {});
  downloadTextFile(csv, `Auditor_Sales_Register_${PosStorage.getLocalDateString()}.csv`, "text/csv");
}

function downloadTextFile(content, fileName, mimeType = "text/plain") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// -------------------------------------------------------------
// CRITICAL STOCK COUNTER MANAGER
// -------------------------------------------------------------

function updateHeaderStockBadge() {
  const badge = document.getElementById("header-stock-alert");
  if (!badge) return;
  const products = appState.products || [];
  let lowCount = 0;
  let soldOutCount = 0;
  products.forEach(p => {
    if (p.trackStock) {
      if (p.stockQty <= 0 || !p.isAvailable) soldOutCount++;
      else if (p.stockQty <= (p.lowStockThreshold || 5)) lowCount++;
    }
  });

  if (soldOutCount > 0 || lowCount > 0) {
    badge.textContent = `Stock (${soldOutCount > 0 ? `${soldOutCount} out` : `${lowCount} low`})`;
    badge.className = "font-bold text-amber-700 animate-pulse";
  } else {
    badge.textContent = "Stock";
    badge.className = "font-medium text-[#5C534B]";
  }
}

function openStockManagerModal() {
  renderStockTable();
  document.getElementById("stock-modal").classList.remove("hidden");
}

function closeStockManagerModal() {
  document.getElementById("stock-modal").classList.add("hidden");
  renderPosItems();
  updateHeaderStockBadge();
}

function renderStockTable() {
  const tbody = document.getElementById("stock-table-body");
  const summary = document.getElementById("stock-modal-summary");
  if (!tbody) return;
  tbody.innerHTML = "";

  const tracked = (appState.products || []).filter(p => p.trackStock);
  if (summary) summary.textContent = `Tracking ${tracked.length} dish(es) with critical stock limits`;

  if (tracked.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="p-6 text-center text-[#5C534B]">
          No products currently have stock tracking enabled. Edit dishes in the Menu section to turn on stock tracking.
        </td>
      </tr>
    `;
    return;
  }

  tracked.forEach(prod => {
    const isSoldOut = !prod.isAvailable || prod.stockQty <= 0;
    const isLow = !isSoldOut && prod.stockQty <= (prod.lowStockThreshold || 5);
    const tr = document.createElement("tr");
    tr.className = isSoldOut ? "bg-red-50/60" : (isLow ? "bg-amber-50/50" : "");

    tr.innerHTML = `
      <td class="p-2.5 pl-3">
        <div class="font-bold text-[#171717]">${prod.name}</div>
        <div class="text-[10px] font-mono text-[#5C534B]">${prod.shortCode || ''}</div>
      </td>
      <td class="p-2.5 text-[#5C534B]">${prod.category || 'General'}</td>
      <td class="p-2.5 text-center font-mono font-bold text-sm text-[#171717]">
        <input type="number" min="0" value="${prod.stockQty || 0}" 
          onchange="setProductStockDirect('${prod.id}', this.value)"
          class="w-16 px-1.5 py-1 text-center bg-white border border-[#E5DDD3] rounded-lg font-bold">
      </td>
      <td class="p-2.5 text-center font-mono text-[#5C534B]">${prod.lowStockThreshold || 5}</td>
      <td class="p-2.5 text-center">
        <button onclick="toggleProductAvailability('${prod.id}')" 
          class="px-2 py-0.5 rounded text-[10px] font-bold ${prod.isAvailable ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}">
          ${prod.isAvailable ? 'Available' : 'Sold Out'}
        </button>
      </td>
      <td class="p-2.5 pr-3 text-right">
        <div class="flex items-center justify-end gap-1">
          <button onclick="quickAdjustStock('${prod.id}', -1)" class="w-6 h-6 rounded bg-[#F6F2EC] hover:bg-stone-300 font-bold text-xs">-1</button>
          <button onclick="quickAdjustStock('${prod.id}', 1)" class="w-6 h-6 rounded bg-[#F6F2EC] hover:bg-stone-300 font-bold text-xs">+1</button>
          <button onclick="quickAdjustStock('${prod.id}', 5)" class="px-1.5 h-6 rounded bg-[#F6F2EC] hover:bg-stone-300 font-bold text-xs">+5</button>
          <button onclick="quickAdjustStock('${prod.id}', 10)" class="px-1.5 h-6 rounded bg-[#171717] text-white hover:bg-stone-800 font-bold text-xs">+10</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function quickAdjustStock(prodId, delta) {
  const prod = (appState.products || []).find(p => p.id === prodId);
  if (!prod) return;
  prod.stockQty = Math.max(0, (prod.stockQty || 0) + delta);
  if (prod.stockQty > 0) prod.isAvailable = true;
  saveAppState();
  renderStockTable();
}

function setProductStockDirect(prodId, value) {
  const prod = (appState.products || []).find(p => p.id === prodId);
  if (!prod) return;
  const num = parseInt(value, 10);
  prod.stockQty = isNaN(num) ? 0 : Math.max(0, num);
  if (prod.stockQty > 0) prod.isAvailable = true;
  saveAppState();
  renderStockTable();
}

function refillAllStock(addQty) {
  (appState.products || []).forEach(prod => {
    if (prod.trackStock) {
      prod.stockQty = (prod.stockQty || 0) + addQty;
      prod.isAvailable = true;
    }
  });
  saveAppState();
  renderStockTable();
}
