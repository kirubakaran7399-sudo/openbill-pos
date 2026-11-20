/**
 * src/data/defaultCatalog.js
 * The Retro Cafeteria POS — Preset Data, Sample Menu & Initial Store State
 */

const PosInventoryModule = typeof require !== "undefined"
  ? require("../core/inventory.js")
  : (typeof window !== "undefined" ? window.PosInventory : null);

const SAMPLE_STORE = {
  name: "THE RETRO CAFETERIA",
  tagline: "CRAVE MORE. LIVE RETRO.",
  address1: "Gandhi Road, Near Varadaraja Perumal Temple",
  address2: "Kanchipuram, Tamil Nadu - 631501",
  phone: "+91 44 2722 3456",
  gstin: "33AABCR1234F1Z5",
  fssai: "11223344556677",
  ownerWhatsApp: "9876543210", // Mobile number for 1-click WhatsApp daily reports & NC alerts
  ownerPhone: "9876543210",
  upiId: "retrocafe@upi", // Dynamic UPI VPA for GPay, PhonePe, Paytm QR payments
  printUpiQrOnBill: true, // Print UPI payment info on thermal bill
  gstRate: 5.0,
  taxMode: "exclusive", // "exclusive" or "inclusive"
  invoiceType: "tax_invoice", // "tax_invoice" or "bill_of_supply"
  printerWidth: "80mm", // "80mm" or "58mm"
  autoPrintKOT: true, // Auto-print Kitchen Slip on order placement (Spec §7.6)
  autoKickCashDrawer: true, // Auto-kick Cash Drawer on cash settlement (Spec §7.12)
  backupFolder: "", // Configurable local / Google Drive backup folder path (Spec §10)
  autoBackupEnabled: true, // Automatically save backup on bill settlement & day close
  roundOffEnabled: true,
  cashierDiscountLimit: 10, // max 10% discount without owner PIN
  autoLockMinutes: 5,
  footerMessage: "Thank you! Visit again.\nAuthorised signatory"
};

const SAMPLE_CATEGORIES = [
  { id: "cat_burgers", name: "Burgers", icon: "lunch_dining", sortOrder: 1 },
  { id: "cat_chicken", name: "Fried Chicken", icon: "restaurant", sortOrder: 2 },
  { id: "cat_pizza", name: "Pizza", icon: "local_pizza", sortOrder: 3 },
  { id: "cat_shawarma", name: "Shawarma", icon: "kebab_dining", sortOrder: 4 },
  { id: "cat_sides", name: "Sides & Fries", icon: "fastfood", sortOrder: 5 },
  { id: "cat_shakes", name: "Shakes & Mojitos", icon: "local_bar", sortOrder: 6 },
  { id: "cat_desserts", name: "Desserts & Waffles", icon: "icecream", sortOrder: 7 }
];

const SAMPLE_PRODUCTS = [
  {
    id: "prod_cb",
    name: "Chicken Burger",
    shortCode: "CB",
    category: "Burgers",
    price: 120,
    sizes: [
      { name: "Regular", price: 120 },
      { name: "Large", price: 160 }
    ],
    addons: [
      { name: "Extra Cheese", price: 20 },
      { name: "Mayo Dip", price: 15 },
      { name: "Extra Patty", price: 40 }
    ],
    gstRate: 5.0,
    diet: "non-veg",
    description: "Crispy fried patty with retro sauce and fresh lettuce",
    quickNotes: ["No onion", "Extra cheese", "Spicy patty"],
    trackStock: true,
    stockQty: 25,
    lowStockThreshold: 5,
    isAvailable: true,
    sortOrder: 1
  },
  {
    id: "prod_vb",
    name: "Classic Veg Burger",
    shortCode: "VB",
    category: "Burgers",
    price: 90,
    gstRate: 5.0,
    diet: "veg",
    description: "Garden vegetable patty with creamy mayo",
    quickNotes: ["No onion", "Extra mayo", "Less spicy"],
    isAvailable: true,
    sortOrder: 2
  },
  {
    id: "prod_pf",
    name: "Peri Peri Fries (L)",
    shortCode: "PF",
    category: "Sides & Fries",
    price: 90,
    gstRate: 5.0,
    diet: "veg",
    description: "Golden fries tossed in spicy African peri-peri dust",
    quickNotes: ["Extra spicy", "Less spicy", "Mayo dip"],
    trackStock: true,
    stockQty: 30,
    lowStockThreshold: 6,
    isAvailable: true,
    sortOrder: 3
  },
  {
    id: "prod_ff",
    name: "Salted Fries (Regular)",
    shortCode: "SF",
    category: "Sides & Fries",
    price: 70,
    gstRate: 5.0,
    diet: "veg",
    description: "Crispy sea-salted potato fries",
    quickNotes: ["No salt", "Extra crispy"],
    isAvailable: true,
    sortOrder: 4
  },
  {
    id: "prod_mm",
    name: "Mint Mojito",
    shortCode: "MM",
    category: "Shakes & Mojitos",
    price: 80,
    gstRate: 5.0,
    diet: "veg",
    description: "Refreshing crushed garden mint, fresh lime and chilled soda",
    quickNotes: ["Less ice", "Less sugar", "Extra fizz"],
    isAvailable: true,
    sortOrder: 5
  },
  {
    id: "prod_cs",
    name: "Retro Chicken Shawarma",
    shortCode: "CS",
    category: "Shawarma",
    price: 110,
    gstRate: 5.0,
    diet: "non-veg",
    description: "Slow-roasted marinated chicken in warm kuboos with garlic toum",
    quickNotes: ["No cabbage", "Only chicken", "Extra garlic sauce"],
    isAvailable: true,
    sortOrder: 6
  },
  {
    id: "prod_pc",
    name: "Crispy Chicken Popcorn",
    shortCode: "CP",
    category: "Fried Chicken",
    price: 130,
    gstRate: 5.0,
    diet: "non-veg",
    description: "Bite-sized seasoned tender chicken nuggets",
    quickNotes: ["Extra dip", "Spicy"],
    isAvailable: true,
    sortOrder: 7
  },
  {
    id: "prod_pz",
    name: "Margherita Pizza (7\")",
    shortCode: "MP",
    category: "Pizza",
    price: 150,
    gstRate: 5.0,
    diet: "veg",
    description: "Herb tomato pomodoro base topped with melted mozzarella",
    quickNotes: ["Extra cheese", "Well done base"],
    isAvailable: true,
    sortOrder: 8
  },
  {
    id: "prod_wf",
    name: "Belgian Chocolate Waffle",
    shortCode: "CW",
    category: "Desserts & Waffles",
    price: 120,
    gstRate: 5.0,
    diet: "veg",
    description: "Freshly baked crispy waffle smothered in dark Belgian chocolate",
    quickNotes: ["Extra chocolate", "Warm"],
    isAvailable: true,
    sortOrder: 9
  }
];

const SAMPLE_TABLES = [
  { id: "tbl_1", name: "Table 1", section: "Main Hall", seats: 4, isOccupied: false, isActive: true },
  { id: "tbl_2", name: "Table 2", section: "Main Hall", seats: 4, isOccupied: false, isActive: true },
  { id: "tbl_3", name: "Table 3", section: "Main Hall", seats: 2, isOccupied: false, isActive: true },
  { id: "tbl_4", name: "Table 4", section: "Main Hall", seats: 2, isOccupied: false, isActive: true },
  { id: "tbl_5", name: "Table 5", section: "Main Hall", seats: 6, isOccupied: false, isActive: true },
  { id: "tbl_6", name: "Table 6", section: "Main Hall", seats: 4, isOccupied: false, isActive: true },
  { id: "tbl_7", name: "Table 7", section: "Main Hall", seats: 4, isOccupied: false, isActive: true },
  { id: "tbl_8", name: "Table 8", section: "Main Hall", seats: 4, isOccupied: false, isActive: true },
  { id: "tbl_9", name: "AC 1", section: "AC Section", seats: 4, isOccupied: false, isActive: true },
  { id: "tbl_10", name: "AC 2", section: "AC Section", seats: 4, isOccupied: false, isActive: true },
  { id: "tbl_11", name: "AC 3", section: "AC Section", seats: 6, isOccupied: false, isActive: true },
  { id: "tbl_12", name: "AC 4", section: "AC Section", seats: 8, isOccupied: false, isActive: true }
];

/**
 * Creates the initial clean state with a blank catalog (as requested in Q3)
 * with the option to load sample menu items anytime.
 */
function createInitialState(loadSampleCatalog = false) {
  const invSource = (typeof PosInventoryModule !== "undefined" && PosInventoryModule?.SAMPLE_INVENTORY_ITEMS)
    ? PosInventoryModule
    : (typeof PosInventory !== "undefined" && PosInventory?.SAMPLE_INVENTORY_ITEMS
      ? PosInventory
      : (typeof window !== "undefined" && window.PosInventory ? window.PosInventory : null));

  const sampleInv = (loadSampleCatalog && invSource) ? [...invSource.SAMPLE_INVENTORY_ITEMS] : [];
  const sampleRec = (loadSampleCatalog && invSource) ? [...invSource.SAMPLE_RECIPES] : [];

  return {
    version: 3,
    store: { ...SAMPLE_STORE },
    categories: loadSampleCatalog ? [...SAMPLE_CATEGORIES] : [],
    products: loadSampleCatalog ? [...SAMPLE_PRODUCTS] : [],
    tables: loadSampleCatalog ? [...SAMPLE_TABLES] : [],
    inventory: sampleInv,
    recipes: sampleRec,
    purchaseInwards: [],
    wastageLogs: [],
    stockAudits: [],
    staff: [
      { id: "usr_owner", name: "Store Owner", role: "owner", pin: "1234", title: "Owner / Manager" },
      { id: "usr_cashier", name: "Counter Cashier", role: "cashier", pin: "0000", title: "Cashier" }
    ],
    salesLedger: [],
    billSequence: 1,
    dailyTokenDate: new Date().toISOString().split("T")[0],
    dailyTokenCounter: 1,
    openOrders: {}, // keyed by tableId or takeaway token
    heldOrders: [] // list of held orders
  };
}

// Module export for Node.js test runner and browser window
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SAMPLE_STORE,
    SAMPLE_CATEGORIES,
    SAMPLE_PRODUCTS,
    SAMPLE_TABLES,
    createInitialState
  };
}
if (typeof window !== "undefined") {
  window.PosCatalog = {
    SAMPLE_STORE,
    SAMPLE_CATEGORIES,
    SAMPLE_PRODUCTS,
    SAMPLE_TABLES,
    createInitialState
  };
}
