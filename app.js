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

  // Expose global modal triggers
  window.openCustomerInfoModal = openCustomerInfoModal;
  window.closeCustomerInfoModal = closeCustomerInfoModal;
  window.openStockManagerModal = openStockManagerModal;
  window.closeStockManagerModal = closeStockManagerModal;
  window.openAddProductModal = openAddProductModal;
  window.editProduct = editProduct;
  window.deleteProduct = deleteProduct;

  // Expose Inventory triggers
  window.openAddInventoryItemModal = openAddInventoryItemModal;
  window.closeAddInventoryItemModal = closeAddInventoryItemModal;
  window.saveInventoryItemForm = saveInventoryItemForm;
  window.deleteInventoryItem = deleteInventoryItem;
  window.quickAdjustRawMaterialStock = quickAdjustRawMaterialStock;
  window.openStockInwardModal = openStockInwardModal;
  window.closeStockInwardModal = closeStockInwardModal;
  window.addInwardItemRow = addInwardItemRow;
  window.removeInwardItemRow = removeInwardItemRow;
  window.updateInwardGrandTotalPreview = updateInwardGrandTotalPreview;
  window.saveStockInwardForm = saveStockInwardForm;
  window.openStockWastageModal = openStockWastageModal;
  window.closeStockWastageModal = closeStockWastageModal;
  window.onWasteItemSelected = onWasteItemSelected;
  window.calculateWasteLossPreview = calculateWasteLossPreview;
  window.saveStockWastageForm = saveStockWastageForm;
  window.exportInventoryCSVDownload = exportInventoryCSVDownload;
  window.switchInventorySubtab = switchInventorySubtab;
  window.renderInventoryItemsTable = renderInventoryItemsTable;
  window.loadSampleInventoryData = loadSampleInventoryData;
  window.onRecipeDishSelected = onRecipeDishSelected;
  window.addIngredientToCurrentRecipe = addIngredientToCurrentRecipe;
  window.removeIngredientFromRecipe = removeIngredientFromRecipe;
  window.onAuditItemSelected = onAuditItemSelected;
  window.calculateAuditVariancePreview = calculateAuditVariancePreview;
  window.submitStockReconciliation = submitStockReconciliation;
  window.toggleSidebar = toggleSidebar;

  const custBtn = document.getElementById("pos-customer-btn");
  if (custBtn) {
    custBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openCustomerInfoModal();
    });
  }

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

  // Ensure inventory collections exist
  const invEngine = (typeof PosInventory !== "undefined" && PosInventory)
    ? PosInventory
    : (typeof window !== "undefined" && window.PosInventory ? window.PosInventory : null);

  if (!Array.isArray(appState.inventory)) {
    appState.inventory = (appState.products && appState.products.length > 0 && invEngine)
      ? [...invEngine.SAMPLE_INVENTORY_ITEMS]
      : [];
  }
  if (!Array.isArray(appState.recipes)) {
    appState.recipes = (appState.products && appState.products.length > 0 && invEngine)
      ? [...invEngine.SAMPLE_RECIPES]
      : [];
  }
  if (!Array.isArray(appState.purchaseInwards)) appState.purchaseInwards = [];
  if (!Array.isArray(appState.wastageLogs)) appState.wastageLogs = [];
  if (!Array.isArray(appState.stockAudits)) appState.stockAudits = [];

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
  // Check permission for restricted screens: Reports, Menu, Settings, Inventory need Owner
  if (["reports", "menu", "settings", "inventory"].includes(viewName)) {
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
    btn.classList.remove("active", "bg-[#171717]", "text-white", "shadow-sm");
    btn.classList.add("text-[#5C534B]");
    const icon = btn.querySelector(".nav-icon");
    if (icon) icon.classList.remove("text-white");
  });
  const activeBtn = document.getElementById(`nav-${viewName}`);
  if (activeBtn) {
    activeBtn.classList.remove("text-[#5C534B]");
    activeBtn.classList.add("active", "bg-[#171717]", "text-white", "shadow-sm");
    const icon = activeBtn.querySelector(".nav-icon");
    if (icon) icon.classList.add("text-white");
  }

  // Update top header active title and icon
  const viewTitles = {
    home: { title: "Home Dashboard", icon: "home" },
    pos: { title: "Billing POS Terminal", icon: "point_of_sale" },
    tables: { title: "Dine-in Floor Tables", icon: "table_restaurant" },
    history: { title: "Tax Invoice History", icon: "receipt_long" },
    reports: { title: "Sales & Tax Reports", icon: "analytics" },
    crm: { title: "CRM & Guests Directory", icon: "contacts" },
    menu: { title: "Menu & Pricing Manager", icon: "menu_book" },
    inventory: { title: "Inventory & Recipe BOM", icon: "inventory_2" },
    settings: { title: "Store & Terminal Settings", icon: "settings" }
  };
  const titleInfo = viewTitles[viewName] || { title: viewName.toUpperCase(), icon: "terminal" };
  const hTitle = document.getElementById("header-active-title");
  const hIcon = document.getElementById("header-active-icon");
  if (hTitle) hTitle.textContent = titleInfo.title;
  if (hIcon) hIcon.textContent = titleInfo.icon;

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
  } else if (viewName === "inventory") {
    renderInventoryView();
  } else if (viewName === "settings") {
    loadSettingsForm();
  } else if (viewName === "pos") {
    updateCustomerBadge();
    renderCart();
  }
}

/**
 * Toggles the left sidebar between full width (w-56) and slim icon rail (w-16).
 */
function toggleSidebar() {
  const sidebar = document.getElementById("app-sidebar");
  if (!sidebar) return;
  sidebar.classList.toggle("sidebar-collapsed");
  const isCollapsed = sidebar.classList.contains("sidebar-collapsed");
  const toggleIcon = document.getElementById("sidebar-toggle-icon");
  if (toggleIcon) {
    toggleIcon.textContent = isCollapsed ? "chevron_right" : "chevron_left";
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

  // Inventory low stock alert badge
  const lowInvCount = (typeof PosInventory !== "undefined" && Array.isArray(appState?.inventory))
    ? PosInventory.getLowStockItems(appState.inventory).length
    : 0;
  const invBadge = document.getElementById("header-inventory-alert-badge");
  if (invBadge) {
    if (lowInvCount > 0) {
      invBadge.textContent = lowInvCount;
      invBadge.classList.remove("hidden");
    } else {
      invBadge.classList.add("hidden");
    }
  }

  // Home launcher badge
  const homeTableStatus = document.getElementById("home-tables-status");
  if (homeTableStatus) {
    homeTableStatus.textContent = occupiedTables > 0 ? `${occupiedTables} Table(s) Active` : "Select Table";
  }
}

/**
 * Refreshes Home summary KPI cards, operational metrics, recent bills & top sellers.
 */
function refreshHomeStats() {
  const todayStr = PosStorage.getLocalDateString();
  const report = PosStorage.aggregateSalesSummary(appState.salesLedger, {
    startDate: todayStr
  });

  // 1. Shift Header
  const cashierLabel = document.getElementById("home-cashier-label");
  if (cashierLabel) {
    cashierLabel.textContent = currentUser ? currentUser.name : (appState.store?.cashierName || "Store Owner");
  }
  const shiftDate = document.getElementById("home-shift-date");
  if (shiftDate) {
    const now = new Date();
    shiftDate.textContent = now.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }

  // 2. Order Launchers Badges
  const nextToken = appState.dailyTokenCounter || 1;
  const tokenBadge = document.getElementById("home-token-badge");
  if (tokenBadge) {
    tokenBadge.textContent = `Token #${nextToken}`;
  }

  const occupiedTables = Object.keys(appState.openOrders || {}).length;
  const totalTables = (appState.tables || []).filter(t => t.isActive).length || 12;
  const tablesBadge = document.getElementById("home-tables-badge");
  if (tablesBadge) {
    tablesBadge.textContent = `${occupiedTables}/${totalTables} Active`;
    if (occupiedTables > 0) {
      tablesBadge.className = "text-[11px] font-bold font-mono px-2 py-0.5 rounded-lg bg-amber-100 text-amber-900";
    } else {
      tablesBadge.className = "text-[11px] font-bold font-mono px-2 py-0.5 rounded-lg bg-stone-100 text-[#5C534B]";
    }
  }

  const homeTableStatus = document.getElementById("home-tables-status");
  if (homeTableStatus) {
    homeTableStatus.textContent = occupiedTables > 0 ? `${occupiedTables} Table(s) Active` : "Select Table";
  }

  // 3. Financial Telemetry
  const grossSalesEl = document.getElementById("home-gross-sales");
  if (grossSalesEl) grossSalesEl.textContent = `₹${report.grossSales.toFixed(2)}`;
  
  const billCountEl = document.getElementById("home-bill-count");
  if (billCountEl) billCountEl.textContent = report.billCount;
  
  const avgTicket = report.billCount > 0 ? (report.grossSales / report.billCount) : 0;
  const avgTicketEl = document.getElementById("home-avg-ticket");
  if (avgTicketEl) avgTicketEl.textContent = `₹${avgTicket.toFixed(2)}`;

  const cashSalesEl = document.getElementById("home-cash-sales");
  if (cashSalesEl) cashSalesEl.textContent = `₹${report.payments.cash.total.toFixed(2)}`;
  
  const cashCountEl = document.getElementById("home-cash-count");
  if (cashCountEl) cashCountEl.textContent = report.payments.cash.count;
  
  const cashPct = report.grossSales > 0 ? Math.round((report.payments.cash.total / report.grossSales) * 100) : 0;
  const cashPctEl = document.getElementById("home-cash-pct");
  if (cashPctEl) cashPctEl.textContent = `${cashPct}%`;

  const digitalTotal = report.payments.upi.total + report.payments.card.total;
  const digitalCount = report.payments.upi.count + report.payments.card.count;
  const digitalSalesEl = document.getElementById("home-digital-sales");
  if (digitalSalesEl) digitalSalesEl.textContent = `₹${digitalTotal.toFixed(2)}`;
  
  const digitalCountEl = document.getElementById("home-digital-count");
  if (digitalCountEl) digitalCountEl.textContent = digitalCount;
  
  const digPct = report.grossSales > 0 ? Math.round((digitalTotal / report.grossSales) * 100) : 0;
  const digPctEl = document.getElementById("home-digital-pct");
  if (digPctEl) digPctEl.textContent = `${digPct}%`;

  const gstTotalEl = document.getElementById("home-gst-total");
  if (gstTotalEl) gstTotalEl.textContent = `₹${report.totalTax.toFixed(2)}`;
  
  const cgstEl = document.getElementById("home-cgst");
  if (cgstEl) cgstEl.textContent = report.cgst.toFixed(2);
  
  const sgstEl = document.getElementById("home-sgst");
  if (sgstEl) sgstEl.textContent = report.sgst.toFixed(2);

  // 4. Low Stock Alert Banner
  renderHomeStockAlert();

  // 5. Recent Bills Today
  renderHomeRecentBills();

  // 6. Top Selling Dishes Today
  renderHomeTopSellers();

  updateHeaderBadges();
}

/**
 * Renders dynamic stock health alert banner on Home.
 */
function renderHomeStockAlert() {
  const container = document.getElementById("home-stock-alert-wrap");
  if (!container) return;

  const lowRawItems = (appState.inventory || []).filter(item => (item.currentStock || 0) <= (item.reorderLevel || 0));
  const lowDishes = (appState.products || []).filter(p => p.trackStock && (p.stockQty || 0) <= (p.lowStockThreshold || 5));
  const totalLow = lowRawItems.length + lowDishes.length;

  if (totalLow === 0) {
    container.className = "hidden";
    container.innerHTML = "";
    return;
  }

  const sampleNames = [...lowRawItems.map(i => i.name), ...lowDishes.map(p => p.name)].slice(0, 3).join(", ");
  container.className = "p-3.5 rounded-2xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-900 shadow-xs";
  container.innerHTML = `
    <div class="flex items-center gap-2.5">
      <span class="w-8 h-8 rounded-xl bg-amber-200 text-amber-900 flex items-center justify-center shrink-0">
        <span class="material-symbols-outlined text-[18px]">warning</span>
      </span>
      <div>
        <span class="font-bold">Low Stock Warning: ${totalLow} item(s) below reorder threshold.</span>
        <p class="text-[11px] text-amber-800 mt-0.5">${escapeHtml(sampleNames)}${totalLow > 3 ? '...' : ''}</p>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <button onclick="navigateTo('inventory')" class="px-3 py-1.5 rounded-xl bg-amber-800 hover:bg-amber-900 text-white font-bold text-xs flex items-center gap-1 shadow-xs whitespace-nowrap cursor-pointer">
        <span>Manage Stock</span>
        <span class="material-symbols-outlined text-[14px]">arrow_forward</span>
      </button>
    </div>
  `;
}

/**
 * Renders the 5 most recent bills on the Home Dashboard with 1-click reprint.
 */
function renderHomeRecentBills() {
  const tbody = document.getElementById("home-recent-bills-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const ledger = appState.salesLedger || [];
  const recentBills = ledger.slice(0, 5);

  if (recentBills.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="p-8 text-center text-[#5C534B]">
          <span class="material-symbols-outlined text-[32px] text-stone-300 block mb-1">receipt_long</span>
          <span class="font-bold text-[#171717] block">No bills recorded yet today</span>
          <span class="text-[11px]">Press <kbd class="px-1 py-0.5 rounded bg-stone-200 font-mono font-bold">F1</kbd> to start your first counter sale!</span>
        </td>
      </tr>
    `;
    return;
  }

  recentBills.forEach(bill => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-[#FCFAF8] transition-colors";

    const payModeBadge = bill.isComplimentary
      ? `<span class="px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-800 font-bold text-[10px]">NC FREE</span>`
      : bill.paymentMode === "cash"
      ? `<span class="px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-bold text-[10px]">CASH</span>`
      : bill.paymentMode === "upi"
      ? `<span class="px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-800 font-bold text-[10px]">UPI</span>`
      : `<span class="px-1.5 py-0.5 rounded-md bg-stone-200 text-[#171717] font-bold text-[10px] uppercase">${bill.paymentMode || 'CARD'}</span>`;

    const typeLabel = bill.orderType === "dinein"
      ? `<span class="flex items-center gap-1 text-[#6B4226] font-semibold"><span class="material-symbols-outlined text-[14px]">table_restaurant</span>${escapeHtml(bill.tableName || 'Dine-in')}</span>`
      : bill.orderType === "takeaway"
      ? `<span class="flex items-center gap-1 text-[#171717] font-semibold"><span class="material-symbols-outlined text-[14px]">takeout_dining</span>Takeaway</span>`
      : `<span class="flex items-center gap-1 text-[#171717] font-semibold"><span class="material-symbols-outlined text-[14px]">point_of_sale</span>Counter</span>`;

    const timeDisplay = (bill.timestamp || bill.time || '').slice(11, 16) || (bill.timestamp || bill.time || 'Today');

    tr.innerHTML = `
      <td class="p-3 font-mono font-bold text-[#171717]">
        ${escapeHtml(bill.billNo)}
        ${bill.isCancelled ? '<span class="text-red-600 text-[10px] block font-sans font-bold">CANCELLED</span>' : ''}
      </td>
      <td class="p-3 text-[#5C534B] text-[11px] font-mono">${escapeHtml(timeDisplay)}</td>
      <td class="p-3">${typeLabel}</td>
      <td class="p-3 text-right font-mono font-extrabold text-[#171717]">₹${(bill.grandTotal || 0).toFixed(2)}</td>
      <td class="p-3 text-center">${payModeBadge}</td>
      <td class="p-3 text-right">
        <div class="flex items-center justify-end gap-1">
          <button onclick="reprintBill('${escapeHtml(bill.billNo)}')" class="px-2 py-1 rounded-lg bg-[#F6F2EC] hover:bg-[#171717] hover:text-white text-[11px] font-semibold transition-all flex items-center gap-0.5 cursor-pointer active:scale-95" title="Quick Reprint Thermal Receipt">
            <span class="material-symbols-outlined text-[13px]">print</span> Reprint
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Computes and renders the top 3 selling dishes today on Home.
 */
function renderHomeTopSellers() {
  const container = document.getElementById("home-top-sellers-list");
  if (!container) return;
  container.innerHTML = "";

  const todayStr = PosStorage.getLocalDateString();
  const todayBills = (appState.salesLedger || []).filter(b => !b.isCancelled && (b.date === todayStr || (b.timestamp && b.timestamp.startsWith(todayStr))));

  // If no bills today, fallback to recent 10 bills to show popular dishes
  const billsToAnalyze = todayBills.length > 0 ? todayBills : (appState.salesLedger || []).filter(b => !b.isCancelled).slice(0, 10);

  const countMap = {};
  billsToAnalyze.forEach(b => {
    (b.items || []).forEach(it => {
      if (it && it.name) {
        countMap[it.name] = (countMap[it.name] || 0) + (it.qty || 1);
      }
    });
  });

  const sortedDishes = Object.keys(countMap)
    .map(name => ({ name, count: countMap[name] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  if (sortedDishes.length === 0) {
    container.innerHTML = `
      <div class="p-3 text-center text-[#5C534B] text-xs">
        <span>No dish orders recorded yet today.</span>
      </div>
    `;
    return;
  }

  sortedDishes.forEach((item, idx) => {
    const rankColors = [
      "bg-amber-400 text-amber-950",
      "bg-stone-300 text-stone-900",
      "bg-amber-700 text-white"
    ];
    const rankBadge = rankColors[idx] || "bg-stone-200 text-stone-800";
    const div = document.createElement("div");
    div.className = "flex items-center justify-between p-2 rounded-xl bg-[#FCFAF8] border border-[#E5DDD3]";
    div.innerHTML = `
      <div class="flex items-center gap-2 min-w-0">
        <span class="w-5 h-5 rounded-full ${rankBadge} text-[10px] font-mono font-extrabold flex items-center justify-center shrink-0">#${idx + 1}</span>
        <span class="text-xs font-bold text-[#171717] truncate">${escapeHtml(item.name)}</span>
      </div>
      <span class="text-xs font-mono font-bold text-[#C82026] shrink-0">${item.count} sold</span>
    `;
    container.appendChild(div);
  });
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
  updatePosItemCardsBadges();
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
  modal.style.display = "flex";
  setTimeout(() => {
    if (phoneInput) phoneInput.focus();
  }, 50);
}

/**
 * Closes Customer Details modal.
 */
function closeCustomerInfoModal() {
  const modal = document.getElementById("customer-modal");
  if (modal) {
    modal.classList.add("hidden");
    modal.style.display = "none";
  }
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
  if (!container) return;
  container.innerHTML = "";

  const products = appState.products || [];
  const totalCount = products.length;
  const isAllActive = activePosCategoryFilter === "all";

  // "All Items" Category button
  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = `cat-pill px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2 shrink-0 cursor-pointer transition-all duration-150 ${
    isAllActive
      ? "bg-[#171717] text-white shadow-sm ring-1 ring-[#171717]"
      : "bg-[#F6F2EC] text-[#5C534B] hover:text-[#171717] hover:bg-stone-200/70 border border-[#E5DDD3]"
  }`;
  allBtn.innerHTML = `
    <span class="material-symbols-outlined text-[15px] ${isAllActive ? "text-amber-400" : "text-[#5C534B]"}">restaurant_menu</span>
    <span>All Menu</span>
    <span class="text-[10px] font-mono px-1.5 py-0.2 rounded-full font-bold ${
      isAllActive ? "bg-white/20 text-white" : "bg-stone-200 text-[#5C534B]"
    }">${totalCount}</span>
  `;
  allBtn.onclick = () => filterPosCategory("all", allBtn);
  container.appendChild(allBtn);

  (appState.categories || []).forEach(cat => {
    const count = products.filter(p => p.category === cat.name).length;
    const isAct = activePosCategoryFilter === cat.name;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `cat-pill px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2 shrink-0 cursor-pointer transition-all duration-150 ${
      isAct
        ? "bg-[#171717] text-white shadow-sm ring-1 ring-[#171717]"
        : "bg-[#F6F2EC] text-[#5C534B] hover:text-[#171717] hover:bg-stone-200/70 border border-[#E5DDD3]"
    }`;
    const iconName = cat.icon || "local_dining";
    btn.innerHTML = `
      <span class="material-symbols-outlined text-[15px] ${isAct ? "text-amber-400" : "text-[#5C534B]"}">${escapeHtml(iconName)}</span>
      <span>${escapeHtml(cat.name)}</span>
      <span class="text-[10px] font-mono px-1.5 py-0.2 rounded-full font-bold ${
        isAct ? "bg-white/20 text-white" : "bg-stone-200 text-[#5C534B]"
      }">${count}</span>
    `;
    btn.onclick = () => filterPosCategory(cat.name, btn);
    container.appendChild(btn);
  });
}

let activePosCategoryFilter = "all";

function filterPosCategory(categoryName, btnEl) {
  activePosCategoryFilter = categoryName;
  renderPosCategories();
  renderPosItems();
  const container = document.getElementById("pos-categories-list");
  if (container) {
    if (categoryName === "all") {
      container.scrollTo({ left: 0, behavior: "smooth" });
    } else {
      const activeBtn = container.querySelector(".cat-pill.bg-\\[\\#171717\\]");
      if (activeBtn) {
        const cLeft = container.scrollLeft;
        const cRight = cLeft + container.clientWidth;
        const bLeft = activeBtn.offsetLeft;
        const bRight = bLeft + activeBtn.offsetWidth;
        if (bLeft < cLeft) {
          container.scrollTo({ left: bLeft - 8, behavior: "smooth" });
        } else if (bRight > cRight) {
          container.scrollTo({ left: bRight - container.clientWidth + 8, behavior: "smooth" });
        }
      }
    }
  }
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
    const totalCartQty = cart.reduce((sum, it) => it.dishId === prod.id ? sum + (it.qty || 1) : sum, 0);

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

    const hasSizes = Array.isArray(prod.sizes) && prod.sizes.length > 0;
    const hasAddons = Array.isArray(prod.addons) && prod.addons.length > 0;
    const customBadgeHtml = (hasSizes || hasAddons)
      ? `<button type="button" class="text-[9px] font-bold text-[#6B4226] bg-[#EFE3D6] hover:bg-[#6B4226] hover:text-white px-1.5 py-0.5 rounded transition-all cursor-pointer" title="Custom Portion / Add-ons">Custom</button>`
      : '';

    const card = document.createElement("div");
    card.setAttribute("data-dish-id", prod.id);
    card.className = `bg-white p-3.5 rounded-2xl border-2 transition-all flex flex-col justify-between h-32 cursor-pointer shadow-sm hover:shadow-md relative select-none ${
      totalCartQty > 0 ? 'border-[#C82026]' : 'border-[#E5DDD3] hover:border-[#171717]'
    } ${isSoldOut ? 'opacity-50 pointer-events-none' : ''}`;

    card.onclick = (e) => {
      // If user clicked the custom options button specifically
      if (e.target.closest('button')?.textContent === 'Custom') {
        openItemOptionsModal(prod);
        return;
      }
      addDishToCart(prod);
    };

    // Diet mark HTML
    const dietHtml = prod.diet === "veg"
      ? `<span class="diet-veg" title="Vegetarian"><span class="diet-veg-dot"></span></span>`
      : `<span class="diet-non-veg" title="Non-Vegetarian"><span class="diet-non-veg-dot"></span></span>`;

    // Quantity in cart badge
    const qtyBadge = `<span class="pos-item-qty-badge absolute -top-2 -right-2 w-6 h-6 rounded-full bg-[#C82026] text-white text-xs font-extrabold flex items-center justify-center shadow-md transition-transform duration-150 ${totalCartQty > 0 ? '' : 'hidden'}">${totalCartQty}</span>`;

    card.innerHTML = `
      ${qtyBadge}
      <div>
        <div class="flex items-center justify-between gap-1">
          <div class="flex items-center gap-1.5">
            ${dietHtml}
            <span class="text-[10px] font-mono font-bold bg-[#F6F2EC] px-1.5 py-0.5 rounded text-[#5C534B]">${prod.shortCode || 'ITEM'}</span>
          </div>
          <div class="flex items-center gap-1">
            ${customBadgeHtml}
            ${stockBadgeHtml}
          </div>
        </div>
        <h4 class="text-xs font-bold text-[#171717] mt-2 line-clamp-2 leading-tight">${prod.name}</h4>
      </div>
      <div class="flex items-center justify-between pt-2 border-t border-[#F6F2EC]">
        <span class="text-sm font-extrabold font-mono text-[#171717]">₹${prod.price.toFixed(2)}</span>
        <button type="button" class="quick-add-btn w-6 h-6 rounded-lg bg-[#F6F2EC] hover:bg-[#171717] hover:text-white flex items-center justify-center text-[#171717] transition-all" title="Quick Add (+1)">
          <span class="material-symbols-outlined text-[16px]">add</span>
        </button>
      </div>
    `;

    // Direct listener on quick-add button for instant increment
    const addBtn = card.querySelector(".quick-add-btn");
    if (addBtn) {
      addBtn.onclick = (e) => {
        e.stopPropagation();
        addDishToCart(prod, true);
      };
    }

    grid.appendChild(card);
  });
}

/**
 * Ultra-fast in-place DOM update for POS dish item selection count badges.
 * Executes in < 0.2ms without destroying/re-rendering the grid DOM, giving instant 60fps feedback.
 */
function updatePosItemCardsBadges() {
  const cards = document.querySelectorAll("#pos-items-grid > div[data-dish-id]");
  if (!cards || cards.length === 0) return;

  const qtyMap = {};
  for (let i = 0; i < cart.length; i++) {
    const it = cart[i];
    if (it && it.dishId) {
      qtyMap[it.dishId] = (qtyMap[it.dishId] || 0) + (it.qty || 1);
    }
  }

  cards.forEach(card => {
    const dishId = card.getAttribute("data-dish-id");
    const qty = qtyMap[dishId] || 0;
    const badge = card.querySelector(".pos-item-qty-badge");

    if (qty > 0) {
      card.classList.add("border-[#C82026]");
      card.classList.remove("border-[#E5DDD3]");
      if (badge) {
        const prevQty = parseInt(badge.textContent, 10) || 0;
        badge.textContent = qty;
        badge.classList.remove("hidden");
        if (prevQty !== qty) {
          badge.classList.remove("animate-pop");
          void badge.offsetWidth;
          badge.classList.add("animate-pop");
        }
      }
    } else {
      card.classList.remove("border-[#C82026]");
      card.classList.add("border-[#E5DDD3]");
      if (badge) {
        badge.classList.add("hidden");
        badge.textContent = "0";
      }
    }
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
  updatePosItemCardsBadges();
  persistActiveOrderDraft();
}

/**
 * Adds dish to current cart using pure PosCart engine.
 * Opens options modal if the dish has sizes or add-ons, or adds directly if forced/already in cart.
 */
function addDishToCart(dish, forceDirect = false) {
  const hasSizes = Array.isArray(dish.sizes) && dish.sizes.length > 0;
  const hasAddons = Array.isArray(dish.addons) && dish.addons.length > 0;

  // Check if this dish is already in the cart
  const existingInCart = cart.find(it => it.dishId === dish.id);

  if (!forceDirect && !existingInCart && (hasSizes || hasAddons)) {
    openItemOptionsModal(dish);
    return;
  }

  let basePrice = dish.price;
  let itemName = dish.name;
  if (hasSizes && dish.sizes[0]) {
    basePrice = dish.sizes[0].price;
    itemName = `${dish.name} (${dish.sizes[0].name})`;
  }

  cart = PosCart.addItemToCart(cart, {
    dishId: dish.id,
    name: itemName,
    shortCode: dish.shortCode,
    category: dish.category,
    basePrice: basePrice,
    diet: dish.diet,
    gstRate: dish.gstRate || 5.0
  });

  renderCart();
  updatePosItemCardsBadges();
  persistActiveOrderDraft();
}

function updateCartQty(itemId, delta) {
  cart = PosCart.updateCartItemQty(cart, itemId, delta);
  renderCart();
  updatePosItemCardsBadges();
  persistActiveOrderDraft();
}

function removeCartLine(itemId) {
  cart = PosCart.removeCartItem(cart, itemId);
  renderCart();
  updatePosItemCardsBadges();
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
    updatePosItemCardsBadges();
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

  // Deduct raw material stock via Recipe BOM (if defined)
  if (typeof PosInventory !== "undefined" && Array.isArray(appState.inventory) && Array.isArray(appState.recipes)) {
    const res = PosInventory.deductRecipeStock(appState.inventory, appState.recipes, billRecord.items);
    if (res && res.updatedInventory) {
      appState.inventory = res.updatedInventory;
    }
  }

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

  // Deduct raw material stock via Recipe BOM (if defined)
  if (typeof PosInventory !== "undefined" && Array.isArray(appState.inventory) && Array.isArray(appState.recipes)) {
    const res = PosInventory.deductRecipeStock(appState.inventory, appState.recipes, billRecord.items);
    if (res && res.updatedInventory) {
      appState.inventory = res.updatedInventory;
    }
  }

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

  // Restore critical stock for tracked items
  if (Array.isArray(bill.items) && Array.isArray(appState.products)) {
    bill.items.forEach(cartItem => {
      const prod = appState.products.find(p => p.id === cartItem.id);
      if (prod && prod.trackStock) {
        prod.stockQty = (prod.stockQty || 0) + (cartItem.qty || 1);
      }
    });
  }

  // Restore raw material stock via Recipe BOM (if defined)
  if (typeof PosInventory !== "undefined" && Array.isArray(appState.inventory) && Array.isArray(appState.recipes)) {
    const res = PosInventory.restoreRecipeStock(appState.inventory, appState.recipes, bill.items);
    if (Array.isArray(res)) {
      appState.inventory = res;
    } else if (res && res.updatedInventory) {
      appState.inventory = res.updatedInventory;
    }
  }

  saveAppState();
  closeCancelBillModal();
  renderBillHistory();
  refreshHomeStats();
  renderPosItems();
  updateHeaderStockBadge();
  updateHeaderBadges();

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
  renderStockTable();
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
    renderStockTable();
    updateHeaderStockBadge();
  }
}

function deleteProduct(productId) {
  const prod = (appState.products || []).find(p => p.id === productId);
  const name = prod ? prod.name : "this product";
  if (confirm(`Delete product "${name}" from menu?`)) {
    appState.products = (appState.products || []).filter(p => p.id !== productId);
    saveAppState();
    renderMenuManager();
    renderPosCategories();
    renderPosItems();
    renderStockTable();
    updateHeaderStockBadge();
  }
}

function loadSampleCatalogData() {
  if (confirm("Load official The Retro Cafeteria sample menu, floor tables, and raw material inventory?")) {
    appState.categories = [...PosCatalog.SAMPLE_CATEGORIES];
    appState.products = [...PosCatalog.SAMPLE_PRODUCTS];
    appState.tables = [...PosCatalog.SAMPLE_TABLES];
    if (typeof PosInventory !== "undefined") {
      appState.inventory = [...PosInventory.SAMPLE_INVENTORY_ITEMS];
      appState.recipes = [...PosInventory.SAMPLE_RECIPES];
    }
    saveAppState();
    renderPosCategories();
    renderPosItems();
    renderMenuManager();
    renderTablesGrid();
    updateHeaderStockBadge();
    updateHeaderBadges();
    alert("The Retro Cafeteria sample menu and inventory loaded successfully!");
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
  const modal = document.getElementById("stock-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.style.display = "flex";
  renderStockTable();
  setTimeout(() => {
    document.getElementById("stock-search-input")?.focus();
  }, 50);
}

function closeStockManagerModal() {
  const modal = document.getElementById("stock-modal");
  if (modal) {
    modal.classList.add("hidden");
    modal.style.display = "none";
  }
  renderPosItems();
  updateHeaderStockBadge();
}

function renderStockTable() {
  const tbody = document.getElementById("stock-table-body");
  const summary = document.getElementById("stock-modal-summary");
  if (!tbody) return;
  tbody.innerHTML = "";

  const query = (document.getElementById("stock-search-input")?.value || "").toLowerCase().trim();
  const filterMode = document.getElementById("stock-filter-mode")?.value || "all";

  const allProducts = appState.products || [];
  const filtered = allProducts.filter(prod => {
    // Search filter
    if (query) {
      const matchName = (prod.name || "").toLowerCase().includes(query);
      const matchCode = (prod.shortCode || "").toLowerCase().includes(query);
      const matchCat = (prod.category || "").toLowerCase().includes(query);
      if (!matchName && !matchCode && !matchCat) return false;
    }

    // Status filter
    const isSoldOut = !prod.isAvailable || (prod.trackStock && (prod.stockQty === undefined || prod.stockQty <= 0));
    const isLow = prod.trackStock && !isSoldOut && prod.stockQty <= (prod.lowStockThreshold || 5);

    if (filterMode === "low") {
      return isSoldOut || isLow;
    } else if (filterMode === "tracked") {
      return Boolean(prod.trackStock);
    }
    return true;
  });

  if (summary) {
    summary.textContent = `Showing ${filtered.length} of ${allProducts.length} product(s)`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="p-8 text-center text-[#5C534B]">
          <div class="flex flex-col items-center justify-center gap-2">
            <span class="material-symbols-outlined text-[32px] text-stone-400">inventory_2</span>
            <span class="font-bold text-xs">No products found matching criteria</span>
            <button onclick="openAddProductModal()" class="btn-primary !min-h-[32px] !py-1 !px-3 !text-xs mt-1">
              + Add New Product
            </button>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach(prod => {
    const isSoldOut = !prod.isAvailable || (prod.trackStock && (prod.stockQty === undefined || prod.stockQty <= 0));
    const isLow = prod.trackStock && !isSoldOut && prod.stockQty <= (prod.lowStockThreshold || 5);
    const tr = document.createElement("tr");
    tr.className = `transition-colors hover:bg-stone-50/70 ${isSoldOut ? "bg-red-50/40" : (isLow ? "bg-amber-50/40" : "")}`;

    // Diet mark HTML
    const dietHtml = prod.diet === "veg"
      ? `<span class="diet-veg shrink-0" title="Vegetarian"><span class="diet-veg-dot"></span></span>`
      : `<span class="diet-non-veg shrink-0" title="Non-Vegetarian"><span class="diet-non-veg-dot"></span></span>`;

    // Sizes & addons subtitle
    const sizesCount = Array.isArray(prod.sizes) ? prod.sizes.length : 0;
    const addonsCount = Array.isArray(prod.addons) ? prod.addons.length : 0;
    let extraMeta = "";
    if (sizesCount > 0 || addonsCount > 0) {
      const parts = [];
      if (sizesCount > 0) parts.push(`${sizesCount} size(s)`);
      if (addonsCount > 0) parts.push(`${addonsCount} add-on(s)`);
      extraMeta = `<span class="text-[10px] text-[#5C534B]"> • ${parts.join(", ")}</span>`;
    }

    // Stock cell HTML
    let stockCellHtml = "";
    if (prod.trackStock) {
      stockCellHtml = `
        <div class="flex items-center justify-center gap-1">
          <button onclick="quickAdjustStock('${prod.id}', -1)" class="w-6 h-6 rounded bg-[#F6F2EC] hover:bg-stone-300 font-bold text-xs text-[#171717]">-</button>
          <input type="number" min="0" value="${prod.stockQty || 0}" 
            onchange="setProductStockDirect('${prod.id}', this.value)"
            class="w-14 px-1 py-0.5 text-center bg-white border border-[#E5DDD3] rounded font-mono font-bold text-xs focus:outline-none focus:border-[#C82026]">
          <button onclick="quickAdjustStock('${prod.id}', 1)" class="w-6 h-6 rounded bg-[#F6F2EC] hover:bg-stone-300 font-bold text-xs text-[#171717]">+</button>
        </div>
        ${isLow ? '<div class="text-[9px] font-bold text-amber-700 text-center mt-0.5 animate-pulse">Low Stock</div>' : ''}
      `;
    } else {
      stockCellHtml = `
        <div class="flex justify-center">
          <button onclick="toggleProductStockTracking('${prod.id}')" class="px-2 py-0.5 rounded text-[10px] font-semibold bg-stone-100 text-[#5C534B] hover:bg-amber-50 hover:text-amber-900 border border-stone-200 transition-all" title="Click to track critical inventory count">
            Unlimited <span class="underline ml-0.5">Track</span>
          </button>
        </div>
      `;
    }

    tr.innerHTML = `
      <td class="p-2.5 pl-3">
        <div class="flex items-center gap-1.5">
          ${dietHtml}
          <div>
            <div class="font-bold text-[#171717] flex items-center gap-1">
              <span>${escapeHtml(prod.name)}</span>
              ${extraMeta}
            </div>
            <div class="text-[10px] font-mono text-[#5C534B]">${escapeHtml(prod.shortCode || '')}</div>
          </div>
        </div>
      </td>
      <td class="p-2.5">
        <span class="px-2 py-0.5 bg-stone-100 text-[#5C534B] rounded-md font-semibold text-[11px]">${escapeHtml(prod.category || 'General')}</span>
      </td>
      <td class="p-2.5 font-mono font-bold text-[#171717]">
        ₹${(prod.price || 0).toFixed(2)}
      </td>
      <td class="p-2.5 text-center">
        ${stockCellHtml}
      </td>
      <td class="p-2.5 text-center">
        <button onclick="toggleProductAvailability('${prod.id}')" 
          class="px-2 py-0.5 rounded text-[10px] font-bold transition-all ${prod.isAvailable !== false ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' : 'bg-red-100 text-red-800 hover:bg-red-200'}">
          ${prod.isAvailable !== false ? 'Available' : 'Sold Out'}
        </button>
      </td>
      <td class="p-2.5 pr-3 text-right">
        <div class="flex items-center justify-end gap-1">
          <button onclick="editProduct('${prod.id}')" class="w-7 h-7 rounded-lg bg-[#F6F2EC] hover:bg-[#171717] hover:text-white text-[#171717] flex items-center justify-center transition-all" title="Edit Product, Sizes & Add-ons">
            <span class="material-symbols-outlined text-[16px]">edit</span>
          </button>
          <button onclick="deleteProduct('${prod.id}')" class="w-7 h-7 rounded-lg bg-[#F6F2EC] hover:bg-red-600 hover:text-white text-red-600 flex items-center justify-center transition-all ml-1" title="Delete Product">
            <span class="material-symbols-outlined text-[16px]">delete</span>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function toggleProductStockTracking(prodId) {
  const prod = (appState.products || []).find(p => p.id === prodId);
  if (!prod) return;
  prod.trackStock = !prod.trackStock;
  if (prod.trackStock && (prod.stockQty === undefined || prod.stockQty === null)) {
    prod.stockQty = 25;
    prod.lowStockThreshold = 5;
  }
  saveAppState();
  renderStockTable();
  renderPosItems();
  updateHeaderStockBadge();
}

function quickAdjustStock(prodId, delta) {
  const prod = (appState.products || []).find(p => p.id === prodId);
  if (!prod) return;
  prod.stockQty = Math.max(0, (prod.stockQty || 0) + delta);
  if (prod.stockQty > 0) prod.isAvailable = true;
  saveAppState();
  renderStockTable();
  renderPosItems();
  updateHeaderStockBadge();
}

function setProductStockDirect(prodId, value) {
  const prod = (appState.products || []).find(p => p.id === prodId);
  if (!prod) return;
  const num = parseInt(value, 10);
  prod.stockQty = isNaN(num) ? 0 : Math.max(0, num);
  if (prod.stockQty > 0) prod.isAvailable = true;
  saveAppState();
  renderStockTable();
  renderPosItems();
  updateHeaderStockBadge();
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
  renderPosItems();
  updateHeaderStockBadge();
}

// -------------------------------------------------------------
// INVENTORY & KITCHEN RAW MATERIALS MANAGEMENT (REA Optimized)
// -------------------------------------------------------------

let currentInventorySubtab = "items";
let selectedRecipeDishId = null;

/**
 * Smoothly positions the sliding indicator behind the active inventory subtab.
 */
function updateInventorySubtabSlider(tabName) {
  const container = document.getElementById("inv-subtab-container");
  const slider = document.getElementById("inv-subtab-slider");
  const activeBtn = document.getElementById(`subtab-inv-${tabName}`);
  if (!container || !slider || !activeBtn) return;

  const left = activeBtn.offsetLeft;
  const width = activeBtn.offsetWidth;

  if (width > 0) {
    slider.style.opacity = "1";
    slider.style.left = `${left}px`;
    slider.style.width = `${width}px`;
  }
}

/**
 * Switches the active subtab in the Inventory view with smooth slider animation.
 */
function switchInventorySubtab(tabName) {
  currentInventorySubtab = tabName || "items";
  const tabs = ["items", "recipes", "inward", "wastage", "audit"];

  tabs.forEach(t => {
    const btn = document.getElementById(`subtab-inv-${t}`);
    const pane = document.getElementById(`inv-pane-${t}`);
    const isAct = t === currentInventorySubtab;

    if (btn) {
      const icon = btn.querySelector(".material-symbols-outlined");
      if (isAct) {
        btn.classList.add("text-white", "font-bold");
        btn.classList.remove("text-[#5C534B]", "hover:text-[#171717]");
        if (icon) {
          icon.classList.add("text-amber-400");
          icon.classList.remove("text-[#5C534B]");
        }
      } else {
        btn.classList.remove("text-white", "font-bold");
        btn.classList.add("text-[#5C534B]", "hover:text-[#171717]");
        if (icon) {
          icon.classList.remove("text-amber-400");
          icon.classList.add("text-[#5C534B]");
        }
      }
    }

    if (pane) {
      if (isAct) {
        pane.classList.remove("hidden");
        pane.classList.remove("animate-fade-in");
        void pane.offsetWidth;
        pane.classList.add("animate-fade-in");
      } else {
        pane.classList.add("hidden");
      }
    }
  });

  // Reposition animated sliding indicator
  requestAnimationFrame(() => {
    updateInventorySubtabSlider(currentInventorySubtab);
  });

  // Render content of active subtab
  if (currentInventorySubtab === "items") {
    renderInventoryItemsTable();
  } else if (currentInventorySubtab === "recipes") {
    renderInventoryRecipesView();
  } else if (currentInventorySubtab === "inward") {
    renderInventoryInwardTable();
  } else if (currentInventorySubtab === "wastage") {
    renderInventoryWastageTable();
  } else if (currentInventorySubtab === "audit") {
    renderInventoryAuditView();
  }
}

/**
 * Main render function for the Inventory screen.
 */
function renderInventoryView() {
  if (!Array.isArray(appState.inventory)) appState.inventory = [];
  if (!Array.isArray(appState.recipes)) appState.recipes = [];
  if (!Array.isArray(appState.purchaseInwards)) appState.purchaseInwards = [];
  if (!Array.isArray(appState.wastageLogs)) appState.wastageLogs = [];
  if (!Array.isArray(appState.stockAudits)) appState.stockAudits = [];

  updateInventoryKPIs();
  switchInventorySubtab(currentInventorySubtab);
  setTimeout(() => updateInventorySubtabSlider(currentInventorySubtab), 35);
}

/**
 * Updates the 4 key inventory metric cards.
 */
function updateInventoryKPIs() {
  const metrics = typeof PosInventory !== "undefined"
    ? PosInventory.calculateInventoryValuation(appState.inventory)
    : { totalValuation: 0, totalItems: 0, lowStockCount: 0 };
  const valuation = metrics.totalValuation || 0;
  const totalItems = (appState.inventory || []).length;
  const lowStockCount = metrics.lowStockCount !== undefined ? metrics.lowStockCount : 0;

  // Calculate today's kitchen wastage loss
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayWasteLoss = (appState.wastageLogs || [])
    .filter(log => log && log.date && log.date.slice(0, 10) === todayStr)
    .reduce((sum, log) => sum + (log.lossCost || 0), 0);

  const valEl = document.getElementById("inv-kpi-total-val");
  const countEl = document.getElementById("inv-kpi-total-items");
  const lowEl = document.getElementById("inv-kpi-low-stock");
  const wasteEl = document.getElementById("inv-kpi-waste-cost");

  if (valEl) valEl.textContent = `₹${valuation.toFixed(2)}`;
  if (countEl) countEl.textContent = totalItems;
  if (lowEl) lowEl.textContent = lowStockCount;
  if (wasteEl) wasteEl.textContent = `₹${todayWasteLoss.toFixed(2)}`;

  updateHeaderBadges();
}

/**
 * Renders the Raw Materials & Stock Table with search & filters.
 */
function renderInventoryItemsTable() {
  const tbody = document.getElementById("inv-items-table-body");
  if (!tbody) return;

  const searchInput = document.getElementById("inv-search-input");
  const catFilter = document.getElementById("inv-cat-filter");
  const statusFilter = document.getElementById("inv-status-filter");
  const countLabel = document.getElementById("inv-table-count-label");

  const query = (searchInput?.value || "").trim().toLowerCase();
  const selectedCat = catFilter?.value || "all";
  const selectedStatus = statusFilter?.value || "all";

  let items = [...(appState.inventory || [])];

  if (query) {
    items = items.filter(i =>
      (i.name && i.name.toLowerCase().includes(query)) ||
      (i.code && i.code.toLowerCase().includes(query)) ||
      (i.supplier && i.supplier.toLowerCase().includes(query))
    );
  }

  if (selectedCat !== "all") {
    items = items.filter(i => i.category === selectedCat);
  }

  if (selectedStatus === "low") {
    items = items.filter(i => (i.stockQty || 0) <= (i.minStockLevel || 0));
  } else if (selectedStatus === "out") {
    items = items.filter(i => (i.stockQty || 0) <= 0);
  }

  if (countLabel) {
    countLabel.textContent = `Showing ${items.length} of ${appState.inventory.length} materials`;
  }

  if (items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="p-8 text-center text-[#5C534B]">
          <div class="flex flex-col items-center justify-center gap-2">
            <span class="material-symbols-outlined text-[36px] text-stone-300">inventory_2</span>
            <p class="font-bold text-sm">No raw materials found</p>
            <p class="text-xs text-stone-400">Click "Add Raw Material" above or load the official sample ingredients.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = items.map(item => {
    const isOut = (item.stockQty || 0) <= 0;
    const isLow = !isOut && (item.stockQty || 0) <= (item.minStockLevel || 0);

    let statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Adequate</span>`;
    if (isOut) {
      statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700 border border-red-200 animate-pulse">Out of Stock</span>`;
    } else if (isLow) {
      statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">Reorder Soon</span>`;
    }

    const valuation = ((item.stockQty || 0) * (item.unitCost || 0)).toFixed(2);

    return `
      <tr class="hover:bg-[#FCFAF8] transition-colors border-b border-[#F6F2EC]">
        <td class="p-3 pl-4">
          <div class="font-bold text-[#171717]">${escapeHtml(item.name)}</div>
          <div class="text-[10px] font-mono text-[#5C534B] flex items-center gap-1.5 mt-0.5">
            <span class="bg-stone-100 px-1.5 py-0.2 rounded font-semibold text-[#171717]">${escapeHtml(item.code)}</span>
            ${item.supplier ? `<span>• ${escapeHtml(item.supplier)}</span>` : ""}
          </div>
        </td>
        <td class="p-3 text-[#5C534B] font-semibold">${escapeHtml(item.category || "General")}</td>
        <td class="p-3 text-center font-mono font-extrabold ${isOut ? 'text-red-700' : isLow ? 'text-amber-700' : 'text-[#171717]'}">
          ${item.stockQty} <span class="text-[10px] font-bold text-stone-400">${item.uom}</span>
        </td>
        <td class="p-3 text-center font-mono text-[#5C534B]">
          ${item.minStockLevel} <span class="text-[10px] font-bold text-stone-400">${item.uom}</span>
        </td>
        <td class="p-3 text-right font-mono font-bold text-[#171717]">₹${(item.unitCost || 0).toFixed(2)}</td>
        <td class="p-3 text-right font-mono font-extrabold text-[#6B4226]">₹${valuation}</td>
        <td class="p-3 text-center">${statusBadge}</td>
        <td class="p-3 text-center">
          <div class="inline-flex items-center gap-1 bg-[#F6F2EC] p-0.5 rounded-lg border border-[#E5DDD3]">
            <button onclick="quickAdjustRawMaterialStock('${item.id}', -5)" title="Minus 5" class="w-6 h-6 rounded bg-white hover:bg-stone-200 font-mono font-bold text-[11px] text-stone-600 flex items-center justify-center">-5</button>
            <button onclick="quickAdjustRawMaterialStock('${item.id}', -1)" title="Minus 1" class="w-6 h-6 rounded bg-white hover:bg-stone-200 font-mono font-bold text-[11px] text-stone-600 flex items-center justify-center">-1</button>
            <button onclick="quickAdjustRawMaterialStock('${item.id}', 1)" title="Plus 1" class="w-6 h-6 rounded bg-white hover:bg-stone-200 font-mono font-bold text-[11px] text-stone-600 flex items-center justify-center">+1</button>
            <button onclick="quickAdjustRawMaterialStock('${item.id}', 5)" title="Plus 5" class="w-6 h-6 rounded bg-white hover:bg-stone-200 font-mono font-bold text-[11px] text-stone-600 flex items-center justify-center">+5</button>
          </div>
        </td>
        <td class="p-3 pr-4 text-right">
          <div class="flex items-center justify-end gap-1.5">
            <button onclick="openStockWastageModal('${item.id}')" title="Log Kitchen Wastage" class="w-7 h-7 rounded-lg hover:bg-red-50 text-red-600 flex items-center justify-center transition-colors">
              <span class="material-symbols-outlined text-[16px]">delete_sweep</span>
            </button>
            <button onclick="openAddInventoryItemModal('${item.id}')" title="Edit Raw Material" class="w-7 h-7 rounded-lg hover:bg-stone-100 text-[#5C534B] hover:text-[#171717] flex items-center justify-center transition-colors">
              <span class="material-symbols-outlined text-[16px]">edit</span>
            </button>
            <button onclick="deleteInventoryItem('${item.id}')" title="Delete Raw Material" class="w-7 h-7 rounded-lg hover:bg-red-50 text-stone-400 hover:text-red-700 flex items-center justify-center transition-colors">
              <span class="material-symbols-outlined text-[16px]">delete</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

/**
 * Opens modal to Add or Edit a Raw Material item.
 */
function openAddInventoryItemModal(editId) {
  const modal = document.getElementById("inv-item-modal");
  const title = document.getElementById("inv-item-modal-title");
  const form = document.getElementById("inv-item-form");

  if (!modal || !form) return;

  if (editId) {
    const item = (appState.inventory || []).find(i => i.id === editId);
    if (!item) return;

    if (title) title.textContent = "Edit Raw Material";
    document.getElementById("inv-item-id").value = item.id;
    document.getElementById("inv-item-name").value = item.name || "";
    document.getElementById("inv-item-code").value = item.code || "";
    document.getElementById("inv-item-category").value = item.category || "General";
    document.getElementById("inv-item-uom").value = item.uom || "pcs";
    document.getElementById("inv-item-stock").value = item.stockQty !== undefined ? item.stockQty : 0;
    document.getElementById("inv-item-min-stock").value = item.minStockLevel !== undefined ? item.minStockLevel : 5;
    document.getElementById("inv-item-cost").value = item.unitCost !== undefined ? item.unitCost : 0;
    document.getElementById("inv-item-supplier").value = item.supplier || "";
  } else {
    if (title) title.textContent = "Add Raw Material";
    form.reset();
    document.getElementById("inv-item-id").value = "";
    document.getElementById("inv-item-category").value = "General";
    document.getElementById("inv-item-uom").value = "pcs";
    document.getElementById("inv-item-stock").value = "0";
    document.getElementById("inv-item-min-stock").value = "5";
    document.getElementById("inv-item-cost").value = "0.00";
  }

  modal.classList.remove("hidden");
  document.getElementById("inv-item-name").focus();
}

/**
 * Closes Add/Edit Raw Material modal.
 */
function closeAddInventoryItemModal() {
  const modal = document.getElementById("inv-item-modal");
  if (modal) modal.classList.add("hidden");
}

/**
 * Handles form submission for adding or editing a Raw Material item.
 */
function saveInventoryItemForm(e) {
  e.preventDefault();

  const id = document.getElementById("inv-item-id").value.trim();
  const name = document.getElementById("inv-item-name").value.trim();
  const code = document.getElementById("inv-item-code").value.trim().toUpperCase();
  const category = document.getElementById("inv-item-category").value;
  const uom = document.getElementById("inv-item-uom").value;
  const stockQty = parseFloat(document.getElementById("inv-item-stock").value) || 0;
  const minStockLevel = parseFloat(document.getElementById("inv-item-min-stock").value) || 0;
  const unitCost = parseFloat(document.getElementById("inv-item-cost").value) || 0;
  const supplier = document.getElementById("inv-item-supplier").value.trim();

  if (!name || !code) {
    alert("Please provide both Material Name and SKU / Item Code.");
    return;
  }

  if (!Array.isArray(appState.inventory)) appState.inventory = [];

  if (id) {
    // Edit existing item
    const item = appState.inventory.find(i => i.id === id);
    if (item) {
      item.name = name;
      item.code = code;
      item.category = category;
      item.uom = uom;
      item.stockQty = Math.max(0, stockQty);
      item.minStockLevel = Math.max(0, minStockLevel);
      item.unitCost = Math.max(0, unitCost);
      item.supplier = supplier;
      item.updatedAt = new Date().toISOString();
    }
  } else {
    // Create new item
    const newItem = typeof PosInventory !== "undefined"
      ? PosInventory.createInventoryItem({ name, code, category, uom, stockQty, minStockLevel, unitCost, supplier })
      : {
          id: `raw_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          name, code, category, uom, stockQty, minStockLevel, unitCost, supplier,
          createdAt: new Date().toISOString()
        };
    appState.inventory.push(newItem);
  }

  saveAppState();
  closeAddInventoryItemModal();
  renderInventoryView();
}

/**
 * Deletes a Raw Material item and cleans up linked recipes.
 */
function deleteInventoryItem(id) {
  const item = (appState.inventory || []).find(i => i.id === id);
  if (!item) return;

  if (confirm(`Delete raw material "${item.name}" (${item.code})?\nThis will also remove this ingredient from any linked dish recipes.`)) {
    appState.inventory = (appState.inventory || []).filter(i => i.id !== id);

    // Remove from recipes
    if (Array.isArray(appState.recipes)) {
      appState.recipes.forEach(r => {
        if (Array.isArray(r.ingredients)) {
          r.ingredients = r.ingredients.filter(ing => ing.itemId !== id);
        }
      });
    }

    saveAppState();
    renderInventoryView();
  }
}

/**
 * Quick adjusts the stock quantity of a raw material by delta (+/-).
 */
function quickAdjustRawMaterialStock(id, delta) {
  const item = (appState.inventory || []).find(i => i.id === id);
  if (!item) return;

  item.stockQty = Math.max(0, Math.round(((item.stockQty || 0) + delta) * 1000) / 1000);
  item.updatedAt = new Date().toISOString();

  saveAppState();
  renderInventoryView();
}

/**
 * Renders the Recipe / Bill of Materials (BOM) view.
 */
function renderInventoryRecipesView() {
  const dishSelect = document.getElementById("recipe-dish-select");
  const rawSelect = document.getElementById("recipe-add-raw-select");
  const uomLabel = document.getElementById("recipe-add-uom-label");
  const tbody = document.getElementById("recipe-ingredients-table-body");

  if (!dishSelect || !rawSelect || !tbody) return;

  const products = appState.products || [];

  if (products.length === 0) {
    dishSelect.innerHTML = `<option value="">No products in catalog</option>`;
    tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-[#5C534B]">No menu dishes available. Add products to menu first.</td></tr>`;
    return;
  }

  // Populate Dish select
  dishSelect.innerHTML = products.map(p =>
    `<option value="${p.id}" ${p.id === selectedRecipeDishId ? 'selected' : ''}>${escapeHtml(p.name)} (${escapeHtml(p.shortCode || "ID")}) - ₹${(p.price || 0).toFixed(2)}</option>`
  ).join("");

  if (!selectedRecipeDishId || !products.some(p => p.id === selectedRecipeDishId)) {
    selectedRecipeDishId = products[0].id;
    dishSelect.value = selectedRecipeDishId;
  }

  // Populate Raw Materials dropdown for adding ingredient
  const rawItems = appState.inventory || [];
  if (rawItems.length === 0) {
    rawSelect.innerHTML = `<option value="">No raw materials created yet</option>`;
  } else {
    rawSelect.innerHTML = rawItems.map(item =>
      `<option value="${item.id}">${escapeHtml(item.name)} (${escapeHtml(item.code)}) - ₹${(item.unitCost || 0).toFixed(2)}/${item.uom}</option>`
    ).join("");
  }

  // Update UOM label on select change
  const updateUomLabel = () => {
    const chosen = rawItems.find(i => i.id === rawSelect.value);
    if (uomLabel) uomLabel.textContent = chosen ? chosen.uom : "pcs";
  };
  rawSelect.onchange = updateUomLabel;
  updateUomLabel();

  // Find active dish and its recipe
  const currentDish = products.find(p => p.id === selectedRecipeDishId);
  const currentRecipe = typeof PosInventory !== "undefined"
    ? PosInventory.getRecipeForDish(appState.recipes, selectedRecipeDishId)
    : (appState.recipes || []).find(r => r.dishId === selectedRecipeDishId);

  // Compute Cost & Margin Metrics
  const calculatedCost = (typeof PosInventory !== "undefined" && currentRecipe)
    ? PosInventory.calculateRecipeCost(currentRecipe, appState.inventory)
    : 0;
  const prepCost = typeof calculatedCost === "number" ? calculatedCost : (calculatedCost?.prepCost || 0);

  const sellingPrice = currentDish ? (currentDish.price || 0) : 0;
  const margin = sellingPrice - prepCost;
  const foodCostPct = sellingPrice > 0 ? (prepCost / sellingPrice * 100).toFixed(1) : "0.0";

  const priceEl = document.getElementById("recipe-selling-price");
  const prepEl = document.getElementById("recipe-prep-cost");
  const marginEl = document.getElementById("recipe-gross-margin");
  const pctEl = document.getElementById("recipe-food-cost-pct");

  if (priceEl) priceEl.textContent = `₹${sellingPrice.toFixed(2)}`;
  if (prepEl) prepEl.textContent = `₹${prepCost.toFixed(2)}`;
  if (marginEl) {
    marginEl.textContent = `₹${margin.toFixed(2)}`;
    marginEl.className = margin >= 0 ? "text-base font-mono font-extrabold text-emerald-700" : "text-base font-mono font-extrabold text-red-700";
  }
  if (pctEl) {
    pctEl.textContent = `${foodCostPct}%`;
    const numPct = parseFloat(foodCostPct);
    pctEl.className = numPct > 45 ? "text-base font-mono font-extrabold text-red-700" : numPct > 35 ? "text-base font-mono font-extrabold text-amber-700" : "text-base font-mono font-extrabold text-emerald-700";
  }

  // Render Ingredients Rows
  const ingredients = currentRecipe?.ingredients || [];

  if (ingredients.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="p-8 text-center text-[#5C534B]">
          <div class="flex flex-col items-center justify-center gap-1.5">
            <span class="material-symbols-outlined text-[32px] text-stone-300">menu_book</span>
            <p class="font-bold text-xs">No ingredients mapped to "${escapeHtml(currentDish?.name || 'this dish')}"</p>
            <p class="text-[11px] text-stone-400">Add raw materials above to enable automatic stock deduction when this dish is billed.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = ingredients.map(ing => {
    const raw = (appState.inventory || []).find(i => i.id === ing.itemId);
    const rawName = raw ? raw.name : "Unknown Item";
    const rawCode = raw ? raw.code : ing.itemId;
    const rawCat = raw ? raw.category : "General";
    const rawUom = raw ? raw.uom : "pcs";
    const unitCost = raw ? (raw.unitCost || 0) : 0;
    const contribution = (ing.qty * unitCost).toFixed(2);

    return `
      <tr class="hover:bg-[#FCFAF8] transition-colors border-b border-[#F6F2EC]">
        <td class="p-2.5 pl-3">
          <span class="font-bold text-[#171717]">${escapeHtml(rawName)}</span>
          <span class="ml-1 text-[10px] font-mono font-semibold bg-stone-100 px-1 py-0.5 rounded text-[#5C534B]">${escapeHtml(rawCode)}</span>
        </td>
        <td class="p-2.5 text-[#5C534B] font-semibold">${escapeHtml(rawCat)}</td>
        <td class="p-2.5 text-center font-mono font-bold text-[#171717]">${ing.qty} <span class="text-[10px] text-stone-400">${rawUom}</span></td>
        <td class="p-2.5 text-right font-mono text-[#5C534B]">₹${unitCost.toFixed(2)}</td>
        <td class="p-2.5 text-right font-mono font-bold text-[#6B4226]">₹${contribution}</td>
        <td class="p-2.5 pr-3 text-right">
          <button onclick="removeIngredientFromRecipe('${ing.itemId}')" title="Remove Ingredient" class="w-6 h-6 rounded hover:bg-red-50 text-stone-400 hover:text-red-700 inline-flex items-center justify-center transition-colors">
            <span class="material-symbols-outlined text-[15px]">delete</span>
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

/**
 * Handles dish change in Recipe BOM view.
 */
function onRecipeDishSelected(dishId) {
  selectedRecipeDishId = dishId;
  renderInventoryRecipesView();
}

/**
 * Adds an ingredient to the current dish's recipe.
 */
function addIngredientToCurrentRecipe() {
  if (!selectedRecipeDishId) {
    alert("Please select a menu dish first.");
    return;
  }

  const rawSelect = document.getElementById("recipe-add-raw-select");
  const qtyInput = document.getElementById("recipe-add-qty");

  const itemId = rawSelect?.value;
  const qty = parseFloat(qtyInput?.value) || 0;

  if (!itemId) {
    alert("Please select a raw material ingredient.");
    return;
  }

  if (qty <= 0) {
    alert("Please enter a valid quantity greater than zero.");
    qtyInput?.focus();
    return;
  }

  if (!Array.isArray(appState.recipes)) appState.recipes = [];

  let recipe = appState.recipes.find(r => r.dishId === selectedRecipeDishId);
  if (!recipe) {
    recipe = { dishId: selectedRecipeDishId, ingredients: [] };
    appState.recipes.push(recipe);
  }

  const existing = recipe.ingredients.find(i => i.itemId === itemId);
  if (existing) {
    existing.qty = Math.round((existing.qty + qty) * 1000) / 1000;
  } else {
    recipe.ingredients.push({ itemId, qty });
  }

  saveAppState();
  if (qtyInput) qtyInput.value = "";
  renderInventoryRecipesView();
}

/**
 * Removes an ingredient from the current dish's recipe.
 */
function removeIngredientFromRecipe(itemId) {
  if (!selectedRecipeDishId) return;

  const recipe = (appState.recipes || []).find(r => r.dishId === selectedRecipeDishId);
  if (recipe && Array.isArray(recipe.ingredients)) {
    recipe.ingredients = recipe.ingredients.filter(i => i.itemId !== itemId);
    saveAppState();
    renderInventoryRecipesView();
  }
}

/**
 * Renders the Purchase Inward (GRN) history table.
 */
function renderInventoryInwardTable() {
  const tbody = document.getElementById("inv-inward-table-body");
  if (!tbody) return;

  const inwards = appState.purchaseInwards || [];

  if (inwards.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="p-8 text-center text-[#5C534B]">
          <div class="flex flex-col items-center justify-center gap-1.5">
            <span class="material-symbols-outlined text-[32px] text-stone-300">local_shipping</span>
            <p class="font-bold text-xs">No purchase inwards recorded yet</p>
            <p class="text-[11px] text-stone-400">Click "New Purchase Entry" above to log vendor shipments and update stock.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = inwards.map(inward => {
    const itemCount = inward.items ? inward.items.length : 0;
    const itemsSummary = (inward.items || []).map(it => {
      const raw = (appState.inventory || []).find(i => i.id === it.itemId);
      const name = raw ? raw.name : it.itemId;
      const uom = raw ? raw.uom : "pcs";
      return `${name} (${it.qty} ${uom})`;
    }).join(", ");

    return `
      <tr class="hover:bg-[#FCFAF8] transition-colors border-b border-[#F6F2EC]">
        <td class="p-3 pl-4">
          <div class="font-mono font-bold text-[#171717]">${escapeHtml(inward.grnNo || "GRN-")}</div>
          <div class="text-[10px] text-[#5C534B] mt-0.5">${inward.date || ""}</div>
        </td>
        <td class="p-3 font-bold text-[#171717]">${escapeHtml(inward.supplier || "Vendor")}</td>
        <td class="p-3 font-mono font-semibold text-[#5C534B] uppercase">${escapeHtml(inward.invoiceNo || "-")}</td>
        <td class="p-3 text-[#5C534B]">
          <span class="font-bold text-[#171717]">${itemCount} materials:</span>
          <span class="text-[11px] text-stone-500 line-clamp-1" title="${escapeHtml(itemsSummary)}">${escapeHtml(itemsSummary)}</span>
        </td>
        <td class="p-3 pr-4 text-right font-mono font-extrabold text-[#6B4226]">₹${(inward.totalCost || 0).toFixed(2)}</td>
      </tr>
    `;
  }).join("");
}

/**
 * Opens the modal to record a new Purchase Inward (GRN) shipment.
 */
function openStockInwardModal() {
  const modal = document.getElementById("inv-inward-modal");
  const form = document.getElementById("inv-inward-form");
  const container = document.getElementById("inward-items-rows-container");

  if (!modal || !form || !container) return;

  form.reset();
  document.getElementById("inward-date").value = new Date().toISOString().slice(0, 10);
  container.innerHTML = "";

  // Add 1 initial row
  addInwardItemRow();
  updateInwardGrandTotalPreview();

  modal.classList.remove("hidden");
  document.getElementById("inward-supplier").focus();
}

/**
 * Closes the Purchase Inward modal.
 */
function closeStockInwardModal() {
  const modal = document.getElementById("inv-inward-modal");
  if (modal) modal.classList.add("hidden");
}

/**
 * Appends a new item line row inside the Purchase Inward modal.
 */
function addInwardItemRow() {
  const container = document.getElementById("inward-items-rows-container");
  if (!container) return;

  const rawItems = appState.inventory || [];
  if (rawItems.length === 0) {
    alert("Please add at least one raw material in the inventory first.");
    return;
  }

  const rowId = `inward_row_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
  const div = document.createElement("div");
  div.id = rowId;
  div.className = "flex items-center gap-2 p-2 bg-[#FCFAF8] rounded-xl border border-[#E5DDD3]";

  div.innerHTML = `
    <select class="inward-row-item-select py-1.5 px-2 bg-white border border-[#E5DDD3] rounded-lg text-xs font-semibold focus:outline-none flex-1" onchange="onInwardRowItemChanged('${rowId}')">
      ${rawItems.map(item => `<option value="${item.id}" data-cost="${item.unitCost || 0}" data-uom="${item.uom}">${escapeHtml(item.name)} (${escapeHtml(item.code)})</option>`).join("")}
    </select>
    <div class="flex items-center w-28">
      <input type="number" step="any" min="0.001" placeholder="Qty" required class="inward-row-qty w-full py-1.5 px-2 bg-white border border-[#E5DDD3] rounded-l-lg text-xs font-mono font-bold focus:outline-none" oninput="updateInwardGrandTotalPreview()">
      <span class="inward-row-uom-badge py-1.5 px-2 bg-stone-100 border border-l-0 border-[#E5DDD3] rounded-r-lg text-[10px] font-bold text-[#5C534B]">${rawItems[0]?.uom || "pcs"}</span>
    </div>
    <div class="flex items-center w-28">
      <span class="py-1.5 px-1.5 bg-stone-100 border border-r-0 border-[#E5DDD3] rounded-l-lg text-[10px] font-bold text-[#5C534B]">₹</span>
      <input type="number" step="0.01" min="0" placeholder="Unit Cost" required value="${rawItems[0]?.unitCost || 0}" class="inward-row-cost w-full py-1.5 px-2 bg-white border border-[#E5DDD3] rounded-r-lg text-xs font-mono font-bold focus:outline-none" oninput="updateInwardGrandTotalPreview()">
    </div>
    <button type="button" onclick="removeInwardItemRow(this)" title="Remove Line" class="w-7 h-7 rounded-lg hover:bg-red-50 text-stone-400 hover:text-red-700 flex items-center justify-center shrink-0">
      <span class="material-symbols-outlined text-[16px]">close</span>
    </button>
  `;

  container.appendChild(div);
  updateInwardGrandTotalPreview();
}

/**
 * Handles selection change in a Purchase Inward item row.
 */
function onInwardRowItemChanged(rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;

  const select = row.querySelector(".inward-row-item-select");
  const costInput = row.querySelector(".inward-row-cost");
  const uomBadge = row.querySelector(".inward-row-uom-badge");

  if (!select) return;
  const opt = select.options[select.selectedIndex];
  if (opt) {
    if (costInput && opt.dataset.cost) costInput.value = opt.dataset.cost;
    if (uomBadge && opt.dataset.uom) uomBadge.textContent = opt.dataset.uom;
  }
  updateInwardGrandTotalPreview();
}

/**
 * Removes an item line row in the Purchase Inward modal.
 */
function removeInwardItemRow(btn) {
  const container = document.getElementById("inward-items-rows-container");
  const row = btn.closest(".flex");
  if (row) {
    row.remove();
    updateInwardGrandTotalPreview();
  }
  // Ensure at least one row exists
  if (container && container.children.length === 0) {
    addInwardItemRow();
  }
}

/**
 * Recalculates the grand total of the Purchase Inward modal preview.
 */
function updateInwardGrandTotalPreview() {
  const container = document.getElementById("inward-items-rows-container");
  const totalEl = document.getElementById("inward-grand-total");
  if (!container || !totalEl) return;

  let total = 0;
  const rows = container.querySelectorAll(".flex");
  rows.forEach(row => {
    const qty = parseFloat(row.querySelector(".inward-row-qty")?.value) || 0;
    const cost = parseFloat(row.querySelector(".inward-row-cost")?.value) || 0;
    total += (qty * cost);
  });

  totalEl.textContent = `₹${total.toFixed(2)}`;
}

/**
 * Saves a new Purchase Inward shipment and updates inventory stock & costs.
 */
function saveStockInwardForm(e) {
  e.preventDefault();

  const supplier = document.getElementById("inward-supplier").value.trim();
  const invoiceNo = document.getElementById("inward-invoice-no").value.trim().toUpperCase();
  const date = document.getElementById("inward-date").value;
  const container = document.getElementById("inward-items-rows-container");

  if (!supplier || !invoiceNo || !date) {
    alert("Please fill in Supplier, Invoice #, and Receipt Date.");
    return;
  }

  const items = [];
  const rows = container.querySelectorAll(".flex");
  rows.forEach(row => {
    const itemId = row.querySelector(".inward-row-item-select")?.value;
    const qty = parseFloat(row.querySelector(".inward-row-qty")?.value) || 0;
    const unitCost = parseFloat(row.querySelector(".inward-row-cost")?.value) || 0;

    if (itemId && qty > 0) {
      items.push({ itemId, qty, unitCost });
    }
  });

  if (items.length === 0) {
    alert("Please add at least one material with a quantity greater than zero.");
    return;
  }

  if (typeof PosInventory === "undefined") {
    alert("Inventory core module not loaded.");
    return;
  }

  const res = PosInventory.recordStockInward(appState.inventory, { supplier, invoiceNo, date, items });
  if (res && res.inwardRecord) {
    if (res.updatedInventory) appState.inventory = res.updatedInventory;
    const inward = res.inwardRecord;
    if (!Array.isArray(appState.purchaseInwards)) appState.purchaseInwards = [];
    appState.purchaseInwards.unshift(inward);
    if (appState.purchaseInwards.length > 500) appState.purchaseInwards = appState.purchaseInwards.slice(0, 500);

    saveAppState();
    closeStockInwardModal();
    renderInventoryView();

    alert(`Purchase Inward ${inward.invoiceNo || "Entry"} recorded successfully!\nStock levels and weighted average unit costs have been updated.`);
  }
}

/**
 * Renders the Kitchen Wastage & Spoilage Log table.
 */
function renderInventoryWastageTable() {
  const tbody = document.getElementById("inv-wastage-table-body");
  if (!tbody) return;

  const logs = appState.wastageLogs || [];

  if (logs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="p-8 text-center text-[#5C534B]">
          <div class="flex flex-col items-center justify-center gap-1.5">
            <span class="material-symbols-outlined text-[32px] text-stone-300">delete_sweep</span>
            <p class="font-bold text-xs">No kitchen wastage recorded yet</p>
            <p class="text-[11px] text-stone-400">Log spoiled, expired, or dropped food items to maintain accurate stock and financial loss tracking.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = logs.map(log => {
    const dateFormatted = log.date ? new Date(log.date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : "-";

    return `
      <tr class="hover:bg-[#FCFAF8] transition-colors border-b border-[#F6F2EC]">
        <td class="p-3 pl-4 font-mono text-[11px] text-[#5C534B]">${dateFormatted}</td>
        <td class="p-3">
          <div class="font-bold text-[#171717]">${escapeHtml(log.itemName || "Raw Material")}</div>
          <div class="text-[10px] font-mono text-stone-400">${escapeHtml(log.itemCode || "")}</div>
        </td>
        <td class="p-3 text-center font-mono font-bold text-red-700">${log.qty} <span class="text-[10px] text-stone-400">${log.uom || "pcs"}</span></td>
        <td class="p-3">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-stone-100 text-[#171717] border border-stone-200">${escapeHtml(log.reason || "Wastage")}</span>
        </td>
        <td class="p-3 text-[#5C534B] font-semibold">${escapeHtml(log.reportedBy || "Staff")}</td>
        <td class="p-3 text-right font-mono font-extrabold text-red-700">₹${(log.lossCost || 0).toFixed(2)}</td>
        <td class="p-3 pr-4 text-[11px] text-[#5C534B] italic">${escapeHtml(log.note || "-")}</td>
      </tr>
    `;
  }).join("");
}

/**
 * Opens the Kitchen Wastage log modal.
 */
function openStockWastageModal(preselectedId) {
  const modal = document.getElementById("inv-waste-modal");
  const form = document.getElementById("inv-waste-form");
  const itemSelect = document.getElementById("waste-item-select");

  if (!modal || !form || !itemSelect) return;

  const rawItems = appState.inventory || [];
  if (rawItems.length === 0) {
    alert("Please add raw materials to inventory first before logging wastage.");
    return;
  }

  form.reset();
  itemSelect.innerHTML = rawItems.map(item =>
    `<option value="${item.id}" ${item.id === preselectedId ? 'selected' : ''}>${escapeHtml(item.name)} (${escapeHtml(item.code)}) - Available: ${item.stockQty} ${item.uom}</option>`
  ).join("");

  document.getElementById("waste-reported-by").value = currentUser ? currentUser.name : "Staff";
  onWasteItemSelected(itemSelect.value);

  modal.classList.remove("hidden");
  document.getElementById("waste-qty").focus();
}

/**
 * Closes Kitchen Wastage modal.
 */
function closeStockWastageModal() {
  const modal = document.getElementById("inv-waste-modal");
  if (modal) modal.classList.add("hidden");
}

/**
 * Handles material selection change in Kitchen Wastage modal.
 */
function onWasteItemSelected(id) {
  const item = (appState.inventory || []).find(i => i.id === id);
  const uomLabel = document.getElementById("waste-uom-label");
  if (uomLabel) uomLabel.textContent = item ? item.uom : "pcs";
  calculateWasteLossPreview();
}

/**
 * Computes monetary loss preview for kitchen wastage.
 */
function calculateWasteLossPreview() {
  const itemSelect = document.getElementById("waste-item-select");
  const qtyInput = document.getElementById("waste-qty");
  const lossEl = document.getElementById("waste-loss-amt");

  if (!itemSelect || !qtyInput || !lossEl) return;

  const item = (appState.inventory || []).find(i => i.id === itemSelect.value);
  const qty = parseFloat(qtyInput.value) || 0;
  const loss = item ? (qty * (item.unitCost || 0)) : 0;

  lossEl.textContent = `₹${loss.toFixed(2)}`;
}

/**
 * Saves a kitchen wastage log and deducts stock.
 */
function saveStockWastageForm(e) {
  e.preventDefault();

  const itemId = document.getElementById("waste-item-select").value;
  const qty = parseFloat(document.getElementById("waste-qty").value) || 0;
  const reason = document.getElementById("waste-reason").value;
  const reportedBy = document.getElementById("waste-reported-by").value.trim() || (currentUser ? currentUser.name : "Staff");
  const note = document.getElementById("waste-note").value.trim();

  if (!itemId || qty <= 0) {
    alert("Please enter a valid wasted quantity greater than zero.");
    return;
  }

  if (typeof PosInventory === "undefined") {
    alert("Inventory core module not loaded.");
    return;
  }

  const res = PosInventory.recordStockWastage(appState.inventory, { itemId, qty, reason, reportedBy, note });
  if (res && res.wastageRecord) {
    if (res.updatedInventory) appState.inventory = res.updatedInventory;
    const log = res.wastageRecord;
    if (!Array.isArray(appState.wastageLogs)) appState.wastageLogs = [];
    appState.wastageLogs.unshift(log);
    if (appState.wastageLogs.length > 500) appState.wastageLogs = appState.wastageLogs.slice(0, 500);

    saveAppState();
    closeStockWastageModal();
    renderInventoryView();

    alert(`Wastage logged! Raw material stock deducted by ${qty} ${log.uom}.\nFinancial loss of ₹${log.costLoss.toFixed(2)} recorded.`);
  }
}

/**
 * Renders the Physical Count Audit & Reconciliation view.
 */
function renderInventoryAuditView() {
  const itemSelect = document.getElementById("audit-item-select");
  const tbody = document.getElementById("inv-audit-table-body") || document.getElementById("stock-audit-table-body");
  const physicalInput = document.getElementById("audit-physical-qty");

  if (!itemSelect || !tbody) return;

  const rawItems = appState.inventory || [];

  if (rawItems.length === 0) {
    itemSelect.innerHTML = `<option value="">No raw materials in inventory</option>`;
  } else {
    itemSelect.innerHTML = rawItems.map(item =>
      `<option value="${item.id}">${escapeHtml(item.name)} (${escapeHtml(item.code)}) - System Stock: ${item.stockQty} ${item.uom}</option>`
    ).join("");
  }

  if (physicalInput) physicalInput.value = "";
  onAuditItemSelected(itemSelect.value);

  // Render previous audit log history
  const audits = appState.stockAudits || [];

  if (audits.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="p-8 text-center text-[#5C534B]">
          <div class="flex flex-col items-center justify-center gap-1.5">
            <span class="material-symbols-outlined text-[32px] text-stone-300">fact_check</span>
            <p class="font-bold text-xs">No physical count reconciliations yet</p>
            <p class="text-[11px] text-stone-400">Perform periodic kitchen audits to spot shrinkage and align system stock with real counts.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = audits.map(audit => {
    const isZero = audit.variance === 0;
    const isLoss = audit.variance < 0;
    const dateFormatted = audit.date ? new Date(audit.date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : "-";

    const badge = isZero
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Exact Match</span>`
      : isLoss
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700 border border-red-200">${audit.variance} ${audit.uom} Shrinkage</span>`
      : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">+${audit.variance} ${audit.uom} Surplus</span>`;

    return `
      <tr class="hover:bg-[#FCFAF8] transition-colors border-b border-[#F6F2EC]">
        <td class="p-2.5 pl-3 font-mono text-[11px] text-[#5C534B]">${dateFormatted}</td>
        <td class="p-2.5">
          <div class="font-bold text-[#171717]">${escapeHtml(audit.itemName || "Item")}</div>
          <div class="text-[10px] font-mono text-stone-400">${escapeHtml(audit.itemCode || "")}</div>
        </td>
        <td class="p-2.5 text-center font-mono text-[#5C534B]">${audit.systemQty} ${audit.uom}</td>
        <td class="p-2.5 text-center font-mono font-bold text-[#171717]">${audit.physicalQty} ${audit.uom}</td>
        <td class="p-2.5 text-center font-mono font-extrabold ${isLoss ? 'text-red-700' : isZero ? 'text-emerald-700' : 'text-blue-700'}">${audit.variance > 0 ? '+' : ''}${audit.variance} ${audit.uom}</td>
        <td class="p-2.5 text-center">${badge}</td>
        <td class="p-2.5 pr-3 text-right text-[#5C534B] font-semibold">${escapeHtml(audit.auditedBy || "Auditor")}</td>
      </tr>
    `;
  }).join("");
}

/**
 * Handles selection change in audit item dropdown.
 */
function onAuditItemSelected(id) {
  const item = (appState.inventory || []).find(i => i.id === id);
  const uomLabel = document.getElementById("audit-uom-label");
  if (uomLabel) uomLabel.textContent = item ? item.uom : "pcs";
  calculateAuditVariancePreview();
}

/**
 * Updates variance preview in physical audit form.
 */
function calculateAuditVariancePreview() {
  const itemSelect = document.getElementById("audit-item-select");
  const physicalInput = document.getElementById("audit-physical-qty");
  const previewEl = document.getElementById("audit-variance-preview");

  if (!itemSelect || !physicalInput || !previewEl) return;

  const item = (appState.inventory || []).find(i => i.id === itemSelect.value);
  if (!item) {
    previewEl.innerHTML = `<span class="text-stone-400">System: -- | Diff: --</span>`;
    return;
  }

  const rawVal = physicalInput.value.trim();
  if (rawVal === "") {
    previewEl.innerHTML = `System: <span class="text-[#171717]">${item.stockQty} ${item.uom}</span> | Diff: <span class="text-stone-400">--</span>`;
    return;
  }

  const physical = parseFloat(rawVal) || 0;
  const system = item.stockQty || 0;
  const diff = Math.round((physical - system) * 1000) / 1000;

  let colorClass = "text-emerald-700";
  if (diff < 0) colorClass = "text-red-700";
  else if (diff > 0) colorClass = "text-blue-700";

  previewEl.innerHTML = `System: <span class="text-[#171717]">${system} ${item.uom}</span> | Diff: <span class="${colorClass} font-extrabold">${diff > 0 ? '+' : ''}${diff} ${item.uom}</span>`;
}

/**
 * Handles submission of physical stock count audit.
 */
function submitStockReconciliation(e) {
  e.preventDefault();

  const itemId = document.getElementById("audit-item-select").value;
  const physicalQty = parseFloat(document.getElementById("audit-physical-qty").value);

  if (!itemId || isNaN(physicalQty) || physicalQty < 0) {
    alert("Please select a raw material and enter a valid non-negative physical count.");
    return;
  }

  if (typeof PosInventory === "undefined") {
    alert("Inventory core module not loaded.");
    return;
  }

  const auditorName = currentUser ? currentUser.name : "Manager";
  const res = PosInventory.reconcilePhysicalStock(appState.inventory, { itemId, physicalCount: physicalQty, auditedBy: auditorName });

  if (res && res.auditRecord) {
    if (res.updatedInventory) appState.inventory = res.updatedInventory;
    const audit = res.auditRecord;
    if (!Array.isArray(appState.stockAudits)) appState.stockAudits = [];
    appState.stockAudits.unshift(audit);
    if (appState.stockAudits.length > 500) appState.stockAudits = appState.stockAudits.slice(0, 500);

    saveAppState();
    renderInventoryView();

    const diffStr = audit.variance > 0 ? `+${audit.variance}` : `${audit.variance}`;
    alert(`Stock Reconciled!\n${audit.itemName}: Stock adjusted to ${audit.physicalCount} ${audit.uom} (Variance: ${diffStr} ${audit.uom}).`);
  }
}

/**
 * Loads official sample raw materials and recipe BOMs into appState.
 */
function loadSampleInventoryData() {
  if (confirm("Load official The Retro Cafeteria raw materials list and standard recipe BOMs?\nExisting custom materials will be merged.")) {
    if (typeof PosInventory === "undefined") {
      alert("Inventory module not loaded.");
      return;
    }

    if (!Array.isArray(appState.inventory)) appState.inventory = [];
    if (!Array.isArray(appState.recipes)) appState.recipes = [];

    // Merge sample raw items
    PosInventory.SAMPLE_INVENTORY_ITEMS.forEach(sampleItem => {
      if (!appState.inventory.some(i => i.id === sampleItem.id || i.code === sampleItem.code)) {
        appState.inventory.push({ ...sampleItem });
      }
    });

    // Merge sample recipes
    PosInventory.SAMPLE_RECIPES.forEach(sampleRecipe => {
      if (!appState.recipes.some(r => r.dishId === sampleRecipe.dishId)) {
        appState.recipes.push({
          dishId: sampleRecipe.dishId,
          ingredients: sampleRecipe.ingredients.map(ing => ({ ...ing }))
        });
      }
    });

    saveAppState();
    renderInventoryView();
    alert("The Retro Cafeteria sample raw materials and recipe BOMs loaded successfully!");
  }
}

/**
 * Exports current raw materials inventory to a downloadable CSV file.
 */
function exportInventoryCSVDownload() {
  if (typeof PosInventory === "undefined" || !Array.isArray(appState.inventory)) {
    alert("No inventory data to export.");
    return;
  }

  const csv = PosInventory.exportInventoryCSV(appState.inventory);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  link.setAttribute("href", url);
  link.setAttribute("download", `retro_cafeteria_inventory_${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Window resize listener to keep sliding tabs and elements aligned
window.addEventListener("resize", () => {
  if (currentInventorySubtab && document.getElementById("view-inventory") && !document.getElementById("view-inventory").classList.contains("hidden")) {
    updateInventorySubtabSlider(currentInventorySubtab);
  }
});
