import { useState, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import axios from "axios";
import { db } from "./db";

// 🛠️ HOSTING CONFIGURATION: Localhost සහ Render.com දෙකටම ගැලපෙන සේ පොදු URL එකක් සාදා ඇත
// Render එකට දැමූ පසු "http://localhost:5008/api", https://supermkt-pos-backend.onrender.com/api වෙනුවට Render Live URL එක දමන්න
const API_BASE_URL = "https://supermkt-pos-backend.onrender.com/api"; 

// 🛠️ NEW: සියලුම Product Categories එකම තැනකින් manage කිරීමට (Admin dropdown + Billing sidebar දෙකටම use වේ)
const PRODUCT_CATEGORIES = [
  { value: "Grocery", label: "Grocery (සිල්ලර බඩු)", icon: "👜" },
  { value: "Vegetables", label: "Vegetables (එළවළු)", icon: "🥦" },
  { value: "Fruits", label: "Fruits (පළතුරු)", icon: "🍎" },
  { value: "Beverages", label: "Beverages (බීම වර්ග)", icon: "🥤" },
  { value: "Snacks", label: "Snacks (කෑම/නැවුම්)", icon: "🍟" },
  { value: "Sweets", label: "Sweets (රසකැවිලි)", icon: "🍬" },
  { value: "Biscuits", label: "Biscuits (බිස්කට්)", icon: "🍪" },
  { value: "Dairy", label: "Dairy (කිරි නිෂ්පාදන)", icon: "🥛" },
  { value: "Bakery", label: "Bakery (පාන්/කේක්)", icon: "🍞" },
  { value: "Cosmetics", label: "Cosmetics (රූපලාවන්‍ය ද්‍රව්‍ය)", icon: "💄" },
  { value: "Household", label: "Household (ගෘහ උපකරණ)", icon: "🧴" },
  { value: "Other", label: "Other (වෙනත්)", icon: "📦" },
];

// 🛠️ NEW: Unit symbols - centralized (Unit නොමැති/Empty items සඳහාත් "" handle කරයි)
const UNIT_SYMBOLS = { Kg: "kg", G: "g", Pieces: "Pieces", Packet: "Packet", Bottle: "Bottle", "": "" };

// 🛠️ NEW: JavaScript Floating-Point Precision Errors (0.1 + 0.2 = 0.30000000000000004 වගේ) නිවැරදි කිරීමට
// දශම ස්ථාන 3කට Round කරයි (Grams level accuracy - 1g දක්වා නිවැරදියි, ඊට වඩා අනවශ්‍ය decimal noise ඉවත් කරයි)
const roundQty = (num) => Math.round((parseFloat(num) || 0) * 1000) / 1000;

// 🛠️ NEW: Quantity + Unit එක Standard විදිහට Format කිරීම
// - "Kg" Unit එකේදී, ප්‍රමාණය 1ට වඩා අඩු නම් (උදා: 0.5 Kg) → ග්‍රෑම් වලට Convert කර "500g" විදිහට පෙන්වයි
// - අනිත් සියලුම Units වලට, සාමාන්‍ය symbol එකම (kg/Pieces/Packet/Bottle) පෙන්වයි
// - Unit එකක් තෝරලා නැත්නම් (Empty), symbol එකක් නැතුව ප්‍රමාණය විතරක් පෙන්වයි
const formatQtyWithUnit = (qty, unit) => {
  const qtyNum = roundQty(qty); // 🛠️ Floating-point drift (3.5500000000000007 වගේ) මෙතනින්ම clean වෙනවා
  if (unit === "Kg" && qtyNum > 0 && qtyNum < 1) {
    const grams = Math.round(qtyNum * 1000);
    return `${grams}g`;
  }
  const symbol = UNIT_SYMBOLS[unit] ?? unit ?? "";
  return symbol ? `${qtyNum} ${symbol}` : `${qtyNum}`;
};

function App() {
  const [activeTab, setActiveTab] = useState("billing");
  const [adminSubTab, setAdminSubTab] = useState("products");
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(true);

  // 🆕 MULTI-PRICE POPUP: Scan/Search කරන භාණ්ඩයට Price Batches කිහිපයක් තියෙනවා නම්, තෝරාගන්න popup එකට
  const [multiPricePopup, setMultiPricePopup] = useState(null); // holds the product pending price selection

  // Search States
  const [billingSearch, setBillingSearch] = useState("");
  const [adminProductSearch, setAdminProductSearch] = useState("");
  const [billingCategoryFilter, setBillingCategoryFilter] = useState("All"); // 🛠️ NEW: Billing screen category filter

  // Cash & Payment States
  const [cashReceived, setCashReceived] = useState("");
  const [balanceAmount, setBalanceAmount] = useState(0);
  const [amountPaid, setAmountPaid] = useState(""); 

  // Customer & Credit Book States
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [searchPhone, setSearchPhone] = useState(""); // Holds Name or Phone query
  const [customerForm, setCustomerForm] = useState({ name: "", phone: "" });
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [editCustomerId, setEditCustomerId] = useState(null);
  const [creditPayment, setCreditPayment] = useState({ customerId: "", amount: "" });

  // 🛠️ NEW: Supplier Management States
  const [suppliers, setSuppliers] = useState([]);
  const [supplierForm, setSupplierForm] = useState({ name: "", phone: "", address: "" });
  const [isEditingSupplier, setIsEditingSupplier] = useState(false);
  const [editSupplierId, setEditSupplierId] = useState(null);
  // 🛠️ UPDATED (Step 2 - GRN Multi-item): එකම Supplier Invoice එකකින් Products කිහිපයක් cart එකක් විදිහට එකතු කිරීමට
  const [grnSupplierId, setGrnSupplierId] = useState("");
  const [grnCurrentItem, setGrnCurrentItem] = useState({ productId: "", quantity: "", costPrice: "", stockMode: "add" });
  const [grnItems, setGrnItems] = useState([]); // [{ productId, productName, unit, quantity, costPrice }]
  const [grnDescription, setGrnDescription] = useState("");
  const [viewSupplierDetails, setViewSupplierDetails] = useState(null); // 🛠️ NEW: Supplier details modal එකට (ledger history)
  const [viewCustomerDetails, setViewCustomerDetails] = useState(null); // 🆕 Customer credit ledger modal එකට (customer _id)
  const [supplierPayment, setSupplierPayment] = useState({ supplierId: "", amount: "" });

  // 🛠️ NEW: Live Customer Search (Suggestions Dropdown) States
  const [customerSuggestions, setCustomerSuggestions] = useState([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [highlightedCustomerIndex, setHighlightedCustomerIndex] = useState(-1);

  // Payment Method State
  const [paymentMethod, setPaymentMethod] = useState("Cash");

  // Sales Summary State
  const [salesSummary, setSalesSummary] = useState({ 
    totalSalesCount: 0, totalRevenue: 0, totalProfit: 0, 
    breakdown: { cashSales: 0, cardSales: 0, qrSales: 0, creditSales: 0 }, sales: [] 
  });

  // 🛠️ UPDATED: සිස්ටම් එක Refresh කරද්දී LocalStorage එක පරීක්ෂා කර ලොග් වී සිටින පරිශීලකයා රඳවා ගනී
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem("pos_user");
    return savedUser ? JSON.parse(savedUser) : null;
  });
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginError, setLoginError] = useState("");

  // 🆕 Billing redesign: declared here (not lower down) because the barcode-scanner
  // useEffect above references showTender, and hooks run top-to-bottom each render —
  // a const declared later would be read before initialization otherwise.
  const [showTender, setShowTender] = useState(false);       // payment moved out of the footer
  const [catalogOpen, setCatalogOpen] = useState(true);      // F8 collapses it for scanner-only work
  const [catalogSearch, setCatalogSearch] = useState("");    // separate from the scan bar
  const [billingHighlightIndex, setBillingHighlightIndex] = useState(-1); // 🛠️ FIX: keyboard nav for the scan-bar suggestions dropdown
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const billingSearchRef = useRef(null);
  const cartScrollRef = useRef(null);

  // Product CRUD States
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState(null);
  const [productForm, setProductForm] = useState({ name: "", marketPrice: "", price: "", costPrice: "", stock: "", barcode: "", discountPercent: "", unit: "Kg", category: "Grocery", minStockLevel: "5", preferredSupplierId: "", expiryDate: "", batches: [] });
  // 🆕 MULTI-PRICE (Simplified): Edit කරන්න ගත්තු Product එකේ Database එකේ තියෙන Original Price/Stock එක මතක තියාගන්න (පරණ Batch එක Auto-සාදන්න)
  const [editingOriginalProduct, setEditingOriginalProduct] = useState(null);
  // 🆕 MULTI-PRICE (Simplified): "නව මිලකට Stock ලැබුනා" කියන mini-form එකේ state එක
  const [showNewPriceEntry, setShowNewPriceEntry] = useState(false);
  const [newPriceEntry, setNewPriceEntry] = useState({ price: "", qty: "", costPrice: "", discount: "" });

  // 🆕 RETURN / REFUND / EXCHANGE States
  const [returnInvoiceSearch, setReturnInvoiceSearch] = useState("");
  const [returnSaleData, setReturnSaleData] = useState(null); // Server එකෙන් ආපු පැරණි බිල
  const [returnSelections, setReturnSelections] = useState({}); // { [itemId]: { qty, reason, checked } }
  const [refundMethod, setRefundMethod] = useState("Cash");
  const [isExchangeMode, setIsExchangeMode] = useState(false);
  const [exchangeCart, setExchangeCart] = useState([]); // Exchange එකේදී අලුතින් දෙන භාණ්ඩ
  const [exchangeCashReceived, setExchangeCashReceived] = useState("");
  const [exchangePaymentMethod, setExchangePaymentMethod] = useState("Cash");
  const [returnLoading, setReturnLoading] = useState(false);
  const [returnHistory, setReturnHistory] = useState([]);
  // 🆕 Unregistered Items tab එකේ Manually "Delete" කරපු item names ටික - localStorage එකේ persist වේ (Browser/Device එකට Local)
  const [dismissedUnregisteredItems, setDismissedUnregisteredItems] = useState(() => {
    try {
      const saved = localStorage.getItem("smartstore_dismissed_unregistered_items");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [exchangeProductSearch, setExchangeProductSearch] = useState("");

  // 🆕 EXPIRY TRACKING State
  const [expiringProducts, setExpiringProducts] = useState([]);

  // 🆕 PRINT RECEIPT: අන්තිමට Checkout කරපු Sale එකේ Professional Invoice Number එක (Return search එකට use වෙන්නේ මේකයි)
  const [lastInvoiceNo, setLastInvoiceNo] = useState(null);
  const [lastSaleIsOffline, setLastSaleIsOffline] = useState(false);

  // Emergency Temp Item Form State (For Any Role)
  const [tempItemForm, setTempItemForm] = useState({ name: "", price: "", qty: "1", unit: "Kg", barcode: "" });
  const [registerTempAsProduct, setRegisterTempAsProduct] = useState(false); // 🆕 Emergency item එකත් Database එකට Register කරනවද

  const [showTempItemModal, setShowTempItemModal] = useState(false);

  // Custom Toast State
  const [toasts, setToasts] = useState([]);

  // 🆕 MODERN CONFIRM/PROMPT DIALOG STATE (replaces native window.confirm / window.prompt)
  // dialogRequest holds: { title, message, tone, confirmLabel, cancelLabel, requireText, resolve }
  const [dialogRequest, setDialogRequest] = useState(null);
  const [dialogTypedText, setDialogTypedText] = useState("");

  // Opens a modern confirmation dialog and resolves to true/false (Promise-based),
  // so call-sites read just like `if (window.confirm(...))` used to.
  // Pass { requireText: "DELETE" } for destructive type-to-confirm actions
  // (replaces the old window.prompt("...DELETE...") pattern).
  const askConfirm = (options = {}) => {
    return new Promise((resolve) => {
      setDialogTypedText("");
      setDialogRequest({
        title: options.title || "තහවුරු කරන්න",
        message: options.message || "",
        tone: options.tone || "default", // "default" | "danger" | "warning"
        confirmLabel: options.confirmLabel || "තහවුරු කරන්න",
        cancelLabel: options.cancelLabel || "අවලංගු කරන්න",
        requireText: options.requireText || null,
        resolve,
      });
    });
  };

  const resolveDialog = (result) => {
    if (dialogRequest?.resolve) dialogRequest.resolve(result);
    setDialogRequest(null);
    setDialogTypedText("");
  };

  let barcodeBuffer = "";
  let lastKeyTime = Date.now();

  // Helper to trigger custom beautiful toast notifications
  const showToast = (message, type = "success") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 500);
  };

  useEffect(() => {
    if (user) {
      fetchProducts();
      fetchCustomers();
      if (user.role === "admin") {
        fetchSalesSummary();
        fetchSuppliers();
        fetchReturnHistory();
      }
      fetchExpiringProducts();
    }
  }, [user]);

  // Escape key + background scroll lock
useEffect(() => {
  if (!showTempItemModal) return;

  const handleEsc = (e) => {
    if (e.key === "Escape") {
      setShowTempItemModal(false);
    }
  };

  document.body.style.overflow = "hidden";
  window.addEventListener("keydown", handleEsc);

  return () => {
    document.body.style.overflow = "unset";
    window.removeEventListener("keydown", handleEsc);
  };
}, [showTempItemModal]);

  // 🆕 Modern confirm/prompt dialog: Escape to cancel, Enter to confirm (when not blocked by requireText), scroll lock
  useEffect(() => {
    if (!dialogRequest) return;

    const handleKey = (e) => {
      if (e.key === "Escape") {
        resolveDialog(false);
      } else if (e.key === "Enter" && !dialogRequest.requireText) {
        e.preventDefault();
        resolveDialog(true);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKey);

    return () => {
      document.body.style.overflow = "unset";
      window.removeEventListener("keydown", handleKey);
    };
  }, [dialogRequest]);

  // Live Balance Calculation
  useEffect(() => {
    const total = calculateTotal();
    const received = parseFloat(cashReceived) || 0;
    if (received >= total) {
      setBalanceAmount(received - total);
    } else {
      setBalanceAmount(0);
    }
  }, [cashReceived, cart, amountPaid]);

  // 🛠️ NEW: Live Customer Search (Debounce Logic)
  useEffect(() => {
    if (searchPhone.trim().length === 0) {
      setCustomerSuggestions([]);
      setShowCustomerDropdown(false);
      setHighlightedCustomerIndex(-1);
      return;
    }

    setCustomerSearchLoading(true);

    const debounceTimer = setTimeout(async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/customers/search/${searchPhone}`);
        setCustomerSuggestions(response.data);
        setShowCustomerDropdown(true);
        setHighlightedCustomerIndex(-1);
      } catch (error) {
        setCustomerSuggestions([]);
        setShowCustomerDropdown(false);
      } finally {
        setCustomerSearchLoading(false);
      }
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [searchPhone]);

  useEffect(() => {
    const handleOnline = async () => {
      showToast("🔄 අන්තර්ජාලය නැවත ලැබුණි! දත්ත සමගාමී (Sync) කරයි...", "warning");
      
      // Pending බිල්පත් ලැයිස්තුව ලබා ගනී
      const pendingSales = await db.offlineSales.where('status').equals('pending').toArray();
      
      if (pendingSales.length === 0) return;

      for (const sale of pendingSales) {
        try {
          // එකින් එක සර්වර් එකට යවයි
          await axios.post(`${API_BASE_URL}/products/checkout`, {
            cartItems: sale.cartItems,
            cashierName: sale.cashierName,
            paymentMethod: sale.paymentMethod,
            customerId: sale.customerId,
            cashReceived: sale.cashReceived,
            balanceAmount: sale.balanceAmount,
            amountPaid: sale.amountPaid,
            amountDue: sale.amountDue
          });
          
          // සාර්ථක නම් Local DB එකෙන් මකා දමයි
          await db.offlineSales.delete(sale.id);
        } catch (err) {
          console.error("​බිල Sync කිරීම අසාර්ථකයි:", err);
        }
      }
      showToast("✅ සියලුම Offline බිල්පත් සාර්ථකව server එකට යැවුවා! 🎉");
      fetchProducts();
      if (user.role === "admin") fetchSalesSummary(); // 🛠️ FIX: Offline sales sync වුනාට පස්සේත් Unregistered Items/Sales Logs Refresh වේ
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [products]);

  // Barcode Scanner Logic
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === "INPUT") return;
      if (activeTab !== "billing" || !user) return;
      if (showTender) return;
      const currentTime = Date.now();
      if (currentTime - lastKeyTime > 100) barcodeBuffer = "";
      lastKeyTime = currentTime;
      if (e.key === "Enter") {
        if (barcodeBuffer.length > 0) {
          const scannedProduct = products.find((p) => p.barcode === barcodeBuffer);
          if (scannedProduct) {
            addToCart(scannedProduct);
          } else {
            // Barcode not found - auto fill in emergency form for faster handling
            setTempItemForm((prev) => ({ ...prev, barcode: barcodeBuffer }));
            showToast(`⚠️ බාර්කෝඩ් "${barcodeBuffer}" පද්ධතියේ නැත! කරුණාකර තාවකාලිකව ඇතුලත් කරන්න.`, "warning");
          }
          barcodeBuffer = "";
        }
      } else if (e.key !== "Shift") {
        barcodeBuffer += e.key;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [products, cart, activeTab, user, showTender]);

  const fetchProducts = async () => {
  try {
    const response = await axios.get(`${API_BASE_URL}/products`);
    setProducts(response.data);
    setLoading(false);

    // 🛠️ UPDATED: Online ආපු ගමන් බඩු ටික local DB එකටත් දානවා Offline පාවිච්චි කරන්න
    await db.products.clear(); // පරණ දත්ත මකනවා
    await db.products.bulkAdd(response.data); // අලුත් බඩු ටික දානවා
    
  } catch (error) {
    console.log("Backend එකට සම්බන්ධ විය නොහැක. Offline දත්ත පරීක්ෂා කරයි... ⚠️");
    
    // 🛠️ UPDATED: සර්වර් Error නම් (Offline නම්) Local DB එකෙන් බඩු ටික ගන්නවා
    const localProducts = await db.products.toArray();
    if (localProducts.length > 0) {
      setProducts(localProducts);
      showToast("පද්ධතිය Offline ක්‍රියාත්මක වේ! 📴", "warning");
    }
    setLoading(false);
  }
};

  const fetchSalesSummary = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/products/sales-summary`);
      setSalesSummary(response.data);
    } catch (error) { console.error(error); }
  };

  const fetchCustomers = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/customers`);
      setCustomers(response.data);
    } catch (error) { console.error(error); }
  };

  // 🛠️ NEW: Suppliers ලබාගැනීම
  const fetchSuppliers = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/suppliers`);
      setSuppliers(response.data);
    } catch (error) { console.error(error); }
  };

  // 🆕 Expire වෙන / වෙච්ච භාණ්ඩ ලබාගැනීම (ඉදිරි දින 7 ඇතුලත)
  const fetchExpiringProducts = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/products/expiring?days=7`);
      setExpiringProducts(response.data);
    } catch (error) { console.error(error); }
  };

  // 🆕 Return/Exchange History ලබාගැනීම (Admin Reporting)
  const fetchReturnHistory = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/products/returns`);
      setReturnHistory(response.data);
    } catch (error) { console.error(error); }
  };

  // 🆕 සියලුම Return/Exchange History Permanently Clear කිරීම
  // ⚠️ Destructive action එකක් - "DELETE" type කරලා confirm කරන්න ඕන
  const handleClearAllReturns = async () => {
    const confirmed = await askConfirm({
      title: "Clear Return/Exchange History!",
      message: `මෙයින් Return/Exchange ඉතිහාසය (${returnHistory.length} Records) සම්පූර්ණයෙන්ම, ආපහු ලබාගත නොහැකි ලෙස Delete වේ!`,
      tone: "danger",
      confirmLabel: "සියල්ල මකන්න",
      requireText: "DELETE",
    });
    if (!confirmed) return;
    try {
      const response = await axios.delete(`${API_BASE_URL}/products/returns/clear-all`);
      showToast(response.data.message || "Return/Exchange ඉතිහාසය Clear කලා! 🧹");
      fetchReturnHistory();
    } catch (error) { showToast("Clear කිරීම අසාර්ථකයි!", "error"); }
  };

  // --- CUSTOMER CRUD ---
  const handleCustomerSubmit = async (e) => {
    e.preventDefault();
    try {
      if (isEditingCustomer) {
        // 🛠️ Port එක 5008 සහ API Base URL එකට ගැළපෙන සේ සකසා ඇත
        await axios.put(`${API_BASE_URL}/customers/update/${editCustomerId}`, customerForm);
        setIsEditingCustomer(false);
        setEditCustomerId(null);
        showToast("පාරිභෝගික විස්තර සාර්ථකව යාවත්කාලීන කලා!");
      } else {
        const response = await axios.post(`${API_BASE_URL}/customers/add`, customerForm);
        showToast(response.data.message || "පාරිභෝගිකයා සාර්ථකව ඇතුලත් කලා!");
        setSelectedCustomer(response.data.customer);
      }
      setCustomerForm({ name: "", phone: "" });
      fetchCustomers();
    } catch (error) { showToast("ක්‍රියාවලිය අසාර්ථකයි!", "error"); }
  };

  const handleEditCustomerClick = (customer) => {
    setIsEditingCustomer(true);
    setEditCustomerId(customer._id);
    setCustomerForm({ name: customer.name, phone: customer.phone });
  };

  const handleDeleteCustomerClick = async (id) => {
    const confirmed = await askConfirm({
      title: "පාරිභෝගිකයා මකන්න",
      message: "මෙම පාරිභෝගිකයාව මකා දැමීමට අවශ්‍ය බව විශ්වාසද?",
      tone: "danger",
      confirmLabel: "මකන්න",
    });
    if (!confirmed) return;
    try {
      // 🛠️ Port 5008 සහ API Base URL එකට ගැළපෙන සේ සකසා ඇත
      await axios.delete(`${API_BASE_URL}/customers/delete/${id}`);
      showToast("මකා දැමීම සාර්ථකයි!");
      fetchCustomers();
    } catch (error) { showToast("මකා දැමීම අසාර්ථකයි!", "error"); }
  };

  // 🛠️ UPDATED: Dropdown එකෙන් හෝ Enter key එකෙන් පාරිභෝගිකයෙක් තෝරාගැනීම
  const handleSelectCustomer = (customer) => {
    setSelectedCustomer(customer);
    setSearchPhone(customer.name);
    setShowCustomerDropdown(false);
    setCustomerSuggestions([]);
    setHighlightedCustomerIndex(-1);
    showToast("පාරිභෝගික ගිණුම සාර්ථකව සම්බන්ධ කලා! 👤");
  };

  // 🛠️ UPDATED: Keyboard එකෙන් suggestions dropdown එක navigate කිරීම (ArrowUp/Down + Enter + Escape)
  const handleCustomerSearchKeyDown = (e) => {
    if (!showCustomerDropdown || customerSuggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedCustomerIndex((prev) => (prev < customerSuggestions.length - 1 ? prev + 1 : prev));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedCustomerIndex((prev) => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const indexToSelect = highlightedCustomerIndex >= 0 ? highlightedCustomerIndex : 0;
      if (customerSuggestions[indexToSelect]) {
        handleSelectCustomer(customerSuggestions[indexToSelect]);
      } else {
        showToast("මෙම නමින් හෝ අංකයෙන් පාරිභෝගිකයෙකු සොයාගත නොහැක!", "warning");
      }
    } else if (e.key === "Escape") {
      setShowCustomerDropdown(false);
      setHighlightedCustomerIndex(-1);
    }
  };

  const handleSettleCredit = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE_URL}/customers/pay-credit/${creditPayment.customerId}`, {
        amount: creditPayment.amount
      });
      showToast("ණය මුදල සාර්ථකව කපා හැරියා! 🎉");
      setCreditPayment({ customerId: "", amount: "" });
      fetchCustomers();
    } catch (error) { showToast("ණය පියවීම අසාර්ථකයි!", "error"); }
  };

  // --- SUPPLIER CRUD ---
  const handleSupplierSubmit = async (e) => {
    e.preventDefault();
    try {
      if (isEditingSupplier) {
        await axios.put(`${API_BASE_URL}/suppliers/update/${editSupplierId}`, supplierForm);
        setIsEditingSupplier(false);
        setEditSupplierId(null);
        showToast("සැපයුම්කරුගේ විස්තර සාර්ථකව යාවත්කාලීන කලා!");
      } else {
        await axios.post(`${API_BASE_URL}/suppliers/add`, supplierForm);
        showToast("සැපයුම්කරු සාර්ථකව ඇතුලත් කලා! 🚚");
      }
      setSupplierForm({ name: "", phone: "", address: "" });
      fetchSuppliers();
    } catch (error) { showToast(error.response?.data?.message || "ක්‍රියාවලිය අසාර්ථකයි!", "error"); }
  };

  const handleEditSupplierClick = (supplier) => {
    setIsEditingSupplier(true);
    setEditSupplierId(supplier._id);
    setSupplierForm({ name: supplier.name, phone: supplier.phone, address: supplier.address || "" });
  };

  const handleDeleteSupplierClick = async (id) => {
    const confirmed = await askConfirm({
      title: "සැපයුම්කරුව මකන්න",
      message: "මෙම සැපයුම්කරුව මකා දැමීමට අවශ්‍ය බව විශ්වාසද?",
      tone: "danger",
      confirmLabel: "මකන්න",
    });
    if (confirmed) {
      try {
        await axios.delete(`${API_BASE_URL}/suppliers/delete/${id}`);
        showToast("මකා දැමීම සාර්ථකයි!");
        fetchSuppliers();
      } catch (error) { showToast("මකා දැමීම අසාර්ථකයි!", "error"); }
    }
  };

  // 🛠️ UPDATED (Step 2 - GRN Multi-item): වත්මන් Row එක GRN List එකට එකතු කිරීම
  const handleAddGrnItem = () => {
    if (!grnCurrentItem.productId) {
      return showToast("කරුණාකර භාණ්ඩයක් තෝරන්න!", "warning");
    }
    if (!grnCurrentItem.quantity || parseFloat(grnCurrentItem.quantity) <= 0) {
      return showToast("නිවැරදි ප්‍රමාණයක් ඇතුලත් කරන්න!", "warning");
    }
    if (!grnCurrentItem.costPrice || parseFloat(grnCurrentItem.costPrice) <= 0) {
      return showToast("නිවැරදි ගැනුම් මිලක් ඇතුලත් කරන්න!", "warning");
    }

    const product = products.find(p => p._id === grnCurrentItem.productId);
    if (!product) return showToast("භාණ්ඩය සොයාගත නොහැක!", "error");

    setGrnItems([...grnItems, {
      productId: product._id,
      productName: product.name,
      unit: product.unit ?? "Kg",
      quantity: parseFloat(grnCurrentItem.quantity),
      costPrice: parseFloat(grnCurrentItem.costPrice),
      stockMode: grnCurrentItem.stockMode || "add"
    }]);

    // Row එක reset කරයි, ඊළඟ item එක type කරන්න
    setGrnCurrentItem({ productId: "", quantity: "", costPrice: "", stockMode: "add" });
  };

  // 🛠️ NEW: GRN List එකෙන් Item එකක් ඉවත් කිරීම
  const handleRemoveGrnItem = (index) => {
    setGrnItems(grnItems.filter((_, i) => i !== index));
  };

  // 🛠️ UPDATED (Step 2 - GRN Multi-item): List එකේ තියෙන Items ඔක්කොම එකවර Submit කිරීම
  const handleSubmitGrn = async () => {
    if (!grnSupplierId) return showToast("කරුණාකර සැපයුම්කරුවෙක් තෝරන්න!", "warning");
    if (grnItems.length === 0) return showToast("අවම වශයෙන් භාණ්ඩයක් හෝ GRN List එකට එකතු කරන්න!", "warning");

    try {
      const response = await axios.post(`${API_BASE_URL}/suppliers/record-purchase/${grnSupplierId}`, {
        items: grnItems.map(item => ({ productId: item.productId, quantity: item.quantity, costPrice: item.costPrice, stockMode: item.stockMode })),
        description: grnDescription
      });
      showToast(response.data.message || "GRN එක සාර්ථකව සටහන් කලා! 📦");
      setGrnSupplierId("");
      setGrnItems([]);
      setGrnCurrentItem({ productId: "", quantity: "", costPrice: "", stockMode: "add" });
      setGrnDescription("");
      fetchSuppliers();
      fetchProducts(); // 🛠️ Stock එකත් Cost Price එකත් වෙනස් වුනු නිසා Products ලැයිස්තුවත් Refresh කරයි
    } catch (error) { showToast(error.response?.data?.message || "සටහන් කිරීම අසාර්ථකයි!", "error"); }
  };

  // 🛠️ NEW: Supplier ට මුදල් ගෙවීම (Balance Due අඩු කරයි)
  const handleSettleSupplierPayment = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE_URL}/suppliers/pay/${supplierPayment.supplierId}`, {
        amount: supplierPayment.amount
      });
      showToast("ගෙවීම සාර්ථකව සටහන් කලා! 💵");
      setSupplierPayment({ supplierId: "", amount: "" });
      fetchSuppliers();
    } catch (error) { showToast("ගෙවීම අසාර්ථකයි!", "error"); }
  };

  // --- BILLING LOGIC ---
  // 🆕 MULTI-PRICE: භාණ්ඩයේ Active (තොග ඉතිරි ඇති) Price Batches ලබාගැනීමට Helper
  const getActivePriceBatches = (product) => {
    if (!Array.isArray(product.batches)) return [];
    return product.batches.filter((b) => parseFloat(b.stock) > 0);
  };

  // 🆕 MULTI-PRICE: Batch එකකට Default Label එකක් සකසාගැනීම (Admin විසින් Label එකක් නොදුන්නොත්)
  const getBatchDisplayLabel = (batch, index, total) => {
    if (batch.label) return batch.label;
    if (total <= 1) return "";
    if (index === 0) return "පැරණි මිල";
    if (index === total - 1) return "නව මිල";
    return `මිල ${index + 1}`;
  };

  // 🛠️ UPDATED (Multi-Price Popup): scannedBatch එකක් දුන්නොත් කෙලින්ම එම මිලෙන් Cart එකට එකතු කරයි,
  //     නැත්තම් Product එකට Price Batches කිහිපයක් තියෙනවනම් තෝරන්න Popup එක පෙන්වයි
  const addToCart = (product, selectedBatch = null) => {
    // 🆕 EXPIRY CHECK: කල් ඉකුත් වූ භාණ්ඩයක් විකිණීමට ඉඩ නොදේ
    const expiryStatus = getExpiryStatus(product);
    if (expiryStatus === "expired") {
      return showToast(`🚫 "${product.name}" කල් ඉකුත් වී ඇත! (${new Date(product.expiryDate).toLocaleDateString()}) - මෙය විකිණීමට ඉඩ නොදේ.`, "error");
    }
    if (expiryStatus === "expiring") {
      showToast(`⚠️ "${product.name}" ළඟදීම කල් ඉකුත් වේ (${new Date(product.expiryDate).toLocaleDateString()})! අවධානයෙන් විකුණන්න.`, "warning");
    }

    // 🆕 MULTI-PRICE CHECK: තෝරාගත් Batch එකක් තවම නැත්නම්, සහ Product එකට Active Batches 1කට වඩා තියෙනවනම් - Popup එක පෙන්වන්න
    const activeBatches = getActivePriceBatches(product);
    if (!selectedBatch && activeBatches.length > 1) {
      setMultiPricePopup(product);
      return;
    }

    // Batch එකක් තිබුනොත් (තෝරාගත්තෙකෝ, එකම එකක් තිබ්බෙකෝ), එහි මිල/තොගය use කරයි
    const activeBatch = selectedBatch || (activeBatches.length === 1 ? activeBatches[0] : null);
    const effectivePrice = activeBatch ? parseFloat(activeBatch.price) : parseFloat(product.price);
    const batchId = activeBatch ? activeBatch.batchId : null; // 🛠️ Backend schema එකේ batch identity string එක (Mongo _id එක නෙමෙයි)
    const batchIndex = activeBatch ? activeBatches.findIndex(b => b.batchId === batchId) : -1;
    const batchLabel = activeBatch ? getBatchDisplayLabel(activeBatch, batchIndex, activeBatches.length) : null;
    const batchCostPrice = activeBatch ? parseFloat(activeBatch.costPrice || product.costPrice || 0) : parseFloat(product.costPrice || 0);
    const batchMarketPrice = activeBatch ? parseFloat(activeBatch.marketPrice || product.marketPrice || effectivePrice) : parseFloat(product.marketPrice || product.price);
    // 🆕 මේ Batch එකටම ආවේණික වට්ටම % එක (batch.discount) - එය explicitly 0ට වඩා වැඩි විදිහට Set කරලා තියෙනවනම් විතරයි, Product-level Discount එක වෙනුවට මේකම භාවිතා කරයි
    // (Default Batch එකකට discount නොදුන්නොත් 0ම තියෙන නිසා, සාමාන්‍ය Products වල Product-level Discount එක බිඳ වැටෙන්නේ නැති වෙන්න මේ ආරක්ෂාව)
    const batchDiscount = activeBatch && parseFloat(activeBatch.discount) > 0
      ? parseFloat(activeBatch.discount)
      : parseFloat(product.discount || product.discountPercent || 0);
    // 🆕 Cart line එකේ Unique Identity එක - එකම Product එකට Batch දෙකක් cart එකේ වෙන වෙනම පේන්න ඕන නිසා
    const cartLineId = batchId ? `${product._id}__${batchId}` : product._id;

    const existingIndex = cart.findIndex((item) => item.cartLineId === cartLineId);
    if (existingIndex !== -1) {
      const newCart = [...cart];
      newCart[existingIndex].qty = parseFloat(newCart[existingIndex].qty) + 1;
      setCart(newCart);
    } else {
      setCart([...cart, {
        ...product,
        qty: 1,
        price: effectivePrice, // 🆕 තෝරාගත් Batch එකේ මිලෙන් Override කරයි
        costPrice: batchCostPrice, // 🆕 එම Batch එකේම Cost Price එකෙන් ලාභය ගණනය වෙන්න
        marketPrice: batchMarketPrice, // 🆕 එම Batch එකේම MRP එකෙන් Savings ගණනය වෙන්න
        discount: batchDiscount, // 🆕 එම Batch එකේම වට්ටමෙන් වාර්තා නිවැරදිව ගණනය වෙන්න
        discountPercent: batchDiscount, // 🛠️ discP ගණනය කරන කේතය item.discountPercent ප්‍රථමයෙන් බලන නිසා මෙතනත් set කරයි
        batchId,
        batchLabel,
        cartLineId
      }]);
    }
    showToast(`"${product.name}"${batchLabel ? ` (${batchLabel} - රු.${effectivePrice.toFixed(2)})` : ""} බිලට එකතු කලා`);
    setMultiPricePopup(null); // Popup එකෙන් තෝරාගත්තා නම් වහන්න
  };

  // Emergency Temp Item Add Logic (Does not hit DB, directly into Cart)
  const handleAddTempItemToCart = async (e) => {
    e.preventDefault();
    if (!tempItemForm.name || !tempItemForm.price || !tempItemForm.qty) {
      return showToast("කරුණාකර නම, මිල සහ ප්‍රමාණය ඇතුලත් කරන්න!", "warning");
    }

    const qty = parseFloat(tempItemForm.qty);
    const price = parseFloat(tempItemForm.price);

    // 🆕 "Database එකටත් Register කරන්න" checkbox එක check කරලා තියෙනවා නම්
    if (registerTempAsProduct) {
      // 🛠️ Duplicate Prevention: මේ නමින්ම Product එකක් Catalog එකේ දැනටමත් තියෙනවද බලයි
      const existingProduct = products.find(p => p.name.trim().toLowerCase() === tempItemForm.name.trim().toLowerCase());
      if (existingProduct) {
        setCart([...cart, {
          ...existingProduct,
          cartLineId: `real_${existingProduct._id}_${Date.now()}`,
          qty,
          discount: 0,
          discountPercent: 0,
          isTemporary: false
        }]);
        showToast(`ℹ️ "${existingProduct.name}" කියලා Product එකක් දැනටමත් Catalog එකේ තියෙනවා — ඒකම Bill එකට එකතු කලා (Duplicate නොවී).`, "warning");
        setTempItemForm({ name: "", price: "", qty: "1", unit: "Kg", barcode: "" });
        setRegisterTempAsProduct(false);
        return;
      }

      try {
        const registrationPayload = {
          name: tempItemForm.name,
          price,
          marketPrice: price,
          costPrice: price * 0.85, // 🛠️ Estimate එකක් - පස්සේ Admin > තොග කළමනාකරණය එකෙන් නිවැරදි කරගන්න
          stock: qty, // 🛠️ දැනට විකුණන ප්‍රමාණයම Initial Stock එක විදිහට register වේ (Sale එකෙන් පස්සේ 0 වේ)
          unit: tempItemForm.unit,
          category: "Other", // 🛠️ පස්සේ Admin ට නිවැරදි Category එකක් තෝරගන්න පුළුවන්
          minStockLevel: 5
        };
        // 🛠️ FIX: Barcode field එක blank නම් request එකෙන්ම අයින් කරයි (empty string "" එකක් යැව්වොත්,
        // barcode වල Unique Index එකක් තියෙනවා නම් Duplicate Key Error (E11000) එකක් සමඟ 500 error එකක් එනවා)
        if (tempItemForm.barcode && tempItemForm.barcode.trim() !== "") {
          registrationPayload.barcode = tempItemForm.barcode.trim();
        }

        const response = await axios.post(`${API_BASE_URL}/products/add`, registrationPayload);

        const newProduct = response.data.product;
        setCart([...cart, {
          ...newProduct,
          unit: tempItemForm.unit, // 🛠️ FIX: User තෝරගත්ත Unit එකම (Empty ඇතුලුව) force කරයි - Backend response එක trust නොකර
          cartLineId: `real_${newProduct._id}_${Date.now()}`,
          qty,
          discount: 0,
          discountPercent: 0,
          isTemporary: false
        }]);
        showToast(`✅ "${newProduct.name}" Database එකට Register වුනා සහ Bill එකටත් එකතු කලා! 🗄️`);
        setTempItemForm({ name: "", price: "", qty: "1", unit: "Kg", barcode: "" });
        setRegisterTempAsProduct(false);
        fetchProducts(); // 🛠️ Products list එකත් Refresh කරයි, අලුත් Product එක Billing Search එකෙන්ම හම්බවෙන්න
        return;
      } catch (error) {
        // 🛠️ Registration එක fail වුනත්, Sale එක නවත්තන්නේ නැතුව Temp Item එකක් විදිහටම Bill එකට එකතු කරයි
        console.error("Product registration failed:", error.response?.data || error.message);
        const backendMsg = error.response?.data?.message || error.response?.data?.error;
        showToast(`⚠️ Database Register කිරීම අසාර්ථක වුනා${backendMsg ? ` (${backendMsg})` : ""} - Bill එකට තාවකාලිකව එකතු කලා.`, "warning");
      }
    }

    const tempProduct = {
      // 🛠️ Unsaved අලුත් අයිටම් එකට Front-end එකෙන් හදන Dynamic ID එකක් ලබාදෙයි
      _id: `temp_${Date.now()}`, 
      name: `${tempItemForm.name}`,
      price,
      marketPrice: price,
      costPrice: price * 0.85, 
      stock: qty + 10, 
      barcode: tempItemForm.barcode || "N/A",
      discount: 0,
      discountPercent: 0,
      unit: tempItemForm.unit,
      qty,
      isTemporary: true,
      cartLineId: `temp_${Date.now()}` // 🛠️ Multi-Price cart line identity සමග ගැලපෙන්න
    };

    setCart([...cart, tempProduct]);
    showToast(`"${tempProduct.name}" තාවකාලිකව බිලට එකතු කලා! 📥`, "warning");
    setTempItemForm({ name: "", price: "", qty: "1", unit: "Kg", barcode: "" });
    setRegisterTempAsProduct(false);
  };

  // 🛠️ UPDATED (Multi-Price): _id වෙනුවට cartLineId එකෙන් match කරයි (එකම Product එකට Batch දෙකක් cart එකේ තිබ්බොත් හසුරුවගන්න)
  const updateCartQtyDirectly = (lineId, value) => {
    const newCart = cart.map((item) => {
      if (item.cartLineId === lineId) return { ...item, qty: value };
      return item;
    });
    setCart(newCart);
  };

  // 🆕 GRAM-MODE INPUT: User ග්‍රෑම් වලින් (500, 250 ආදී Whole Numbers) type කරයි - Storage එකට Kg බවට convert කරයි
  const updateCartQtyDirectlyInGrams = (lineId, gramsValue) => {
    const newCart = cart.map((item) => {
      if (item.cartLineId !== lineId) return item;
      if (gramsValue === "") return { ...item, qty: "" };
      const grams = parseFloat(gramsValue);
      return { ...item, qty: isNaN(grams) ? item.qty : grams / 1000 };
    });
    setCart(newCart);
  };

  // 🆕 Cart Line එකක Manual Quantity Input එක Kg / g Mode දෙකට Toggle කිරීම
  const toggleQtyInputUnit = (lineId, mode) => {
    setCart(cart.map((item) => (item.cartLineId === lineId ? { ...item, qtyInputUnit: mode } : item)));
  };

  const updateQty = (lineId, amount) => {
    const newCart = cart.map((item) => {
      if (item.cartLineId === lineId) {
        const newQty = roundQty(parseFloat(item.qty) + amount); // 🛠️ Repeated -100g/+100g clicks drift වළක්වයි
        return { ...item, qty: newQty < 0.001 ? 0.001 : newQty };
      }
      return item;
    });
    setCart(newCart);
  };

  const calculateTotal = () => cart.reduce((total, item) => {
    const discP = parseFloat(item.discountPercent || item.discount) || 0;
    const originalP = parseFloat(item.price);
    const discountAmount = (originalP * discP) / 100;
    const finalPrice = originalP - discountAmount;
    return total + (finalPrice * parseFloat(item.qty || 0));
  }, 0);

  const handleCheckoutAndPrint = async () => {
    if (cart.length === 0) return showToast("බිල හිස්ව පවතී!", "warning");
    
    const total = calculateTotal();
    const paid = paymentMethod === "Credit" 
      ? (amountPaid === "" ? 0 : parseFloat(amountPaid)) 
      : total;
      
    const receivedCash = parseFloat(cashReceived) || 0;

    // Stock Validation
    for (const item of cart) {
      if (item.isTemporary) continue; 
      const dbProduct = products.find(p => p._id === item._id);
      // 🛠️ UPDATED (Multi-Price): batchId එකක් තෝරලා තියෙනවනම්, ඒ Batch එකේම ඉතිරි තොගය පරීක්ෂා කරයි
      let availableStock = dbProduct ? dbProduct.stock : 0;
      if (item.batchId && dbProduct && Array.isArray(dbProduct.batches)) {
        const dbBatch = dbProduct.batches.find(b => b.batchId === item.batchId);
        availableStock = dbBatch ? parseFloat(dbBatch.stock) : 0;
      }
      if (parseFloat(item.qty) > availableStock) {
        return showToast(`🚫 තොග නොමැත! "${item.name}"${item.batchLabel ? ` (${item.batchLabel})` : ""} තොගයේ ඇත්තේ: ${formatQtyWithUnit(availableStock, item.unit ?? 'Kg')}`, "error");
      }
    }

    if (paymentMethod === "Credit" && parseFloat(amountPaid) > total) {
      return showToast(`⚠️ Paid Amount එක මුළු එකතුවට වඩා වැඩි විය නොහැක.`, "error");
    }

    if (paymentMethod === "Cash" && receivedCash < total) {
      return showToast(`💵 ලැබුණු මුදල බිල්පත් එකතුවට වඩා අඩු විය නොහැක.`, "error");
    }

    if (paid < total && !selectedCustomer) {
      return showToast("හිඟ මුදලක් පවතී! කරුණාකර පාරිභෝගිකයෙකු සම්බන්ධ කරන්න. 👤", "warning");
    }

    // Backend එකට සහ Offline DB එකට යැවීමට සකස් කරගත් Cart Object එක
    const preparedCartItems = cart.map(item => {
      const discP = parseFloat(item.discountPercent || item.discount) || 0;
      return {
        ...item,
        _id: item.isTemporary ? null : item._id,
        batchId: item.batchId || null, // 🆕 Multi-Price: තෝරාගත් Batch එකෙන්ම තොගය අඩුවෙන්න server එකට යවයි
        discount: (parseFloat(item.price) * discP) / 100 
      };
    });

    const checkoutData = {
      cartItems: preparedCartItems,
      cashierName: user.username,
      paymentMethod: paymentMethod,
      customerId: selectedCustomer ? selectedCustomer._id : null,
      cashReceived: paymentMethod === "Cash" ? receivedCash : 0,
      balanceAmount: paymentMethod === "Cash" ? balanceAmount : 0,
      amountPaid: paid, 
      amountDue: total - paid 
    };

    try {
      // 🌐 ONLINE: සර්වර් එකට දත්ත යැවීමට උත්සාහ කරයි
      const checkoutResponse = await axios.post(`${API_BASE_URL}/products/checkout`, checkoutData);

      // 🆕 සර්වරයෙන් ආපු Professional Invoice Number එක Receipt එකේ Print කරන්න Save කරගන්නවා
      // 🛠️ flushSync භාවිතා කරන්නේ React State එක Print කරන්න කලින්ම DOM එකට Force කරලා update කරන්න -
      //     නැත්නම් window.print() එක State update එක DOM එකට එන්න කලින් Run වෙලා "N/A" පෙන්නයි!
      flushSync(() => {
        setLastInvoiceNo(checkoutResponse.data.invoiceNo || null);
        setLastSaleIsOffline(false);
      });

      window.print();
      resetBillingUI();
      showToast("ඉන්වොයිසිය සාර්ථකව මුද්‍රණය කලා! 🖨️✨");
      fetchProducts();
      fetchCustomers();
      // 🛠️ FIX: Checkout එකට පස්සේ Sales Summary එකත් Refresh කරයි - Unregistered Items tab, Sales Logs,
      // සහ Revenue/Profit stats වගේ දේවල් Page Refresh එකක් නැතුවම Instantly අලුත් වෙනවා
      if (user.role === "admin") fetchSalesSummary();

    } catch (error) {
      // 📴 OFFLINE: ඉන්ටර්නෙට් නැතිනම් බිල බ්‍රවුසර් එකේ සේව් කරයි
      if (!navigator.onLine || error.message === "Network Error") {
        try {
          await db.offlineSales.add({
            ...checkoutData,
            createdAt: new Date().toISOString(),
            status: "pending"
          });

          // 🆕 Offline බිලකට තාවකාලික Reference එකක් පමණි - Sync වුනාට පස්සේ විතරක් සැබෑ Invoice Number එකක් ලැබෙන්නේ
          flushSync(() => {
            setLastInvoiceNo(`OFFLINE-${Date.now()}`);
            setLastSaleIsOffline(true);
          });

          window.print(); 
          resetBillingUI();
          showToast("⚠️ ඉන්ටර්නෙට් නොමැත! බිල ආරක්ෂිතව බ්‍රවුසර් එකේ සේව් කලා. 📴", "warning");
          
        } catch (dbError) {
          showToast("Local Database එකට සේව් කිරීම අසාර්ථකයි!", "error");
        }
      } else {
        showToast("Checkout අසාර්ථකයි!", "error");
      }
    }
  };

  // UI එක Reset කරන Helper Function එක (handleCheckoutAndPrint එකට යටින් දාන්න)
  const resetBillingUI = () => {
    setCart([]);
    setSelectedCustomer(null);
    setSearchPhone("");
    setCustomerSuggestions([]);
    setShowCustomerDropdown(false);
    setHighlightedCustomerIndex(-1);
    setCashReceived("");
    setAmountPaid(""); 
    setBalanceAmount(0);
    setPaymentMethod("Cash");
    setShowTender(false);
    setCatalogSearch("");
  };

  const handleVoidSale = async (saleId) => {
    const confirmed = await askConfirm({
      title: "බිල්පත අවලංගු කිරීම",
      message: "මෙම බිල්පත අවලංගු කිරීමට අවශ්‍යද?",
      tone: "danger",
      confirmLabel: "අවලංගු කරන්න",
      cancelLabel: "නවත්වන්න",
    });
    if (!confirmed) return;
    try {
      await axios.post(`${API_BASE_URL}/products/void-sale/${saleId}`);
      showToast("බිල්පත සාර්ථකව අවලංගු කලා!");
      fetchProducts();
      fetchSalesSummary();
      fetchCustomers();
    } catch (error) { showToast("අසාර්ථකයි!", "error"); }
  };

  // 🆕 සියලුම විකුණුම් ඉතිහාසය (Sales Logs) Permanently Clear කිරීම
  // ⚠️ Destructive action එකක් නිසා Type-to-Confirm guard එකක් - "DELETE" type කරලා confirm කරන්න ඕන
  const handleClearAllSales = async () => {
    const confirmed = await askConfirm({
      title: "Clear Sales History!",
      message: `මෙයින් විකුණුම් ඉතිහාසය (${salesSummary.sales?.length || 0} Records) සම්පූර්ණයෙන්ම, ආපහු ලබාගත නොහැකි ලෙස Delete වේ!`,
      tone: "danger",
      confirmLabel: "සියල්ල මකන්න",
      requireText: "DELETE",
    });
    if (!confirmed) return;
    try {
      const response = await axios.delete(`${API_BASE_URL}/products/sales/clear-all`);
      showToast(response.data.message || "විකුණුම් ඉතිහාසය Clear කලා! 🧹");
      fetchSalesSummary();
    } catch (error) { showToast("Clear කිරීම අසාර්ථකයි!", "error"); }
  };

  // --- RETURN / REFUND / EXCHANGE LOGIC ---

  // Invoice අංකයෙන් පැරණි බිල සොයාගැනීම
  const handleSearchInvoiceForReturn = async (e, idOverride) => {
    if (e && e.preventDefault) e.preventDefault();
    // 🛠️ idOverride එකක් දුන්නොත් (Sales Report එකේ "🔄 Return" Button එකෙන් වගේ), ඒක Priority ගන්නවා -
    //     setReturnInvoiceSearch() කරලා ක්ෂණිකවම Search කිරීමේදී React state stale වීමේ ගැටලුව මගහරවා ගන්න
    const rawId = idOverride ?? returnInvoiceSearch;
    if (!rawId || !rawId.trim()) return showToast("කරුණාකර බිල්පත් අංකය ඇතුලත් කරන්න!", "warning");
    setReturnLoading(true);
    try {
      // 🛠️ FIX: "#" සලකුණ URL එකේ "Fragment" (Anchor) සලකුණක් විදිහට සලකන නිසා,
      //          # ට පස්සේ තියෙන කොටස Server එකට යවන්නවත් කලින් Browser එකෙන්ම කපා දානවා!
      //          ඒ නිසා Request එක යවන්න කලින්ම # ඉවත් කරලා, encodeURIComponent කරලා Safe කරගන්නවා.
      const cleanId = rawId.trim().replace(/^#/, "");
      const response = await axios.get(`${API_BASE_URL}/products/invoice/${encodeURIComponent(cleanId)}`);
      setReturnSaleData(response.data);
      setReturnSelections({});
      showToast("බිල්පත සාර්ථකව හමු විය! 🧾");
    } catch (error) {
      setReturnSaleData(null);
      showToast(error.response?.data?.message || "මෙම බිල්පත් අංකය සොයාගත නොහැක!", "error");
    } finally {
      setReturnLoading(false);
    }
  };

  // Return කරන Item එකක Qty/Reason වෙනස් කිරීම
  const handleReturnSelectionChange = (itemId, field, value) => {
    setReturnSelections((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], [field]: value }
    }));
  };

  // තෝරාගත් items වලින් Refund වන මුළු මුදල ගණනය කිරීම
  const calculateReturnTotal = () => {
    if (!returnSaleData) return 0;
    return returnSaleData.items.reduce((sum, item) => {
      const sel = returnSelections[item._id];
      const qty = parseFloat(sel?.qty) || 0;
      const available = item.qty - (item.returnedQty || 0);
      const safeQty = Math.min(qty, available);
      return sum + (safeQty * item.price);
    }, 0);
  };

  // Exchange Cart එකට අලුත් භාණ්ඩයක් එකතු කිරීම
  const addToExchangeCart = (product) => {
    const existingIndex = exchangeCart.findIndex((item) => item._id === product._id);
    if (existingIndex !== -1) {
      const newCart = [...exchangeCart];
      newCart[existingIndex].qty = parseFloat(newCart[existingIndex].qty) + 1;
      setExchangeCart(newCart);
    } else {
      setExchangeCart([...exchangeCart, { ...product, qty: 1 }]);
    }
  };

  const removeFromExchangeCart = (id) => setExchangeCart(exchangeCart.filter((c) => c._id !== id));

  const calculateExchangeCartTotal = () => exchangeCart.reduce((sum, item) => {
    const discP = parseFloat(item.discountPercent || item.discount) || 0;
    const finalPrice = item.price - (item.price * discP) / 100;
    return sum + (finalPrice * parseFloat(item.qty || 0));
  }, 0);

  const resetReturnUI = () => {
    setReturnInvoiceSearch("");
    setReturnSaleData(null);
    setReturnSelections({});
    setRefundMethod("Cash");
    setIsExchangeMode(false);
    setExchangeCart([]);
    setExchangeCashReceived("");
    setExchangePaymentMethod("Cash");
  };

  // Return/Refund එක Server එකට යැවීම
  const handleProcessReturn = async () => {
    if (!returnSaleData) return;

    const itemsToReturn = returnSaleData.items
      .filter((item) => returnSelections[item._id]?.qty && parseFloat(returnSelections[item._id].qty) > 0)
      .map((item) => ({
        itemId: item._id,
        returnQty: parseFloat(returnSelections[item._id].qty),
        reason: returnSelections[item._id].reason || "සඳහන් කර නැත"
      }));

    if (itemsToReturn.length === 0) return showToast("කරුණාකර Return කරන භාණ්ඩ ප්‍රමාණයක් ඇතුලත් කරන්න!", "warning");

    try {
      const response = await axios.post(`${API_BASE_URL}/products/return`, {
        saleId: returnSaleData._id,
        cashierName: user.username,
        refundMethod,
        items: itemsToReturn
      });
      showToast(response.data.message || "Return එක සාර්ථකයි! ✅");
      resetReturnUI();
      fetchProducts();
      fetchCustomers();
      if (user.role === "admin") { fetchSalesSummary(); fetchReturnHistory(); }
    } catch (error) {
      showToast(error.response?.data?.message || "Return එක අසාර්ථකයි!", "error");
    }
  };

  // Exchange එක Server එකට යැවීම (Return + අලුත් Sale එකවර)
  const handleProcessExchange = async () => {
    if (!returnSaleData) return;
    if (exchangeCart.length === 0) return showToast("Exchange කරන අලුත් භාණ්ඩ තෝරන්න!", "warning");

    const returnItems = returnSaleData.items
      .filter((item) => returnSelections[item._id]?.qty && parseFloat(returnSelections[item._id].qty) > 0)
      .map((item) => ({
        itemId: item._id,
        returnQty: parseFloat(returnSelections[item._id].qty),
        reason: returnSelections[item._id].reason || "Exchange"
      }));

    if (returnItems.length === 0) return showToast("කරුණාකර Return කරන පරණ භාණ්ඩ ප්‍රමාණයක් ඇතුලත් කරන්න!", "warning");

    try {
      const response = await axios.post(`${API_BASE_URL}/products/exchange`, {
        saleId: returnSaleData._id,
        cashierName: user.username,
        refundMethod,
        returnItems,
        newItems: exchangeCart.map((item) => ({
          _id: item.isTemporary ? null : item._id,
          name: item.name,
          price: item.price,
          marketPrice: item.marketPrice,
          costPrice: item.costPrice,
          qty: item.qty,
          discount: item.discount
        })),
        extraPaymentMethod: exchangePaymentMethod,
        extraCashReceived: parseFloat(exchangeCashReceived) || 0
      });

      const diff = response.data.exchangeDifference;
      if (diff > 0) {
        showToast(`Exchange සාර්ථකයි! පාරිභෝගිකයා තව රු.${diff.toFixed(2)} ගෙවිය යුතුයි. ✅`);
      } else if (diff < 0) {
        showToast(`Exchange සාර්ථකයි! පාරිභෝගිකයාට රු.${Math.abs(diff).toFixed(2)} ආපසු දෙන්න. ✅`);
      } else {
        showToast("Exchange එක සාර්ථකව සම්පූර්ණ කලා! ✅");
      }
      resetReturnUI();
      fetchProducts();
      fetchCustomers();
      if (user.role === "admin") { fetchSalesSummary(); fetchReturnHistory(); }
    } catch (error) {
      showToast(error.response?.data?.message || "Exchange එක අසාර්ථකයි!", "error");
    }
  };

  // --- LOGIN LOGIC ---
  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const response = await axios.post(`${API_BASE_URL}/users/login`, loginForm);
      if (response.data.success) {
        setUser(response.data.user);
        
        // 🛠️ UPDATED: සාර්ථකව ලොගින් වූ පසු බ්‍රවුසර් මෙමරියේ සේව් කරයි
        localStorage.setItem("pos_user", JSON.stringify(response.data.user));

        if (response.data.user.role === "cashier") setActiveTab("billing");
        setTimeout(() => showToast(`සුභ දවසක් ${response.data.user.username}! 👋`), 300);
      }
    } catch (error) { setLoginError(error.response?.data?.message || "Error"); }
  };

  // --- PRODUCT CRUD LOGIC ---
  const handleFormSubmit = async (e) => {
    e.preventDefault();

    // 🆕 MULTI-PRICE SAFETY CHECK: Main "Price" field එක කෙලින්ම වෙනස් කරලා, පරණ මිලේ ඉතුරු තොගයක් තියෙද්දී, 🔄 Button එකෙන් Multi-Price flow එකට නොගොස් Submit කරන්න හදනවනම් - අන්තිම වතාවක් Confirm කරගන්නවා
    if (
      isEditing && editingOriginalProduct &&
      parseFloat(productForm.price) !== parseFloat(editingOriginalProduct.price) &&
      parseFloat(editingOriginalProduct.stock) > 0 &&
      !showNewPriceEntry &&
      !(productForm.batches || []).some(b => parseFloat(b.price) === parseFloat(editingOriginalProduct.price) && parseFloat(b.stock) > 0)
    ) {
      const proceed = await askConfirm({
        title: "මිල වෙනස් කිරීම තහවුරු කරන්න",
        message: `ඔයා මිල රු.${parseFloat(editingOriginalProduct.price).toFixed(2)} ඉඳන් රු.${parseFloat(productForm.price).toFixed(2)} බවට වෙනස් කරනවා. පරණ මිලේ ඉතුරු තොගය (${editingOriginalProduct.stock}ක්) සම්පූර්ණයෙන්ම මැකිලා අලුත් මිලින්ම replace වේවි (Popup එකක් නැතුව). පරණ තොගයත් වෙනම විකුණන්න ඕන නම් "Cancel" කරලා 🔄 "නව මිලකට Stock ලැබුනාද?" Button එක Use කරන්න.`,
        tone: "warning",
        confirmLabel: "ඔව්, Replace කරන්න",
        cancelLabel: "Cancel",
      });
      if (!proceed) return;
    }

    const submissionData = {
      name: productForm.name,
      marketPrice: parseFloat(productForm.marketPrice) || 0,
      price: parseFloat(productForm.price) || 0,
      costPrice: parseFloat(productForm.costPrice) || 0,
      stock: parseFloat(productForm.stock) || 0,
      barcode: productForm.barcode,
      discount: parseFloat(productForm.discountPercent) || 0,
      unit: productForm.unit,
      category: productForm.category,
      minStockLevel: parseFloat(productForm.minStockLevel) || 5,
      preferredSupplierId: productForm.preferredSupplierId || null,
      expiryDate: productForm.expiryDate || null, // 🆕 EXPIRY DATE
      batches: (productForm.batches || []).map((b, index) => ({
        // 🛠️ Backend Schema එකේ Batch Identity එක "batchId" (String) - Mongo _id එකෙන් වෙනස්. අලුත් batch එකකට generate කරයි, පරණ එකකට එකම batchId එකම යවයි (Edit කරද්දී Identity නොනැසී පවතින්න)
        batchId: b.batchId || `B-${Date.now()}-${index}`,
        label: b.label || "",
        price: parseFloat(b.price) || 0,
        costPrice: parseFloat(b.costPrice) || parseFloat(productForm.costPrice) || 0,
        marketPrice: parseFloat(b.marketPrice) || parseFloat(productForm.marketPrice) || 0,
        discount: parseFloat(b.discount) || 0, // 🆕 මේ Batch එකටම ආවේණික වට්ටම % - ලාභ වාර්තා නිවැරදිව ගණනය වෙන්න
        stock: parseFloat(b.stock) || 0,
        expiryDate: b.expiryDate || null
      })) // 🆕 MULTI-PRICE: Old/New Price Batches (Backend Product Schema එකේ "batches" array එකට ගැලපෙන ආකාරයට)
    };
    try {
      if (isEditing) {
        await axios.put(`${API_BASE_URL}/products/update/${editId}`, submissionData);
        setIsEditing(false);
        setEditId(null);
        showToast("භාණ්ඩයේ විස්තර සාර්ථකව යාවත්කාලීන කලා! 🔄");
      } else {
        await axios.post(`${API_BASE_URL}/products/add`, submissionData);
        showToast("අලුත් භාණ්ඩය සාර්ථකව ඩේටාබේස් එකට එකතු කලා! ✅");
      }
      setProductForm({ name: "", marketPrice: "", price: "", costPrice: "", stock: "", barcode: "", discountPercent: "", unit: "Kg", category: "Grocery", minStockLevel: "5", preferredSupplierId: "", expiryDate: "", batches: [] });
      setEditingOriginalProduct(null);
      setShowNewPriceEntry(false);
      setNewPriceEntry({ price: "", qty: "", costPrice: "", discount: "" });
      fetchProducts();
      fetchExpiringProducts();
    } catch (error) { showToast("ක්‍රියාවලිය අසාර්ථකයි!", "error"); }
  };

  const handleEditClick = (product) => {
    setIsEditing(true);
    setEditId(product._id);
    setEditingOriginalProduct(product); // 🆕 MULTI-PRICE: DB එකේ තියෙන Original අගයන් මතක තියාගැනීම
    setProductForm({
      name: product.name.replace("⚠️ ", "").replace(" (Unsaved)", ""),
      marketPrice: product.marketPrice || "",
      price: product.price,
      costPrice: product.costPrice || "",
      stock: product.stock,
      barcode: product.barcode || "",
      discountPercent: product.discount || "", 
      unit: product.unit ?? "Kg",
      category: product.category || "Grocery",
      minStockLevel: product.minStockLevel ?? 5,
      preferredSupplierId: product.preferredSupplierId || "",
      expiryDate: product.expiryDate ? new Date(product.expiryDate).toISOString().split("T")[0] : "", // 🆕
      batches: Array.isArray(product.batches) ? product.batches : [] // 🆕 MULTI-PRICE
    });
    setShowNewPriceEntry(false);
    setNewPriceEntry({ price: "", qty: "", costPrice: "", discount: "" });
  };

  // 🆕 MULTI-PRICE (Simplified): "අලුතින් Stock ලැබුනා, මිලත් වෙනස්" කියන එකම action එකෙන් Batches Auto-සාදයි.
  //     Admin ට "Batch" කියන වචනයවත් දැනගන්න ඕන නෑ - "නව මිල" + "ලැබුණු ප්‍රමාණය" විතරයි දාන්න ඕන.
  const handleAddNewPricePoint = () => {
    if (!newPriceEntry.price || parseFloat(newPriceEntry.price) <= 0) {
      return showToast("නිවැරදි නව මිලක් ඇතුලත් කරන්න!", "warning");
    }
    if (newPriceEntry.qty === "" || parseFloat(newPriceEntry.qty) <= 0) {
      return showToast("අලුතින් ලැබුණු ප්‍රමාණය ඇතුලත් කරන්න!", "warning");
    }

    let existingBatches = productForm.batches || [];

    // 🆕 මේ Product එකට මේකයි පළමු වතාවට Multi-Price එකක් වෙන්නේ නම්, දැනට තියෙන (Database එකේ) මිල/තොගය/Cost/Discount "පැරණි මිල" Batch එකක් විදිහට ස්වයංක්‍රීයව සාදයි
    if (existingBatches.length === 0 && editingOriginalProduct) {
      const currentStock = parseFloat(editingOriginalProduct.stock) || 0;
      if (currentStock > 0) {
        existingBatches = [{
          batchId: `B-old-${editingOriginalProduct._id}`,
          label: "පැරණි මිල",
          price: parseFloat(editingOriginalProduct.price) || 0,
          costPrice: parseFloat(editingOriginalProduct.costPrice) || 0,
          marketPrice: parseFloat(editingOriginalProduct.marketPrice) || 0,
          discount: parseFloat(editingOriginalProduct.discount) || 0, // 🆕 පරණ Batch එකේම පරණ Discount එකත් රඳවාගනී
          stock: currentStock
        }];
      }
    }

    const newBatch = {
      batchId: `B-new-${Date.now()}`,
      label: "නව මිල",
      price: parseFloat(newPriceEntry.price),
      costPrice: parseFloat(newPriceEntry.costPrice) || 0, // 🆕 මේ Batch එකටම ආවේණික Cost Price එක - ලාභය හරියටම ගණනය වෙන්න
      marketPrice: parseFloat(productForm.marketPrice) || 0,
      discount: parseFloat(newPriceEntry.discount) || 0, // 🆕 මේ Batch එකටම ආවේණික වට්ටම %
      stock: parseFloat(newPriceEntry.qty)
    };

    const updatedBatches = [...existingBatches, newBatch];
    const newTotalStock = updatedBatches.reduce((sum, b) => sum + (parseFloat(b.stock) || 0), 0);

    setProductForm({
      ...productForm,
      batches: updatedBatches,
      price: parseFloat(newPriceEntry.price), // 🆕 නවතම මිලම, ප්‍රධාන "අපේ මිල" විදිහට update වේ
      costPrice: parseFloat(newPriceEntry.costPrice) || productForm.costPrice, // 🆕 නවතම Cost Price එකත් Main field එකට පෙන්නයි
      discountPercent: newPriceEntry.discount || productForm.discountPercent, // 🆕 නවතම Discount එකත් Main field එකට පෙන්නයි
      stock: String(newTotalStock) // 🆕 පැරණි + නව මුළු එකතුවට Auto-Sync
    });
    setNewPriceEntry({ price: "", qty: "", costPrice: "", discount: "" });
    setShowNewPriceEntry(false);
    showToast("✅ නව මිල එකතු කලා! පහළින් 'ඩේටාබේස් එකට එකතු කරන්න' click කර Save කරන්න.", "success");
  };

  // 🆕 MULTI-PRICE: වැරදුනොත් හෝ අවශ්‍ය නැති Batch එකක් නිවැරදි කරගැනීමට
  const handleRemoveBatch = (index) => {
    const updatedBatches = productForm.batches.filter((_, i) => i !== index);
    const newTotalStock = updatedBatches.reduce((sum, b) => sum + (parseFloat(b.stock) || 0), 0);
    setProductForm({
      ...productForm,
      batches: updatedBatches,
      stock: updatedBatches.length > 0 ? String(newTotalStock) : productForm.stock
    });
  };

  const handleDeleteClick = async (id) => {
    const confirmed = await askConfirm({
      title: "භාණ්ඩය මකන්න",
      message: "මෙම භාණ්ඩය මකා දැමීමට අවශ්‍ය බව විශ්වාසද?",
      tone: "danger",
      confirmLabel: "මකන්න",
    });
    if (!confirmed) return;
    try {
      await axios.delete(`${API_BASE_URL}/products/delete/${id}`);
      showToast("භාණ්ඩය සාර්ථකව මකා දැමුවා.");
      fetchProducts();
    } catch (error) { showToast("මකා දැමීම අසාර්ථකයි!", "error"); }
  };

 const filteredBillingProducts = products
    .filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(billingSearch.toLowerCase()) || 
        (p.barcode && p.barcode.includes(billingSearch));
      const matchesCategory = billingCategoryFilter === "All" || (p.category || "Grocery") === billingCategoryFilter;
      return matchesSearch && matchesCategory;
    })
    .sort((a, b) => {
      const search = billingSearch.toLowerCase();
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();

      const aStarts = aName.startsWith(search);
      const bStarts = bName.startsWith(search);

      // search text එකෙන්ම පටන් ගන්න ඒවා මුලට
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;

      // දෙකම starts වුණොත් හෝ දෙකම නොවුණොත්, alphabetical order එකට
      return aName.localeCompare(bName);
    });

  // 🛠️ NEW: Category tab එක් එකකට කීයක් products තියෙනවද කියලා ගණන් කිරීම (badge count සඳහා)
  const billingCategoryCounts = products.reduce((counts, p) => {
    const cat = p.category || "Grocery";
    counts[cat] = (counts[cat] || 0) + 1;
    return counts;
  }, {});

  /* ═══════════════════════════════════════════════════════════
     BILLING SCREEN — derived values and keyboard control
     (state + refs declared near the top of the component, above)
     ═══════════════════════════════════════════════════════════ */

  // Totals, split so the footer can show what the discounts saved
  const billSubtotal = cart.reduce(
    (sum, i) => sum + (parseFloat(i.price) || 0) * (parseFloat(i.qty) || 0), 0
  );
  const billDiscount = billSubtotal - calculateTotal();

  // The catalog grid filters on its own field, not on the scan bar
  const catalogProducts = products
    .filter(p => {
      const q = catalogSearch.trim().toLowerCase();
      const matchesSearch = !q || p.name.toLowerCase().includes(q) || (p.barcode && p.barcode.includes(q));
      const matchesCategory = billingCategoryFilter === "All" || (p.category || "Grocery") === billingCategoryFilter;
      return matchesSearch && matchesCategory;
    })
    .sort((a, b) => {
      const q = catalogSearch.trim().toLowerCase();
      const aStarts = a.name.toLowerCase().startsWith(q);
      const bStarts = b.name.toLowerCase().startsWith(q);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });

  // 🛠️ FIX: scan bar now shows a dropdown of ALL matches (filteredBillingProducts), not just one.
  // Arrow keys move the highlight, Enter picks the highlighted row (or falls back to barcode / best match).
  const handleBillingSearchKeyDown = (e) => {
    const matches = filteredBillingProducts;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (matches.length === 0) return;
      setBillingHighlightIndex((i) => (i + 1) % matches.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (matches.length === 0) return;
      setBillingHighlightIndex((i) => (i <= 0 ? matches.length - 1 : i - 1));
      return;
    }
    if (e.key === "Escape") {
      setBillingHighlightIndex(-1);
      return; // let the existing global Escape handler still run
    }
    if (e.key !== "Enter") return;

    const q = billingSearch.trim();
    if (!q) return;

    const byBarcode = products.find(p => p.barcode && p.barcode === q);
    // Prefer whatever row is currently highlighted in the dropdown; otherwise fall back
    // to the best (first) match from the SAME sorted/filtered list the dropdown shows,
    // so what the cashier sees and what Enter adds are always the same item.
    const highlighted = billingHighlightIndex >= 0 ? matches[billingHighlightIndex] : null;
    const hit = byBarcode || highlighted || matches[0];

    if (hit) {
      addToCart(hit);
      setBillingSearch("");
      setBillingHighlightIndex(-1);
    } else {
      setTempItemForm(prev => ({ ...prev, barcode: q }));
      showToast(`⚠️ "${q}" පද්ධතියේ නැත! තාවකාලිකව ඇතුලත් කරන්න.`, "warning");
    }
  };

  // Keep the newest line in view as the bill grows
  useEffect(() => {
    if (cartScrollRef.current) cartScrollRef.current.scrollTop = cartScrollRef.current.scrollHeight;
  }, [cart.length]);

  // Online / offline indicator in the top rail
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // The whole till without a mouse
  useEffect(() => {
    if (!user || activeTab !== "billing") return;

    const onKey = (e) => {
      if (e.key === "F2") {
        e.preventDefault();
        billingSearchRef.current?.focus();
        billingSearchRef.current?.select();
      } else if (e.key === "F4") {
        e.preventDefault();
        setShowTempItemModal(true);
      } else if (e.key === "F8") {
        e.preventDefault();
        setCatalogOpen(o => !o);
      } else if (e.key === "F12") {
        e.preventDefault();
        if (showTender) handleCheckoutAndPrint();
        else if (cart.length > 0) setShowTender(true);
      } else if (e.key === "Escape") {
        if (showTender) setShowTender(false);
        else if (!showTempItemModal && !multiPricePopup) billingSearchRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [user, activeTab, showTender, showTempItemModal, multiPricePopup, cart, paymentMethod, cashReceived, amountPaid, selectedCustomer]);

  // Land on the scan bar whenever the cashier comes back to billing
  useEffect(() => {
    if (activeTab === "billing" && !showTender) {
      const t = setTimeout(() => billingSearchRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [activeTab, showTender]);

  const filteredAdminProducts = products.filter(p => 
    p.name.toLowerCase().includes(adminProductSearch.toLowerCase()) || 
    (p.barcode && p.barcode.includes(adminProductSearch))
  );

  // 🛠️ NEW (Step 3 - Low Stock Reorder Alert): අවම තොග මට්ටමට වඩා අඩු Products ලැයිස්තුව
  const lowStockProducts = products.filter(p => p.stock <= (p.minStockLevel ?? 5));
  const activeCustomerDetails = viewCustomerDetails ? customers.find(c => c._id === viewCustomerDetails) : null;

  // 🛠️ NEW: Low stock products, Preferred Supplier එක අනුව group කිරීම (Purchase Order Suggestion සඳහා)
  const lowStockGroupedBySupplier = lowStockProducts.reduce((groups, p) => {
    const key = p.preferredSupplierId || "unassigned";
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
    return groups;
  }, {});

  // 🛠️ NEW: Product එකකට Suggested Reorder Quantity එක ගණනය කිරීම (අවම මට්ටමෙන් දෙගුණයකට ළඟා වෙන්න ඕන ප්‍රමාණය)
  const getSuggestedReorderQty = (p) => {
    const min = p.minStockLevel ?? 5;
    const suggestion = (min * 2) - p.stock;
    return suggestion > 0 ? suggestion : min;
  };

  // 🆕 UNREGISTERED ITEMS: Emergency Add හරහා Database එකට Register නොකර විකුණපු items,
  // Sale History එකෙන් (productId නැති items) නම අනුව Group කර, Catalog එකේ දැනටමත් නැති ඒවා විතරක් පෙන්වයි
  const unregisteredItemGroups = (() => {
    const groups = {};
    (salesSummary.sales || []).forEach((sale) => {
      if (sale.status === "Voided") return;
      (sale.items || []).forEach((item) => {
        if (item.productId) return; // දැනටමත් Real Product එකකට Link වෙලා තියෙනවා
        const key = (item.name || "").trim();
        if (!key) return;
        if (!groups[key]) {
          groups[key] = { name: key, totalQty: 0, totalRevenue: 0, occurrences: 0, lastSoldAt: sale.createdAt };
        }
        groups[key].totalQty += parseFloat(item.qty) || 0;
        groups[key].totalRevenue += (parseFloat(item.price) || 0) * (parseFloat(item.qty) || 0);
        groups[key].occurrences += 1;
        if (new Date(sale.createdAt) > new Date(groups[key].lastSoldAt)) groups[key].lastSoldAt = sale.createdAt;
      });
    });

    return Object.values(groups)
      .map((g) => ({ ...g, avgPrice: g.totalQty > 0 ? g.totalRevenue / g.totalQty : 0 }))
      // 🛠️ Owner කවුරු හරි මෙයාට කලින්ම Product එකක් විදිහට Register කරලා තියෙනවා නම්, list එකෙන් auto-remove වේ
      .filter((g) => !products.some((p) => p.name.trim().toLowerCase() === g.name.toLowerCase()))
      // 🆕 Manually "Delete" කරපු items ටිකත් list එකෙන් අයින් කරයි
      .filter((g) => !dismissedUnregisteredItems.includes(g.name.toLowerCase()))
      .sort((a, b) => b.occurrences - a.occurrences);
  })();

  // 🆕 Unregistered Item Group එකක් Manually Delete කිරීම (Product එකක් විදිහට Register නොකර, list එකෙන් විතරක් ඉවත් කිරීම)
  const handleDismissUnregisteredItem = (name) => {
    const updated = [...dismissedUnregisteredItems, name.toLowerCase()];
    setDismissedUnregisteredItems(updated);
    localStorage.setItem("smartstore_dismissed_unregistered_items", JSON.stringify(updated));
    showToast(`"${name}" ලැයිස්තුවෙන් ඉවත් කලා 🗑️`);
  };

  // 🆕 Unregistered Items ලැයිස්තුවේ දැනට පෙන්වන ඒවා ඔක්කොම එකවර ඉවත් කිරීම
  const handleClearAllUnregisteredItems = async () => {
    if (unregisteredItemGroups.length === 0) return;
    const confirmed = await askConfirm({
      title: "ලැයිස්තුව සම්පූර්ණයෙන් ඉවත් කිරීම",
      message: `Unregistered Items ලැයිස්තුවේ ඇති ${unregisteredItemGroups.length} items ම ඉවත් කිරීමට අවශ්‍යද? (මේකෙන් Sale History එකට කිසිම බලපෑමක් නැත - මේ Review List එකෙන් විතරයි ඉවත් වන්නේ)`,
      tone: "warning",
      confirmLabel: "ඉවත් කරන්න",
    });
    if (!confirmed) return;
    const namesToAdd = unregisteredItemGroups.map((g) => g.name.toLowerCase());
    const updated = [...new Set([...dismissedUnregisteredItems, ...namesToAdd])];
    setDismissedUnregisteredItems(updated);
    localStorage.setItem("smartstore_dismissed_unregistered_items", JSON.stringify(updated));
    showToast("Unregistered Items ලැයිස්තුව සම්පූර්ණයෙන් Clear කලා! 🧹");
  };

  // 🆕 Unregistered Item Group එකක්, Add Product Form එකට Pre-fill කර Register කිරීමට
  const handleRegisterUnregisteredItem = (group) => {
    setIsEditing(false);
    setEditId(null);
    setProductForm({
      name: group.name,
      marketPrice: group.avgPrice.toFixed(2),
      price: group.avgPrice.toFixed(2),
      costPrice: (group.avgPrice * 0.85).toFixed(2),
      stock: "0",
      barcode: "",
      discountPercent: "",
      unit: "Kg",
      category: "Other",
      minStockLevel: "5",
      preferredSupplierId: "",
      expiryDate: "",
      batches: []
    });
    setAdminSubTab("products");
    showToast(`"${group.name}" විස්තර Form එකට පිරෙව්වා — කරුණාකර සම්පූර්ණ කර Save කරන්න! ✍️`, "warning");
  };

  // 🆕 EXPIRY HELPERS
  const getExpiryStatus = (product) => {
    if (!product.expiryDate) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const expiry = new Date(product.expiryDate); expiry.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return "expired";
    if (diffDays <= 7) return "expiring";
    return "ok";
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen bg-ink font-sans antialiased px-4">
        <div className="w-full max-w-90">
          <div className="flex items-center gap-2.5 mb-6">
            <div className="w-9 h-9 rounded-lg bg-accent grid place-items-center text-[18px] font-800 text-white">S</div>
            <div>
              <h1 className="text-[19px] font-700 text-white tracking-tight leading-none">SmartStore</h1>
              <p className="text-[12px] text-white/45 mt-1">Sign in to open the till</p>
            </div>
          </div>

          <form onSubmit={handleLogin} className="bg-card rounded-2xl border border-line p-5 space-y-2.5">
            <input
              type="text" placeholder="Username" required autoFocus
              value={loginForm.username}
              onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
              className="w-full h-11 px-3.5 rounded-xl bg-sunken border border-line focus:border-accent focus:bg-card focus:outline-none text-[14px] font-500 transition-colors"
            />
            <input
              type="password" placeholder="Password" required
              value={loginForm.password}
              onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
              className="w-full h-11 px-3.5 rounded-xl bg-sunken border border-line focus:border-accent focus:bg-card focus:outline-none text-[14px] font-500 transition-colors"
            />
            {loginError && (
              <p className="text-[12px] font-600 text-crimson bg-crimson-soft border border-crimson/20 rounded-lg px-3 py-2">{loginError}</p>
            )}
            <button type="submit" className="w-full h-11 rounded-xl bg-accent hover:bg-accent-hi text-white text-[14px] font-700 transition-colors">
              Sign in
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-paper font-sans antialiased text-body relative">
      
      {/* CUSTOM TOAST CONTAINER WINDOW */}
      <div className="fixed top-4 right-4 z-50 space-y-2 pointer-events-none print:hidden max-w-sm w-full">
        {toasts.map((toast) => (
          <div key={toast.id} className={`fade px-4 py-2.5 rounded-xl shadow-lg border flex items-center gap-3 text-[13px] font-600 text-white transition-all ${
            toast.type === "error" ? "bg-crimson border-crimson" :
            toast.type === "warning" ? "bg-gold border-gold" :
            "bg-ink border-ink"
          }`}>
            <span>{toast.type === "error" ? "🛑" : toast.type === "warning" ? "⚠️" : "✨"}</span>
            <div className="flex-1">{toast.message}</div>
          </div>
        ))}
      </div>

      {/* 🆕 MODERN CONFIRM / PROMPT DIALOG (replaces native window.confirm / window.prompt) */}
      {dialogRequest && (
        <div
          className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm print:hidden"
          onClick={() => resolveDialog(false)}
        >
          <div
            className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-[fadeIn_0.15s_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className={`px-5 py-4 flex items-start gap-3 ${
                dialogRequest.tone === "danger"
                  ? "bg-linear-to-r from-red-600 to-rose-600"
                  : dialogRequest.tone === "warning"
                  ? "bg-linear-to-r from-amber-500 to-orange-500"
                  : "bg-linear-to-r from-slate-800 to-slate-900"
              }`}
            >
              <div className="w-9 h-9 shrink-0 rounded-full bg-white/15 flex items-center justify-center text-lg">
                {dialogRequest.tone === "danger" ? "🗑️" : dialogRequest.tone === "warning" ? "⚠️" : "❓"}
              </div>
              <div className="pt-0.5">
                <h3 className="text-sm font-black text-white leading-tight">{dialogRequest.title}</h3>
              </div>
            </div>

            {/* Body */}
            <div className="px-5 py-4">
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{dialogRequest.message}</p>

              {dialogRequest.requireText && (
                <div className="mt-4">
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                    තහවුරු කිරීමට "{dialogRequest.requireText}" ලෙස ටයිප් කරන්න
                  </label>
                  <input
                    type="text"
                    autoFocus
                    value={dialogTypedText}
                    onChange={(e) => setDialogTypedText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && dialogTypedText === dialogRequest.requireText) {
                        resolveDialog(true);
                      }
                    }}
                    placeholder={dialogRequest.requireText}
                    className="w-full px-3 py-2 rounded-lg border-2 border-slate-300 focus:border-red-500 focus:outline-none text-sm font-mono tracking-wider"
                  />
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="px-5 pb-5 flex gap-2 justify-end">
              <button
                onClick={() => resolveDialog(false)}
                className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
              >
                {dialogRequest.cancelLabel}
              </button>
              <button
                onClick={() => resolveDialog(true)}
                disabled={dialogRequest.requireText ? dialogTypedText !== dialogRequest.requireText : false}
                className={`px-4 py-2 rounded-lg text-sm font-black text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  dialogRequest.tone === "danger"
                    ? "bg-red-600 hover:bg-red-700"
                    : dialogRequest.tone === "warning"
                    ? "bg-amber-500 hover:bg-amber-600 text-slate-900"
                    : "bg-slate-900 hover:bg-slate-800"
                }`}
              >
                {dialogRequest.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ PRICE PICKER — which price is printed on the pack ══════════ */}
      {multiPricePopup && (
        <div className="fixed inset-0 z-50 fade print:hidden">
          <div className="absolute inset-0 bg-ink/65 backdrop-blur-[2px]" onClick={() => setMultiPricePopup(null)}></div>
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="rise w-full max-w-105 bg-card rounded-2xl border border-line shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="px-5 py-3 border-b border-hairline flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[15px] font-700 text-body">Which price is printed on the pack?</h3>
                  <p className="text-[12.5px] text-muted mt-0.5 truncate">{multiPricePopup.name}</p>
                </div>
                <button onClick={() => setMultiPricePopup(null)} className="h-8 px-3 shrink-0 rounded-lg text-[12.5px] font-600 text-muted hover:bg-sunken transition-colors">Esc</button>
              </div>

              <div className="p-3 space-y-1.5">
                {(() => {
                  const activeBatches = getActivePriceBatches(multiPricePopup);
                  return activeBatches.map((batch, index) => (
                    <button
                      key={batch.batchId || index}
                      onClick={() => addToCart(multiPricePopup, batch)}
                      className="w-full flex items-center justify-between px-3.5 py-3 rounded-xl border border-line hover:border-accent hover:bg-accent-soft transition-colors text-left"
                    >
                      <div>
                        <div className="text-[11px] font-700 text-faint">
                          {getBatchDisplayLabel(batch, index, activeBatches.length) || `Option ${String.fromCharCode(65 + index)}`}
                        </div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="tnum text-[19px] font-800 text-accent">රු {parseFloat(batch.price).toFixed(2)}</span>
                          {parseFloat(batch.discount) > 0 && (
                            <span className="text-[10px] font-700 text-crimson bg-crimson-soft px-1.5 py-px rounded">−{batch.discount}%</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] font-600 text-faint">In stock</div>
                        <div className="tnum text-[13px] font-700 text-body">{formatQtyWithUnit(batch.stock, multiPricePopup.unit ?? "Kg")}</div>
                      </div>
                    </button>
                  ));
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ QUICK ITEM — sell something that isn't in the catalog yet ══════════ */}
      {showTempItemModal && (
        <div className="fixed inset-0 z-50 fade print:hidden">
          <div className="absolute inset-0 bg-ink/65 backdrop-blur-[2px]" onClick={() => setShowTempItemModal(false)}></div>
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <form
              onSubmit={(e) => { handleAddTempItemToCart(e); setShowTempItemModal(false); }}
              onClick={(e) => e.stopPropagation()}
              className="rise w-full max-w-115 bg-card rounded-2xl border border-line shadow-2xl overflow-hidden"
            >
              <div className="px-5 py-3 border-b border-hairline flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-[15px] font-700 text-body">Quick item</h3>
                  <p className="text-[12px] text-muted mt-0.5">Sell something that isn't in the catalog yet</p>
                </div>
                <button type="button" onClick={() => { setShowTempItemModal(false); setRegisterTempAsProduct(false); }} className="h-8 px-3 shrink-0 rounded-lg text-[12.5px] font-600 text-muted hover:bg-sunken transition-colors">Esc</button>
              </div>

              <div className="p-4 space-y-2.5">
                <input
                  autoFocus
                  type="text"
                  placeholder="Item name · භාණ්ඩයේ නම"
                  value={tempItemForm.name}
                  onChange={(e) => setTempItemForm({ ...tempItemForm, name: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-sunken border border-line focus:border-accent focus:bg-card focus:outline-none text-[14px] font-500 transition-colors"
                />
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="number"
                    placeholder="Price"
                    value={tempItemForm.price}
                    onChange={(e) => setTempItemForm({ ...tempItemForm, price: e.target.value })}
                    className="h-11 px-3 rounded-xl bg-sunken border border-line focus:border-accent focus:bg-card focus:outline-none tnum text-[14px] font-700 transition-colors"
                  />
                  <input
                    type="number"
                    step="0.001"
                    placeholder="Qty"
                    value={tempItemForm.qty}
                    onChange={(e) => setTempItemForm({ ...tempItemForm, qty: e.target.value })}
                    className="h-11 px-3 rounded-xl bg-sunken border border-line focus:border-accent focus:bg-card focus:outline-none tnum text-[14px] font-700 transition-colors"
                  />
                  <select
                    value={tempItemForm.unit}
                    onChange={(e) => setTempItemForm({ ...tempItemForm, unit: e.target.value })}
                    className="h-11 px-2.5 rounded-xl bg-sunken border border-line focus:border-accent focus:outline-none text-[13.5px] font-600 text-body transition-colors"
                  >
                    <option value="">No unit</option>
                    <option value="Kg">Kg</option>
                    <option value="G">Gram</option>
                    <option value="Pieces">Pieces</option>
                    <option value="Packet">Packet</option>
                    <option value="Bottle">Bottle</option>
                  </select>
                </div>
                <input
                  type="text"
                  placeholder="Barcode (optional)"
                  value={tempItemForm.barcode}
                  onChange={(e) => setTempItemForm({ ...tempItemForm, barcode: e.target.value })}
                  className="w-full h-11 px-3.5 rounded-xl bg-sunken border border-line focus:border-accent focus:bg-card focus:outline-none tnum text-[13.5px] font-500 transition-colors"
                />

                <label className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-line cursor-pointer hover:bg-sunken transition-colors">
                  <input
                    type="checkbox"
                    checked={registerTempAsProduct}
                    onChange={(e) => setRegisterTempAsProduct(e.target.checked)}
                    className="w-4 h-4 accent-accent"
                  />
                  <span className="text-[12.5px] font-600 text-body">Also save it to the catalog</span>
                </label>
              </div>

              <div className="px-4 pb-4">
                <button type="submit" className="w-full h-11 rounded-xl bg-accent hover:bg-accent-hi text-white text-[14px] font-700 transition-colors">
                  Add to bill
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ══════════ TENDER PANEL — where the design gets loud, because this is where errors cost money ══════════ */}
      {showTender && activeTab === "billing" && (() => {
        const total = calculateTotal();
        const received = parseFloat(cashReceived) || 0;
        const diff = received - total;
        const paidNow = amountPaid === "" ? 0 : (parseFloat(amountPaid) || 0);
        const onAccount = Math.max(0, total - paidNow);

        const blocked =
          paymentMethod === "Cash" ? (cashReceived === "" || diff < -0.004)
            : paymentMethod === "Credit" ? !selectedCustomer
              : false;

        const short = paymentMethod === "Cash" && cashReceived !== "" && diff < -0.004;

        return (
          <div className="fixed inset-0 z-50 fade print:hidden">
            <div className="absolute inset-0 bg-ink/65 backdrop-blur-[2px]" onClick={() => setShowTender(false)}></div>

            <div className="absolute inset-0 flex items-center justify-center p-4">
              <div className="rise w-full max-w-215 bg-card rounded-2xl border border-line shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>

                <div className="bg-ink text-white px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-[11.5px] font-600 text-white/45 tracking-wide">AMOUNT DUE · ගෙවිය යුතු මුදල</p>
                    <p className="tnum text-[28px] leading-tight font-800">රු {total.toFixed(2)}</p>
                  </div>
                  <button onClick={() => setShowTender(false)} className="h-8 px-3 rounded-lg text-[12.5px] font-600 text-white/55 hover:text-white hover:bg-white/10 transition-colors">Esc</button>
                </div>

                <div className="p-4 grid grid-cols-[1fr_300px] gap-4">

                  {/* left: method + entry */}
                  <div className="min-w-0 space-y-3">
                    <div className="grid grid-cols-4 gap-1.5">
                      {[
                        { k: "Cash", si: "මුදල්" },
                        { k: "Card", si: "කාඩ්පත" },
                        { k: "QR", si: "QR" },
                        { k: "Credit", si: "ණය" },
                      ].map((m) => (
                        <button
                          key={m.k}
                          onClick={() => setPaymentMethod(m.k)}
                          className={`h-14 rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 transition-colors ${paymentMethod === m.k ? "bg-accent border-accent text-white" : "bg-card border-line text-muted hover:border-muted hover:text-body"}`}
                        >
                          <span className="text-[13.5px] font-700">{m.k}</span>
                          <span className={`text-[10.5px] font-500 ${paymentMethod === m.k ? "text-white/65" : "text-faint"}`}>{m.si}</span>
                        </button>
                      ))}
                    </div>

                    {paymentMethod === "Cash" && (
                      <div className="space-y-2.5">
                        <div>
                          <label className="block text-[11.5px] font-700 text-muted mb-1.5">Cash received · ලැබුණු මුදල</label>
                          <div className="relative">
                            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] font-600 text-faint">රු</span>
                            <input
                              autoFocus
                              type="number"
                              inputMode="decimal"
                              placeholder="0.00"
                              value={cashReceived}
                              onChange={(e) => setCashReceived(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter" && !blocked) handleCheckoutAndPrint(); }}
                              className="w-full h-14 pl-11 pr-3 rounded-xl bg-sunken border-2 border-line focus:border-accent focus:bg-card focus:outline-none tnum text-[26px] font-800 text-body transition-colors"
                            />
                          </div>
                        </div>

                        {/* Note chips coloured like real LKR notes — colour reads faster than digits */}
                        <div className="grid grid-cols-6 gap-1.5">
                          {[
                            { v: 50, bg: "#1E6FA8" },
                            { v: 100, bg: "#B4532A" },
                            { v: 500, bg: "#6B4A9C" },
                            { v: 1000, bg: "#2F7A46" },
                            { v: 5000, bg: "#A07219" },
                          ].map((n) => (
                            <button
                              key={n.v}
                              onClick={() => setCashReceived(String((parseFloat(cashReceived) || 0) + n.v))}
                              style={{ background: n.bg }}
                              className="h-11 rounded-lg text-white text-[12.5px] font-700 tnum hover:brightness-112 active:scale-95 transition-all"
                            >
                              {n.v.toLocaleString()}
                            </button>
                          ))}
                          <button
                            onClick={() => setCashReceived(total.toFixed(2))}
                            className="h-11 rounded-lg border-2 border-line text-[11.5px] font-700 text-muted hover:border-accent hover:text-accent transition-colors"
                          >
                            Exact
                          </button>
                        </div>
                      </div>
                    )}

                    {(paymentMethod === "Card" || paymentMethod === "QR") && (
                      <div className="rounded-xl border border-line bg-sunken px-4 py-6 text-center">
                        <p className="text-[13.5px] font-600 text-body">Charge the full amount on the terminal</p>
                        <p className="text-[12px] text-muted mt-1">සම්පූර්ණ මුදල පර්යන්තය හරහා අය කරන්න</p>
                      </div>
                    )}

                    {paymentMethod === "Credit" && (
                      <div className="space-y-2.5">
                        <div className="relative">
                          <label className="block text-[11.5px] font-700 text-muted mb-1.5">Customer account · ගිණුම</label>
                          <input
                            type="text"
                            autoComplete="off"
                            placeholder="Name or phone number · නම හෝ දුරකථන අංකය"
                            value={searchPhone}
                            onChange={(e) => setSearchPhone(e.target.value)}
                            onKeyDown={handleCustomerSearchKeyDown}
                            className="w-full h-11 px-3.5 rounded-xl bg-sunken border border-line focus:border-accent focus:bg-card focus:outline-none text-[14px] font-500 transition-colors"
                          />
                          {customerSearchLoading && <span className="absolute right-3 top-9 text-[11px] text-faint">searching…</span>}

                          {showCustomerDropdown && customerSuggestions.length > 0 && (
                            <ul className="absolute z-20 w-full mt-1 bg-card border border-line rounded-xl shadow-lg max-h-48 overflow-y-auto scroll overflow-hidden">
                              {customerSuggestions.map((customer, index) => (
                                <li
                                  key={customer._id}
                                  onClick={() => handleSelectCustomer(customer)}
                                  onMouseEnter={() => setHighlightedCustomerIndex(index)}
                                  className={`px-3.5 py-2.5 cursor-pointer border-b border-hairline last:border-b-0 transition-colors ${index === highlightedCustomerIndex ? "bg-accent-soft" : "hover:bg-sunken"}`}
                                >
                                  <p className="text-[12.5px] font-600 text-body">{customer.name}</p>
                                  <p className="tnum text-[11px] text-faint">{customer.phone}</p>
                                </li>
                              ))}
                            </ul>
                          )}

                          {showCustomerDropdown && customerSuggestions.length === 0 && !customerSearchLoading && (
                            <div className="absolute z-20 w-full mt-1 bg-card border border-line rounded-xl shadow-lg px-3.5 py-2.5 text-[12px] text-muted">
                              No account found — add the customer from Admin first
                            </div>
                          )}
                        </div>

                        {selectedCustomer && (
                          <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-accent bg-accent-soft">
                            <span className="text-[12.5px] font-700 text-body">{selectedCustomer.name}</span>
                            <span className="tnum text-[11.5px] font-700 text-crimson">owes රු {parseFloat(selectedCustomer.creditBalance || 0).toFixed(2)}</span>
                          </div>
                        )}

                        <div>
                          <label className="block text-[11.5px] font-700 text-muted mb-1.5">Paying now · දැන් ගෙවන මුදල <span className="font-500 text-faint">(optional)</span></label>
                          <input
                            type="number"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={amountPaid}
                            onChange={(e) => setAmountPaid(e.target.value)}
                            className="w-full h-11 px-3.5 rounded-xl bg-sunken border border-line focus:border-accent focus:bg-card focus:outline-none tnum text-[16px] font-700 transition-colors"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* right: the readout the cashier actually looks at */}
                  <div className="flex flex-col">
                    <div className={`flex-1 rounded-xl px-4 py-4 flex flex-col justify-center text-white ${short ? "bg-crimson" : "bg-ink2"}`}>
                      <p className="text-[11.5px] font-700 text-white/40 tracking-wide">
                        {paymentMethod === "Cash"
                          ? (short ? "STILL SHORT · තව ගෙවිය යුතුයි" : "CHANGE DUE · ඉතිරි මුදල")
                          : paymentMethod === "Credit" ? "GOES ON ACCOUNT · ණයට"
                            : "CHARGE ON TERMINAL · පර්යන්තයෙන්"}
                      </p>
                      <p className="mt-1.5 flex items-baseline gap-1.5">
                        <span className="text-[16px] font-600 text-white/55">රු</span>
                        <span className="tnum text-[42px] leading-none font-800">
                          {paymentMethod === "Cash"
                            ? (cashReceived === "" ? "0.00" : Math.abs(diff).toFixed(2))
                            : paymentMethod === "Credit" ? onAccount.toFixed(2)
                              : total.toFixed(2)}
                        </span>
                      </p>
                      <p className="mt-2.5 text-[12px] font-500 text-white/45">
                        {paymentMethod === "Cash"
                          ? (cashReceived === "" ? "Enter the cash you were handed"
                            : short ? "Not enough to cover the bill"
                              : diff < 0.005 ? "Hand back nothing — exact amount"
                                : `Hand back රු ${diff.toFixed(2)}`)
                          : paymentMethod === "Credit"
                            ? (selectedCustomer
                              ? `${selectedCustomer.name} · new balance රු ${(parseFloat(selectedCustomer.creditBalance || 0) + onAccount).toFixed(2)}`
                              : "Choose a customer account first")
                            : "Confirm the terminal approved it before printing"}
                      </p>
                    </div>

                    <button
                      onClick={handleCheckoutAndPrint}
                      disabled={blocked}
                      className="mt-2.5 h-15 rounded-xl bg-accent hover:bg-accent-hi disabled:opacity-35 disabled:cursor-not-allowed text-white flex flex-col items-center justify-center transition-colors"
                    >
                      <span className="text-[16px] font-800 tracking-tight">Complete &amp; print</span>
                      <span className="text-[11px] font-600 text-white/70">F12</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="print:hidden flex flex-col h-full min-h-0 overflow-hidden">
        {/* Header */}
        <header className="h-11 shrink-0 bg-ink text-white flex items-center gap-1 px-3 select-none">
          <div className="flex items-center gap-2 pr-3 mr-1">
            <div className="w-6 h-6 rounded-md bg-accent grid place-items-center text-[13px] font-800">S</div>
            <span className="text-[15px] font-700 tracking-tight">SmartStore</span>
          </div>

          <nav className="flex items-center gap-0.5">
            <button onClick={() => setActiveTab("billing")} className={`h-7 px-3 rounded-md text-[13px] transition-colors ${activeTab === "billing" ? "bg-ink3 text-white font-600" : "font-500 text-white/55 hover:text-white hover:bg-white/8"}`}>Billing</button>
            <button onClick={() => { setActiveTab("returns"); resetReturnUI(); }} className={`h-7 px-3 rounded-md text-[13px] transition-colors ${activeTab === "returns" ? "bg-ink3 text-white font-600" : "font-500 text-white/55 hover:text-white hover:bg-white/8"}`}>Returns</button>
            {user.role === "admin" && (
              <button onClick={() => setActiveTab("admin")} className={`h-7 px-3 rounded-md text-[13px] transition-colors ${activeTab === "admin" ? "bg-ink3 text-white font-600" : "font-500 text-white/55 hover:text-white hover:bg-white/8"}`}>Admin</button>
            )}
          </nav>

          <div className="flex-1"></div>

          <div className="flex items-center gap-3 text-[12px]">
            <span className="flex items-center gap-1.5 text-white/60">
              <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-accent-hi" : "bg-gold"}`}></span>
              {isOnline ? "Online" : "Offline"}
            </span>
            <span className="text-white/25">|</span>
            <span className="text-white/80 font-500">{user.username}</span>
            <button
              onClick={() => { localStorage.removeItem("pos_user"); setUser(null); }}
              className="h-7 px-2.5 rounded-md text-[12px] font-600 text-white/55 hover:text-white hover:bg-crimson transition-colors"
            >
              Sign out
            </button>
          </div>
        </header>

        {/* Main Content */}
        <div className="flex flex-1 overflow-hidden">
          {activeTab === "billing" && (
            <div className="flex w-full h-full min-h-0 gap-2 p-2">

              {/* ═══════════ THE BILL — primary surface ═══════════ */}
              <section className="flex-1 min-w-0 min-h-0 flex flex-col bg-card rounded-xl border border-line overflow-hidden">

                {/* Scan bar: the cashier's home key */}
                <div className="shrink-0 h-13 px-2.5 flex items-center gap-2 border-b border-hairline">
                  <div className="relative flex-1 min-w-0">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>
                    <input
                      ref={billingSearchRef}
                      type="text"
                      autoComplete="off"
                      spellCheck="false"
                      value={billingSearch}
                      onChange={(e) => { setBillingSearch(e.target.value); setBillingHighlightIndex(-1); }}
                      onKeyDown={handleBillingSearchKeyDown}
                      onBlur={() => setTimeout(() => setBillingHighlightIndex(-1), 150)}
                      placeholder="Scan barcode, or type an item name  ·  බාර්කෝඩ් හෝ නම"
                      className="w-full h-9.5 pl-9.5 pr-16 rounded-lg bg-sunken border border-line text-[14px] font-500 placeholder:text-faint placeholder:font-400 focus:bg-card focus:border-accent focus:outline-none transition-colors"
                    />
                    <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-700 text-faint bg-card border border-line rounded px-1.5 py-0.5">F2</kbd>

                    {/* 🛠️ FIX: live suggestions dropdown — this is what was missing.
                        Previously the scan bar only acted on Enter and silently grabbed
                        a single .find() match; now every matching product is listed here. */}
                    {billingSearch.trim() !== "" && filteredBillingProducts.length > 0 && (
                      <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-72 overflow-y-auto scroll bg-card border border-line rounded-lg shadow-lg">
                        {filteredBillingProducts.slice(0, 8).map((p, i) => (
                          <button
                            key={p._id}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()} // keep focus in the input so typing continues to work
                            onClick={() => { addToCart(p); setBillingSearch(""); setBillingHighlightIndex(-1); billingSearchRef.current?.focus(); }}
                            className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-[13px] border-b border-hairline last:border-b-0 transition-colors ${
                              i === billingHighlightIndex ? "bg-accent-soft" : "hover:bg-sunken"
                            }`}
                          >
                            <span className="min-w-0 truncate font-600 text-body">{p.name}</span>
                            <span className="shrink-0 tnum text-[12px] font-700 text-accent">රු {Number(p.price).toFixed(2)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <button onClick={() => setShowTempItemModal(true)} className="h-9.5 px-3 rounded-lg border border-line text-[12.5px] font-600 text-gold bg-gold-soft hover:brightness-97 transition-all flex items-center gap-1.5 shrink-0">
                    Quick item <kbd className="text-[10px] opacity-60 font-700">F4</kbd>
                  </button>

                  <button
                    onClick={() => { setCart([]); showToast("බිල හිස් කලා"); }}
                    disabled={cart.length === 0}
                    className="h-9.5 px-3 rounded-lg border border-line text-[12.5px] font-600 text-muted hover:text-crimson hover:border-crimson hover:bg-crimson-soft disabled:opacity-35 disabled:pointer-events-none transition-all shrink-0"
                  >
                    Clear
                  </button>
                </div>

                {/* Column headers — encode the row grid */}
                <div className="shrink-0 grid grid-cols-[30px_minmax(0,1fr)_216px_112px_30px] gap-2 px-2.5 h-7 items-center border-b border-hairline bg-sunken/60 text-[10.5px] font-700 text-faint tracking-wide">
                  <div>#</div>
                  <div>Item</div>
                  <div className="text-center">Quantity</div>
                  <div className="text-right">Amount</div>
                  <div></div>
                </div>

                {/* Bill lines — 46px rows */}
                <div ref={cartScrollRef} className="flex-1 min-h-0 overflow-y-auto scroll">
                  {cart.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center gap-1 text-center px-6">
                      <svg className="w-9 h-9 text-line mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 6h18l-1.6 9.4a2 2 0 0 1-2 1.6H7.6a2 2 0 0 1-2-1.6L4 6Z" /><circle cx="9" cy="20" r="1.3" /><circle cx="17" cy="20" r="1.3" /></svg>
                      <p className="text-[13.5px] font-600 text-muted">Scan an item to start the bill</p>
                      <p className="text-[12px] text-faint">බිල ආරම්භ කිරීමට භාණ්ඩයක් ස්කෑන් කරන්න</p>
                    </div>
                  ) : (
                    cart.map((item, ix) => {
                      const discP = parseFloat(item.discountPercent || item.discount) || 0;
                      const originalP = parseFloat(item.price);
                      const finalP = originalP - (originalP * discP) / 100;
                      const isKg = (item.unit ?? "Kg") === "Kg";
                      const isGramMode = isKg && item.qtyInputUnit === "g";
                      const displayQty = isGramMode
                        ? (item.qty === "" ? "" : Math.round(parseFloat(item.qty || 0) * 1000))
                        : item.qty;

                      return (
                        <div key={item.cartLineId || item._id} className="grid grid-cols-[30px_minmax(0,1fr)_216px_112px_30px] gap-2 px-2.5 h-11.5 items-center border-b border-hairline hover:bg-sunken/70 transition-colors group">
                          <div className="tnum text-[12px] font-600 text-faint">{ix + 1}</div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[13.5px] font-600 text-body truncate">{item.name}</span>
                              {item.isTemporary && <span className="shrink-0 text-[9.5px] font-700 text-gold bg-gold-soft px-1.5 py-px rounded">QUICK</span>}
                              {item.batchLabel && <span className="shrink-0 text-[9.5px] font-700 text-plum bg-plum-soft px-1.5 py-px rounded">{item.batchLabel}</span>}
                              {discP > 0 && <span className="shrink-0 text-[9.5px] font-700 text-crimson bg-crimson-soft px-1.5 py-px rounded">−{discP}%</span>}
                            </div>
                            <div className="tnum text-[11px] text-faint truncate">රු {finalP.toFixed(2)} / {item.unit ?? "Kg"}</div>
                          </div>

                          <div className="flex items-center justify-center gap-0.5">
                            <button onClick={() => updateQty(item.cartLineId, isKg ? -0.1 : -1)} className="w-7 h-7 rounded-md border border-line bg-card text-muted hover:text-body hover:border-muted text-[13px] font-700 transition-colors">−</button>
                            <input
                              type="number"
                              step={isGramMode ? "1" : "0.001"}
                              value={displayQty}
                              onChange={(e) => isGramMode
                                ? updateCartQtyDirectlyInGrams(item.cartLineId, e.target.value)
                                : updateCartQtyDirectly(item.cartLineId, e.target.value)}
                              className="w-15.5 h-7 text-center rounded-md border border-line bg-card tnum text-[13px] font-700 text-body focus:border-accent focus:outline-none transition-colors"
                            />
                            {isKg ? (
                              <div className="flex rounded-md overflow-hidden border border-line shrink-0">
                                <button type="button" onClick={() => toggleQtyInputUnit(item.cartLineId, "Kg")} className={`px-1.5 h-7 text-[10px] font-700 transition-colors ${!isGramMode ? "bg-accent text-white" : "bg-card text-faint hover:text-body"}`}>kg</button>
                                <button type="button" onClick={() => toggleQtyInputUnit(item.cartLineId, "g")} className={`px-1.5 h-7 text-[10px] font-700 transition-colors ${isGramMode ? "bg-accent text-white" : "bg-card text-faint hover:text-body"}`}>g</button>
                              </div>
                            ) : (
                              <span className="w-10 text-[10.5px] font-600 text-faint text-center truncate">{item.unit ?? ""}</span>
                            )}
                            <button onClick={() => updateQty(item.cartLineId, isKg ? 0.1 : 1)} className="w-7 h-7 rounded-md border border-line bg-card text-muted hover:text-body hover:border-muted text-[13px] font-700 transition-colors">+</button>
                          </div>

                          <div className="tnum text-right text-[14.5px] font-700 text-body">
                            {(finalP * parseFloat(item.qty || 0)).toFixed(2)}
                          </div>

                          <button
                            onClick={() => { setCart(cart.filter(c => c.cartLineId !== item.cartLineId)); showToast("භාණ්ඩය ඉවත් කලා"); }}
                            className="w-7 h-7 rounded-md text-faint opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-crimson hover:bg-crimson-soft grid place-items-center transition-all"
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 6l12 12M18 6 6 18" /></svg>
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* ═══ TOTALS — 128px. Payment now lives in the tender panel ═══ */}
                <div className="shrink-0 border-t border-line bg-sunken">
                  <div className="px-3 pt-2 pb-2.5 flex items-end gap-4">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between text-[12.5px]">
                        <span className="text-muted">{cart.length} lines · {(+cart.reduce((s, i) => s + (parseFloat(i.qty) || 0), 0).toFixed(3))} units</span>
                        <span className="tnum font-500 text-body">{billSubtotal.toFixed(2)}</span>
                      </div>
                      {billDiscount > 0.004 && (
                        <div className="flex items-center justify-between text-[12.5px]">
                          <span className="text-muted">Item discounts</span>
                          <span className="tnum font-600 text-crimson">−{billDiscount.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="h-px bg-line my-1.5"></div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-[12.5px] font-700 text-muted tracking-wide">TOTAL</span>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[14px] font-600 text-muted">රු</span>
                          <span className="tnum text-[30px] leading-none font-800 text-accent">{calculateTotal().toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => cart.length && setShowTender(true)}
                      disabled={cart.length === 0}
                      className="h-18.5 w-55 shrink-0 rounded-xl bg-accent hover:bg-accent-hi disabled:opacity-35 disabled:cursor-not-allowed text-white flex flex-col items-center justify-center gap-0.5 transition-colors shadow-sm"
                    >
                      <span className="text-[17px] font-800 tracking-tight">Take payment</span>
                      <span className="text-[11.5px] font-600 text-white/70">මුදල් ගෙවීම · F12</span>
                    </button>
                  </div>
                </div>
              </section>

              {/* ═══════════ CATALOG — secondary, collapses to nothing ═══════════ */}
              {catalogOpen ? (
                <aside className="w-101 shrink-0 min-h-0 flex flex-col bg-card rounded-xl border border-line overflow-hidden">
                  <div className="shrink-0 h-13 px-2.5 flex items-center gap-2 border-b border-hairline">
                    <button onClick={() => setCatalogOpen(false)} title="Hide catalog (F8)" className="w-8 h-8 shrink-0 rounded-lg border border-line text-muted hover:text-body hover:bg-sunken grid place-items-center transition-colors">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="m9 6 6 6-6 6" /></svg>
                    </button>
                    <input
                      type="text"
                      value={catalogSearch}
                      onChange={(e) => setCatalogSearch(e.target.value)}
                      placeholder="Filter catalog"
                      autoComplete="off"
                      className="flex-1 min-w-0 h-9 px-3 rounded-lg bg-sunken border border-line text-[13px] font-500 placeholder:text-faint placeholder:font-400 focus:bg-card focus:border-accent focus:outline-none transition-colors"
                    />
                  </div>

                  <div className="flex-1 min-h-0 flex">
                    {/* Category rail */}
                    <div className="w-18.5 shrink-0 border-r border-hairline overflow-y-auto scroll py-1.5 px-1.5 space-y-1">
                      <button
                        onClick={() => setBillingCategoryFilter("All")}
                        className={`w-full py-2 rounded-lg border flex flex-col items-center gap-0.5 transition-colors ${billingCategoryFilter === "All" ? "bg-accent border-accent text-white" : "bg-card border-line text-muted hover:border-muted hover:text-body"}`}
                      >
                        <span className="text-[15px] leading-none">🗂️</span>
                        <span className="text-[10px] font-600 leading-tight">සියල්ල</span>
                        <span className={`tnum text-[9.5px] font-700 ${billingCategoryFilter === "All" ? "text-white/60" : "text-faint"}`}>{products.length}</span>
                      </button>

                      {PRODUCT_CATEGORIES.map((cat) => (
                        <button
                          key={cat.value}
                          onClick={() => setBillingCategoryFilter(cat.value)}
                          className={`w-full py-2 rounded-lg border flex flex-col items-center gap-0.5 transition-colors ${billingCategoryFilter === cat.value ? "bg-accent border-accent text-white" : "bg-card border-line text-muted hover:border-muted hover:text-body"}`}
                        >
                          <span className="text-[15px] leading-none">{cat.icon}</span>
                          <span className="text-[10px] font-600 leading-tight truncate w-full px-0.5">{cat.value}</span>
                          <span className={`tnum text-[9.5px] font-700 ${billingCategoryFilter === cat.value ? "text-white/60" : "text-faint"}`}>{billingCategoryCounts[cat.value] || 0}</span>
                        </button>
                      ))}
                    </div>

                    {/* Tiles */}
                    {/* Tiles: fixed MINIMUM size (150×84px) via auto-fill + minmax — the standard
                        pattern for POS/retail card grids (Square, Toast, etc. all use this shape).
                        Tiles never shrink below 150px and never stretch out of proportion — but
                        unlike a flat fixed-px grid, leftover row width is shared evenly instead of
                        left as a dead gap on the right edge. More items just add scrollable rows. */}
                    <div className="flex-1 min-w-0 overflow-y-auto scroll p-1.5 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] auto-rows-[84px] gap-1.5 content-start">
                      {catalogProducts.length === 0 ? (
                        <div className="col-span-full py-10 text-center">
                          <p className="text-[13px] font-600 text-muted">Nothing matches</p>
                          <p className="text-[11.5px] text-faint mt-0.5">Try another category or spelling</p>
                        </div>
                      ) : catalogProducts.map((product) => {
                        const discP = parseFloat(product.discount) || 0;
                        const finalPrice = product.price - (product.price * discP) / 100;
                        const isLowStock = product.stock <= (product.minStockLevel ?? 5);
                        const expStatus = getExpiryStatus(product);
                        const dead = expStatus === "expired";
                        const soon = expStatus === "expiring";
                        const batchCount = getActivePriceBatches(product).length;

                        /* Status rides a 3px left bar, not a pulsing ring */
                        const bar = dead ? "bg-faint" : isLowStock ? "bg-crimson" : soon ? "bg-gold" : "bg-transparent";

                        return (
                          <button
                            key={product._id}
                            disabled={dead}
                            onClick={() => addToCart(product)}
                            className={`relative overflow-hidden text-left p-2 pl-2.5 rounded-lg border bg-card transition-all h-21 flex flex-col justify-between ${dead ? "border-line opacity-45 cursor-not-allowed" : "border-line hover:border-accent hover:bg-accent-soft active:scale-[.98]"}`}
                          >
                            <span className={`absolute left-0 top-0 bottom-0 w-0.75 ${bar}`}></span>
                            <div className="flex items-start justify-between gap-1">
                              <span className="text-[12px] font-600 text-body leading-tight line-clamp-2">{product.name}</span>
                              {batchCount > 1 && <span className="shrink-0 tnum text-[9px] font-700 text-plum bg-plum-soft px-1 py-px rounded">{batchCount}</span>}
                            </div>
                            <div>
                              <div className="flex items-baseline gap-1">
                                <span className={`tnum text-[14px] font-800 ${dead ? "text-faint line-through" : "text-accent"}`}>{finalPrice.toFixed(2)}</span>
                                {discP > 0 && <span className="tnum text-[10px] font-600 text-faint line-through">{parseFloat(product.price).toFixed(2)}</span>}
                              </div>
                              <div className={`tnum text-[10px] font-600 mt-0.5 truncate ${isLowStock ? "text-crimson" : soon ? "text-gold" : "text-faint"}`}>
                                {dead ? "Expired"
                                  : isLowStock ? `Low · ${formatQtyWithUnit(product.stock, product.unit ?? "Kg")}`
                                  : soon ? `Expires ${new Date(product.expiryDate).toLocaleDateString()}`
                                  : `${formatQtyWithUnit(product.stock, product.unit ?? "Kg")} left`}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </aside>
              ) : (
                <button
                  onClick={() => setCatalogOpen(true)}
                  title="Show catalog (F8)"
                  className="w-8 shrink-0 rounded-xl bg-card border border-line text-muted hover:text-body hover:bg-sunken flex items-center justify-center transition-colors"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="m15 6-6 6 6 6" /></svg>
                </button>
              )}
            </div>
          )}

          {/* 🔄 RETURNS / REFUND / EXCHANGE TAB */}
          {activeTab === "returns" && (
            <div className="flex w-full h-full bg-slate-50 overflow-hidden">
              <div className="flex-1 p-4 overflow-y-auto space-y-4 max-w-5xl mx-auto w-full">

                {/* Invoice Search */}
                <div className="bg-white p-4 rounded-xl border shadow-xs">
                  <h2 className="text-sm font-black uppercase text-slate-800 mb-3">🔄 Return / Refund / Exchange</h2>
                  <form onSubmit={handleSearchInvoiceForReturn} className="flex gap-2">
                    <input
                      type="text"
                      placeholder="🧾 බිල් අංකය ඇතුලත් කරන්න..."
                      value={returnInvoiceSearch}
                      onChange={(e) => setReturnInvoiceSearch(e.target.value)}
                      className="flex-1 p-2.5 border rounded-lg text-sm bg-gray-50 focus:bg-white font-mono"
                    />
                    <button type="submit" disabled={returnLoading} className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-bold disabled:opacity-50">
                      {returnLoading ? "සොයමින්..." : "සොයන්න 🔍"}
                    </button>
                    {returnSaleData && (
                      <button type="button" onClick={resetReturnUI} className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-bold">Clear ✕</button>
                    )}
                  </form>
                  <p className="text-[10px] text-gray-400 mt-2">💡 Invoice Number එක මෙතන ඇතුලත් කරන්න.</p>
                </div>

                {returnSaleData && (
                  <>
                    {/* Sale Info Card */}
                    <div className="bg-white p-4 rounded-xl border shadow-xs flex flex-wrap justify-between items-center gap-3">
                      <div>
                        <p className="text-[10px] text-gray-400 font-bold">බිල්පත් අංකය</p>
                        <p className="font-mono text-xs font-bold text-slate-800">{returnSaleData.invoiceNo || returnSaleData._id}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 font-bold">දිනය</p>
                        <p className="text-xs font-bold text-slate-800">{new Date(returnSaleData.createdAt).toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 font-bold">කැෂියර්</p>
                        <p className="text-xs font-bold text-slate-800">{returnSaleData.cashier}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 font-bold">ගෙවීම් ක්‍රමය</p>
                        <p className="text-xs font-bold text-slate-800">{returnSaleData.paymentMethod}{returnSaleData.customerId ? ` (${returnSaleData.customerId.name})` : ""}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 font-bold">මුළු එකතුව</p>
                        <p className="text-sm font-black text-blue-600">රු. {returnSaleData.totalAmount.toFixed(2)}</p>
                      </div>
                      <div>
                        <span className={`px-2 py-1 rounded-full text-[10px] font-black ${
                          returnSaleData.status === "Voided" ? "bg-gray-200 text-gray-600" :
                          returnSaleData.status === "Returned" ? "bg-red-100 text-red-600" :
                          returnSaleData.status === "PartiallyReturned" ? "bg-amber-100 text-amber-700" :
                          "bg-emerald-100 text-emerald-700"
                        }`}>{returnSaleData.status || "Completed"}</span>
                      </div>
                    </div>

                    {returnSaleData.status === "Voided" ? (
                      <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-sm font-bold text-center">
                        🚫 මෙම බිල්පත දැනටමත් අවලංගු (Voided) කර ඇති නිසා Return/Exchange කළ නොහැක.
                      </div>
                    ) : (
                      <>
                        {/* Items table with return qty inputs */}
                        <div className="bg-white rounded-xl border shadow-xs overflow-hidden">
                          <div className="p-3 border-b bg-gray-50">
                            <h3 className="text-xs font-black uppercase text-slate-800">📦 Return කරන භාණ්ඩ තෝරන්න</h3>
                          </div>
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-slate-100 text-slate-700 font-bold border-b">
                                <th className="p-2.5">භාණ්ඩය</th>
                                <th className="p-2.5 text-center">මිලදී ගත් ප්‍රමාණය</th>
                                <th className="p-2.5 text-center">දැනටමත් Return</th>
                                <th className="p-2.5 text-center">Return ප්‍රමාණය</th>
                                <th className="p-2.5">හේතුව (Optional)</th>
                                <th className="p-2.5 text-right">Refund වන මුදල</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {returnSaleData.items.map((item) => {
                                const available = item.qty - (item.returnedQty || 0);
                                const sel = returnSelections[item._id] || {};
                                const selQty = Math.min(parseFloat(sel.qty) || 0, available);
                                return (
                                  <tr key={item._id} className={available <= 0 ? "opacity-40" : ""}>
                                    <td className="p-2.5 font-bold text-slate-900">{item.name}</td>
                                    <td className="p-2.5 text-center">{item.qty}</td>
                                    <td className="p-2.5 text-center text-gray-400">{item.returnedQty || 0}</td>
                                    <td className="p-2.5 text-center">
                                      <input
                                        type="number" min="0" max={available} step="0.001"
                                        disabled={available <= 0}
                                        placeholder="0"
                                        value={sel.qty || ""}
                                        onChange={(e) => handleReturnSelectionChange(item._id, "qty", e.target.value)}
                                        className="w-20 p-1.5 border rounded text-center font-bold bg-amber-50/50"
                                      />
                                    </td>
                                    <td className="p-2.5">
                                      <input
                                        type="text" placeholder="e.g. Damaged / Wrong item"
                                        value={sel.reason || ""}
                                        onChange={(e) => handleReturnSelectionChange(item._id, "reason", e.target.value)}
                                        className="w-full p-1.5 border rounded bg-gray-50 text-[11px]"
                                      />
                                    </td>
                                    <td className="p-2.5 text-right font-black text-red-600">රු. {(selQty * item.price).toFixed(2)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Mode + Refund Method */}
                        <div className="bg-white p-4 rounded-xl border shadow-xs flex flex-wrap gap-4 items-end">
                          <div>
                            <p className="text-[11px] font-bold text-gray-600 mb-1">ක්‍රියාව තෝරන්න:</p>
                            <div className="flex bg-gray-100 rounded-lg p-1">
                              <button onClick={() => setIsExchangeMode(false)} className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${!isExchangeMode ? "bg-white shadow text-blue-600" : "text-gray-500"}`}>↩️ Return Only</button>
                              <button onClick={() => setIsExchangeMode(true)} className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${isExchangeMode ? "bg-white shadow text-amber-600" : "text-gray-500"}`}>🔁 Exchange</button>
                            </div>
                          </div>
                          <div>
                            <p className="text-[11px] font-bold text-gray-600 mb-1">Refund ක්‍රමය:</p>
                            <select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)} className="p-2 border rounded-lg text-xs font-bold bg-gray-50">
                              <option value="Cash">💵 Cash (අතට ආපසු)</option>
                              <option value="Card">💳 Card ආපසු</option>
                              <option value="StoreCredit">🎟️ Store Credit (ගිණුමට)</option>
                              {returnSaleData.paymentMethod === "Credit" && <option value="CreditAdjust">📕 ණය පොතෙන් අඩු කිරීම</option>}
                            </select>
                          </div>
                          <div className="ml-auto text-right">
                            <p className="text-[11px] font-bold text-gray-500">මුළු Refund මුදල</p>
                            <p className="text-xl font-black text-red-600">රු. {calculateReturnTotal().toFixed(2)}</p>
                          </div>
                        </div>

                        {/* EXCHANGE: pick replacement items */}
                        {isExchangeMode && (
                          <div className="bg-white p-4 rounded-xl border shadow-xs space-y-3">
                            <h3 className="text-xs font-black uppercase text-slate-800">🆕 අලුත් භාණ්ඩ තෝරන්න (Exchange)</h3>
                            <input
                              type="text" placeholder="🔍 භාණ්ඩයේ නම හෝ බාර්කෝඩ් සොයන්න..."
                              value={exchangeProductSearch} onChange={(e) => setExchangeProductSearch(e.target.value)}
                              className="w-full p-2 border rounded-lg text-sm bg-gray-50"
                            />
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                              {products.filter(p =>
                                p.name.toLowerCase().includes(exchangeProductSearch.toLowerCase()) ||
                                (p.barcode && p.barcode.includes(exchangeProductSearch))
                              ).slice(0, 20).map((p) => (
                                <button key={p._id} onClick={() => addToExchangeCart(p)} className="p-2 rounded-lg border bg-slate-50 hover:border-amber-400 text-left">
                                  <div className="text-[11px] font-bold text-slate-800 truncate">{p.name}</div>
                                  <div className="text-xs font-black text-blue-600">රු. {p.price.toFixed(2)}</div>
                                </button>
                              ))}
                            </div>

                            {exchangeCart.length > 0 && (
                              <div className="border-t pt-2 space-y-1.5">
                                {exchangeCart.map((item) => {
                                  const discP = parseFloat(item.discountPercent || item.discount) || 0;
                                  const finalP = item.price - (item.price * discP) / 100;
                                  return (
                                    <div key={item._id} className="flex items-center justify-between bg-amber-50 p-2 rounded-lg text-xs">
                                      <span className="font-bold flex-1">{item.name}</span>
                                      <input
                                        type="number" step="0.001" value={item.qty}
                                        onChange={(e) => setExchangeCart(exchangeCart.map(c => c._id === item._id ? { ...c, qty: e.target.value } : c))}
                                        className="w-16 p-1 border rounded text-center font-bold mx-2"
                                      />
                                      <span className="font-black text-slate-800 w-20 text-right">රු. {(finalP * parseFloat(item.qty || 0)).toFixed(2)}</span>
                                      <button onClick={() => removeFromExchangeCart(item._id)} className="text-red-500 font-bold px-2">✕</button>
                                    </div>
                                  );
                                })}
                                <div className="flex justify-between font-black text-sm pt-1">
                                  <span>අලුත් භාණ්ඩ එකතුව:</span>
                                  <span className="text-blue-600">රු. {calculateExchangeCartTotal().toFixed(2)}</span>
                                </div>
                              </div>
                            )}

                            <div className="flex flex-wrap gap-3 items-end border-t pt-3">
                              <div>
                                <p className="text-[11px] font-bold text-gray-600 mb-1">වෙනස (Difference) ගෙවීමට ක්‍රමය:</p>
                                <select value={exchangePaymentMethod} onChange={(e) => setExchangePaymentMethod(e.target.value)} className="p-2 border rounded-lg text-xs font-bold bg-gray-50">
                                  <option value="Cash">💵 Cash</option>
                                  <option value="Card">💳 Card</option>
                                  {returnSaleData.customerId && <option value="Credit">📕 Credit</option>}
                                </select>
                              </div>
                              {exchangePaymentMethod === "Cash" && (
                                <div>
                                  <p className="text-[11px] font-bold text-gray-600 mb-1">ලැබුණු මුදල (Optional):</p>
                                  <input type="number" value={exchangeCashReceived} onChange={(e) => setExchangeCashReceived(e.target.value)} className="p-2 border rounded-lg text-xs w-32" placeholder="0.00" />
                                </div>
                              )}
                              <div className="ml-auto text-right">
                                <p className="text-[11px] font-bold text-gray-500">වෙනස (New - Refund)</p>
                                {(() => {
                                  const diff = calculateExchangeCartTotal() - calculateReturnTotal();
                                  return (
                                    <p className={`text-xl font-black ${diff > 0 ? "text-red-600" : diff < 0 ? "text-emerald-600" : "text-slate-800"}`}>
                                      {diff > 0 ? `තව ගෙවන්න: රු. ${diff.toFixed(2)}` : diff < 0 ? `ආපසු දෙන්න: රු. ${Math.abs(diff).toFixed(2)}` : "වෙනසක් නැත"}
                                    </p>
                                  );
                                })()}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Submit */}
                        <div className="bg-slate-900 text-white p-4 rounded-xl flex justify-between items-center shadow-lg">
                          <p className="text-xs text-gray-300">
                            {isExchangeMode ? "Exchange එක සම්පූර්ණ කිරීමට Return items සහ අලුත් items දෙකම තෝරන්න." : "Return/Refund එක සම්පූර්ණ කිරීමට Return කරන ප්‍රමාණය ඇතුලත් කරන්න."}
                          </p>
                          <button
                            onClick={isExchangeMode ? handleProcessExchange : handleProcessReturn}
                            className={`px-6 py-2.5 rounded-lg font-black text-sm shadow-md transition-all ${isExchangeMode ? "bg-amber-500 hover:bg-amber-600" : "bg-red-600 hover:bg-red-700"}`}
                          >
                            {isExchangeMode ? "🔁 Exchange එක සම්පූර්ණ කරන්න" : "↩️ Return එක සම්පූර්ණ කරන්න"}
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Admin Panels */}
          {activeTab === "admin" && user.role === "admin" && (
            <div className="flex w-full h-full bg-slate-50 overflow-hidden">
              {/* Sidebar Tabs for Admin */}
              <div className="w-48 bg-slate-800 text-gray-300 flex flex-col font-medium text-sm">
                <button onClick={() => setAdminSubTab("products")} className={`p-3 text-left font-bold ${adminSubTab === "products" ? "bg-blue-600 text-white" : "hover:bg-slate-700"}`}>📦 තොග කළමනාකරණය</button>
                <button onClick={() => setAdminSubTab("customers")} className={`p-3 text-left font-bold ${adminSubTab === "customers" ? "bg-blue-600 text-white" : "hover:bg-slate-700"}`}>👥 පාරිභෝගික පොත</button>
                <button onClick={() => setAdminSubTab("suppliers")} className={`p-3 text-left font-bold ${adminSubTab === "suppliers" ? "bg-blue-600 text-white" : "hover:bg-slate-700"}`}>🚚 සැපයුම්කරුවන්</button>
                <button onClick={() => setAdminSubTab("reorder")} className={`p-3 text-left font-bold flex items-center justify-between ${adminSubTab === "reorder" ? "bg-blue-600 text-white" : "hover:bg-slate-700"}`}>
                  <span>🔔 Low-Stock Alerts</span>
                  {lowStockProducts.length > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-black ${adminSubTab === "reorder" ? "bg-white/20" : "bg-red-500 text-white animate-pulse"}`}>{lowStockProducts.length}</span>
                  )}
                </button>
                <button onClick={() => setAdminSubTab("expiry")} className={`p-3 text-left font-bold flex items-center justify-between ${adminSubTab === "expiry" ? "bg-blue-600 text-white" : "hover:bg-slate-700"}`}>
                  <span>⏳ Expiry Alerts</span>
                  {expiringProducts.length > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-black ${adminSubTab === "expiry" ? "bg-white/20" : "bg-red-500 text-white animate-pulse"}`}>{expiringProducts.length}</span>
                  )}
                </button>
                <button onClick={() => setAdminSubTab("unregistered")} className={`p-3 text-left font-bold flex items-center justify-between ${adminSubTab === "unregistered" ? "bg-blue-600 text-white" : "hover:bg-slate-700"}`}>
                  <span>🆕 Unregistered Items</span>
                  {unregisteredItemGroups.length > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-black ${adminSubTab === "unregistered" ? "bg-white/20" : "bg-amber-500 text-white animate-pulse"}`}>{unregisteredItemGroups.length}</span>
                  )}
                </button>
                <button onClick={() => setAdminSubTab("returns")} className={`p-3 text-left font-bold ${adminSubTab === "returns" ? "bg-blue-600 text-white" : "hover:bg-slate-700"}`}>🔄 Return/Exchange ඉතිහාසය</button>
                <button onClick={() => setAdminSubTab("sales")} className={`p-3 text-left font-bold ${adminSubTab === "sales" ? "bg-blue-600 text-white" : "hover:bg-slate-700"}`}>📊 විකුණුම් වාර්තා</button>
              </div>

              {/* Sub Tab Content Panel */}
              <div className="flex-1 p-6 overflow-y-auto">
                {adminSubTab === "products" && (
                  <div className="space-y-6">
                    {/* Add/Edit Form */}
                    <div className="bg-white p-5 rounded-xl border shadow-xs">
                      <h3 className="text-sm font-black uppercase text-slate-800 mb-4">{isEditing ? "🔄 භාණ්ඩයේ විස්තර වෙනස් කිරීම" : "➕ අලුත් භාණ්ඩයක් ඇතුලත් කිරීම"}</h3>
                      <form onSubmit={handleFormSubmit} className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">භාණ්ඩයේ නම:</label>
                          <input type="text" required value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white" />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">සාමාන්‍ය වෙළඳපල මිල (Market Price):</label>
                          <input type="number" required value={productForm.marketPrice} onChange={(e) => setProductForm({ ...productForm, marketPrice: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white" />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">අපේ විකුණුම් මිල (Our Price):</label>
                          <input type="number" required value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white" />
                          {/* 🆕 MULTI-PRICE WARNING: Admin මේ field එකම කෙලින්ම වෙනස් කරනවනම් - පරණ මිල නැති වී යනවා කියලා කලින්ම කියයි */}
                          {isEditing && editingOriginalProduct && parseFloat(productForm.price) !== parseFloat(editingOriginalProduct.price) && !showNewPriceEntry && parseFloat(editingOriginalProduct.stock) > 0 && (
                            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-1.5 mt-1 leading-snug">
                              ⚠️ මෙහෙම කෙලින්ම මිල වෙනස් කළොත්, පරණ මිල (රු.{parseFloat(editingOriginalProduct.price).toFixed(2)}) සම්පූර්ණයෙන්ම මැකිලා අලුත් මිලින්ම replace වෙනවා — Popup එකක් පේන්නෙත් නෑ.
                              පරණ මිලේ ඉතුරු තොගයත් ({editingOriginalProduct.stock}ක්) වෙනම විකුණන්න ඕන නම්, මේ field එක <b>ආපහු පරණ අගයට</b> දාලා, පහළින් තියෙන <b>🔄 "නව මිලකට Stock ලැබුනාද?"</b> Button එකෙන් විතරක් අලුත් මිල දාන්න.
                            </p>
                          )}
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">ගැනුම් මිල (Cost Price):</label>
                          <input type="number" required value={productForm.costPrice} onChange={(e) => setProductForm({ ...productForm, costPrice: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white" />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">
                            ආරම්භක තොගය (Stock Qty):
                            {productForm.batches && productForm.batches.length > 0 && <span className="text-purple-600"> — Batches වලින් Auto-Calculate 🔒</span>}
                          </label>
                          <input
                            type="number" required
                            readOnly={productForm.batches && productForm.batches.length > 0}
                            value={productForm.stock}
                            onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })}
                            className={`w-full p-2 border rounded text-xs focus:bg-white ${productForm.batches && productForm.batches.length > 0 ? "bg-purple-50 text-purple-800 font-bold cursor-not-allowed" : "bg-gray-50"}`}
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">බාර්කෝඩ් අංකය (Barcode - Optional):</label>
                          <input type="text" value={productForm.barcode} onChange={(e) => setProductForm({ ...productForm, barcode: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white" />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">භාණ්ඩයේ ප්‍රමාණය මනින ඒකකය (Unit):</label>
                          <select value={productForm.unit} onChange={(e) => setProductForm({ ...productForm, unit: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 text-gray-700">
                            <option value="">-- Unit නැත --</option>
                            <option value="Kg">Kilogram (Kg)</option>
                            <option value="G">Gram (G)</option>
                            <option value="Pieces">Pieces</option>
                            <option value="Packet">Packet</option>
                            <option value="Bottle">Bottle</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">භාණ්ඩයේ වර්ගය (Category):</label>
                          <select value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 text-gray-700 font-bold">
                            {PRODUCT_CATEGORIES.map((cat) => (
                              <option key={cat.value} value={cat.value}>{cat.icon} {cat.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">විශේෂ වට්ටම් ප්‍රතිශතය (%):</label>
                          <input type="number" placeholder="0" value={productForm.discountPercent} onChange={(e) => setProductForm({ ...productForm, discountPercent: e.target.value })} className="w-full p-2 border rounded text-xs bg-red-50/50" />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">🔔 අවම තොග මට්ටම (Reorder Alert Level):</label>
                          <input type="number" placeholder="5" value={productForm.minStockLevel} onChange={(e) => setProductForm({ ...productForm, minStockLevel: e.target.value })} className="w-full p-2 border rounded text-xs bg-purple-50/50 font-bold" />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">🚚 Reorder කරන්නේ මේ Supplier ලගින් (Optional):</label>
                          <select value={productForm.preferredSupplierId} onChange={(e) => setProductForm({ ...productForm, preferredSupplierId: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 text-gray-700">
                            <option value="">තෝරලා නැත</option>
                            {suppliers.map(s => (
                              <option key={s._id} value={s._id}>{s.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">⏳ කල් ඉකුත් වන දිනය (Expiry Date - Optional):</label>
                          <input type="date" value={productForm.expiryDate} onChange={(e) => setProductForm({ ...productForm, expiryDate: e.target.value })} className="w-full p-2 border rounded text-xs bg-orange-50/50 font-bold" />
                        </div>
                        {/* 🆕 MULTI-PRICE (Simplified): "Batch" කියන වචනයවත් නැතුව, එකම action එකෙන් (Edit කරද්දී විතරයි පේනවා) */}
                        {isEditing && (
                          <div className="col-span-2 md:col-span-4 border-t-2 border-purple-200 pt-3 mt-1 bg-purple-50/30 -mx-1 px-2 py-2 rounded-lg">

                            {/* දැනටමත් Multi-Price එකක් තියෙනවනම්, ඒවා සරලව Summary chips විදිහට පෙන්වයි */}
                            {productForm.batches && productForm.batches.length > 0 && (
                              <div className="mb-2">
                                <p className="text-[10px] font-black text-purple-800 uppercase mb-1">💰 මේ භාණ්ඩයට දැනට තියෙන මිල ගණන්:</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {productForm.batches.map((batch, index) => (
                                    <span key={index} className="inline-flex items-center gap-1.5 bg-white border border-purple-300 rounded-full pl-3 pr-1 py-1 text-[11px] font-bold text-slate-700">
                                      {batch.label || `මිල ${index + 1}`}: රු.{parseFloat(batch.price || 0).toFixed(2)} ({batch.stock}ක්)
                                      {parseFloat(batch.costPrice) > 0 && <span className="text-gray-400 font-normal">| පිරිවැය: රු.{parseFloat(batch.costPrice).toFixed(2)}</span>}
                                      {parseFloat(batch.discount) > 0 && <span className="text-red-500 font-normal">| {batch.discount}% OFF</span>}
                                      <button type="button" onClick={() => handleRemoveBatch(index)} className="text-red-400 hover:text-red-600 font-black w-4 h-4 flex items-center justify-center rounded-full hover:bg-red-50">✕</button>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {!showNewPriceEntry ? (
                              <button
                                type="button"
                                onClick={() => setShowNewPriceEntry(true)}
                                className="w-full flex items-center justify-center gap-2 bg-purple-100 hover:bg-purple-200 border border-purple-300 text-purple-800 font-bold py-2 rounded-lg text-xs transition-all"
                              >
                                🔄 නව මිලකට Stock ලැබුනාද? (Multi-Price) — Click කරන්න
                              </button>
                            ) : (
                              <div className="bg-white border border-purple-300 rounded-lg p-3 space-y-2">
                                <p className="text-[10px] text-gray-500 leading-relaxed">
                                  පරණ තොගය (රු.{editingOriginalProduct ? parseFloat(editingOriginalProduct.price || 0).toFixed(2) : "0.00"} ට {editingOriginalProduct?.stock ?? 0}ක්) ඒ විදිහටම විකුණන්න පුළුවන්ව තියේවි.
                                  මෙතන දාන්නේ <b>අලුතින්</b> ලැබුණු Stock එකේ මිල සහ ප්‍රමාණය විතරයි:
                                </p>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="text-[10px] font-bold text-gray-500 block mb-1">නව විකුණුම් මිල (රු.):</label>
                                    <input type="number" placeholder="උදා: 1050" value={newPriceEntry.price} onChange={(e) => setNewPriceEntry({ ...newPriceEntry, price: e.target.value })} className="w-full p-2 border rounded text-xs font-black text-purple-800 bg-purple-50/30" />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-bold text-gray-500 block mb-1">අලුතින් ලැබුණු ප්‍රමාණය:</label>
                                    <input type="number" placeholder="උදා: 20" value={newPriceEntry.qty} onChange={(e) => setNewPriceEntry({ ...newPriceEntry, qty: e.target.value })} className="w-full p-2 border rounded text-xs font-black text-purple-800 bg-purple-50/30" />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-bold text-gray-500 block mb-1">🆕 මේ Stock එකේ පිරිවැය මිල (Cost Price):</label>
                                    <input type="number" placeholder="උදා: 880" value={newPriceEntry.costPrice} onChange={(e) => setNewPriceEntry({ ...newPriceEntry, costPrice: e.target.value })} className="w-full p-2 border rounded text-xs font-bold text-slate-700 bg-slate-50" />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-bold text-gray-500 block mb-1">🆕 මේ Stock එකට වට්ටම % (Optional):</label>
                                    <input type="number" placeholder="උදා: 5" value={newPriceEntry.discount} onChange={(e) => setNewPriceEntry({ ...newPriceEntry, discount: e.target.value })} className="w-full p-2 border rounded text-xs font-bold text-slate-700 bg-slate-50" />
                                  </div>
                                </div>
                                <p className="text-[9px] text-gray-400 leading-snug">💡 Cost Price එක නිවැරදිව දැම්මොත් විතරයි, විකුණුම් වාර්තා වල මේ Stock එකෙන්ම ලැබෙන ලාභය හරියටම පෙන්වන්නේ.</p>
                                <div className="flex gap-2">
                                  <button type="button" onClick={() => { setShowNewPriceEntry(false); setNewPriceEntry({ price: "", qty: "", costPrice: "", discount: "" }); }} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 py-1.5 rounded text-xs font-bold">අවලංගු කරන්න</button>
                                  <button type="button" onClick={handleAddNewPricePoint} className="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-1.5 rounded text-xs font-bold">✔️ එකතු කරන්න</button>
                                </div>
                              </div>
                            )}

                            {productForm.batches && productForm.batches.length > 1 && (
                              <p className="text-[10px] text-emerald-700 font-semibold mt-2">✅ මිල 2ක් හෝ වැඩි ගණනක් තියෙන නිසා, Billing screen එකේදී Scan/Search කරද්දී මිල තෝරන්න Popup එකක් පේනවා.</p>
                            )}
                          </div>
                        )}

                        <div className="col-span-2 md:col-span-4 flex justify-end gap-2 pt-2">
                          {isEditing && <button type="button" onClick={() => { setIsEditing(false); setEditingOriginalProduct(null); setProductForm({ name: "", marketPrice: "", price: "", costPrice: "", stock: "", barcode: "", discountPercent: "", unit: "Kg", category: "Grocery", minStockLevel: "5", preferredSupplierId: "", expiryDate: "", batches: [] }); setShowNewPriceEntry(false); setNewPriceEntry({ price: "", qty: "", costPrice: "", discount: "" }); }} className="bg-gray-500 text-white px-4 py-2 rounded text-xs font-bold">Cancel</button>}
                          <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded text-xs font-bold shadow-md">{isEditing ? "යාවත්කාලීන කරන්න" : "ඩේටාබේස් එකට එකතු කරන්න"}</button>
                        </div>
                      </form>
                    </div>

                    {/* Stock Table List */}
                    <div className="bg-white rounded-xl border shadow-xs overflow-hidden">
                      <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                        <h3 className="text-xs font-black uppercase text-slate-800">📦 වත්මන් ගබඩා තොග ලැයිස්තුව ({products.length} Items)</h3>
                        <input type="text" placeholder="භාණ්ඩ නම හෝ බාර්කෝඩ් සර්ච් කරන්න..." value={adminProductSearch} onChange={(e) => setAdminProductSearch(e.target.value)} className="p-1.5 border rounded-lg text-xs w-64 bg-white" />
                      </div>
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-100 text-slate-700 font-bold border-b border-gray-200">
                            <th className="p-3">භාණ්ඩයේ නම</th>
                            <th className="p-3">වර්ගය</th>
                            <th className="p-3">බාර්කෝඩ්</th>
                            <th className="p-3 text-right">වෙළඳපල මිල</th>
                            <th className="p-3 text-right">අපේ මිල</th>
                            <th className="p-3 text-right">ගැනුම් මිල</th>
                            <th className="p-3 text-center">වත්මන් තොගය</th>
                            <th className="p-3 text-center">වට්ටම්</th>
                            <th className="p-3 text-center">⏳ Expiry</th>
                            <th className="p-3 text-center">ක්‍රියාවන්</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 font-medium">
                          {filteredAdminProducts.map((p) => {
                            const expStatus = getExpiryStatus(p);
                            return (
                            <tr key={p._id} className={`hover:bg-slate-50/80 ${expStatus === "expired" ? "bg-red-50/60" : expStatus === "expiring" ? "bg-amber-50/60" : ""}`}>
                              <td className="p-3 font-bold text-slate-900">{p.name}</td>
                              <td className="p-3">
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 whitespace-nowrap">
                                  {(PRODUCT_CATEGORIES.find(c => c.value === (p.category || "Grocery")) || PRODUCT_CATEGORIES[0]).icon}{" "}
                                  {p.category || "Grocery"}
                                </span>
                              </td>
                              <td className="p-3 text-gray-500">{p.barcode || "N/A"}</td>
                              <td className="p-3 text-right text-gray-500">රු. {p.marketPrice?.toFixed(2) || p.price?.toFixed(2)}</td>
                              <td className="p-3 text-right font-black text-blue-600">රු. {p.price.toFixed(2)}</td>
                              <td className="p-3 text-right text-emerald-700">රු. {p.costPrice?.toFixed(2) || "0.00"}</td>
                              <td className="p-3 text-center font-black"><span className={`px-2 py-0.5 rounded-sm ${p.stock > (p.minStockLevel ?? 5) ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-600'}`}>{formatQtyWithUnit(p.stock, p.unit ?? 'Kg')}</span></td>
                              <td className="p-3 text-center text-red-500 font-bold">{p.discount || 0}% OFF</td>
                              <td className="p-3 text-center">
                                {p.expiryDate ? (
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black whitespace-nowrap ${
                                    expStatus === "expired" ? "bg-red-600 text-white" :
                                    expStatus === "expiring" ? "bg-amber-400 text-amber-950" :
                                    "bg-gray-100 text-gray-500"
                                  }`}>
                                    {expStatus === "expired" ? "⛔ Expired" : expStatus === "expiring" ? "⚠️ " : ""}{new Date(p.expiryDate).toLocaleDateString()}
                                  </span>
                                ) : <span className="text-gray-300 text-[10px]">-</span>}
                              </td>
                              <td className="p-3 text-center space-x-1.5">
                                <button onClick={() => handleEditClick(p)} className="bg-amber-500 hover:bg-amber-600 text-white px-2 py-1 rounded text-[10px] font-bold">Edit</button>
                                <button onClick={() => handleDeleteClick(p._id)} className="bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded text-[10px] font-bold">Delete</button>
                              </td>
                            </tr>
                          );})}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 🛠️ NEW (Step 3 - Low Stock Reorder Alert + Purchase Order Suggestion) */}
                {adminSubTab === "reorder" && (
                  <div className="space-y-6">
                    <div className="bg-white p-5 rounded-xl border shadow-xs">
                      <h3 className="text-sm font-black uppercase text-slate-800 mb-1">🔔 Low-Stock Alerts</h3>
                      <p className="text-xs text-gray-500">අවම තොග මට්ටමට වඩා අඩුවෙලා තියෙන භාණ්ඩ, Supplier අනුව Group කර පෙන්වයි</p>
                    </div>

                    {lowStockProducts.length === 0 ? (
                      <div className="bg-white p-10 rounded-xl border shadow-xs flex flex-col items-center justify-center text-center">
                        <span className="text-4xl mb-2">✅</span>
                        <p className="text-sm font-bold text-slate-700">සියලුම භාණ්ඩ වල තොග ප්‍රමාණවත්!</p>
                        <p className="text-xs text-gray-400 mt-1">Reorder කරන්න ඕන කිසිම භාණ්ඩයක් නැත</p>
                      </div>
                    ) : (
                      Object.entries(lowStockGroupedBySupplier).map(([supplierKey, productsGroup]) => {
                        const supplier = supplierKey !== "unassigned" ? suppliers.find(s => s._id === supplierKey) : null;
                        return (
                          <div key={supplierKey} className="bg-white rounded-xl border shadow-xs overflow-hidden">
                            <div className="p-4 border-b bg-gray-50">
                              <h4 className="text-xs font-black uppercase text-slate-800">
                                {supplier ? `🚚 ${supplier.name}` : "❓ Supplier නොමැති භාණ්ඩ"}
                              </h4>
                              <p className="text-[10px] text-gray-400 mt-0.5">{productsGroup.length} භාණ්ඩයක් Reorder කරන්න ඕන</p>
                            </div>
                            <table className="w-full text-left border-collapse text-xs">
                              <thead>
                                <tr className="bg-slate-100 text-slate-700 font-bold border-b">
                                  <th className="p-3">භාණ්ඩයේ නම</th>
                                  <th className="p-3 text-center">වත්මන් තොගය</th>
                                  <th className="p-3 text-center">අවම මට්ටම</th>
                                  <th className="p-3 text-center">යෝජිත Reorder ප්‍රමාණය</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 font-medium">
                                {productsGroup.map((p) => (
                                  <tr key={p._id} className="hover:bg-red-50/40">
                                    <td className="p-3 font-bold text-slate-900">{p.name}</td>
                                    <td className="p-3 text-center"><span className="bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-black">{formatQtyWithUnit(p.stock, p.unit ?? "Kg")}</span></td>
                                    <td className="p-3 text-center text-gray-500">{formatQtyWithUnit(p.minStockLevel ?? 5, p.unit ?? "Kg")}</td>
                                    <td className="p-3 text-center font-black text-emerald-700">{formatQtyWithUnit(getSuggestedReorderQty(p), p.unit ?? "Kg")}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {/* 🆕 EXPIRY ALERTS Sub-tab */}
                {adminSubTab === "expiry" && (
                  <div className="space-y-6">
                    <div className="bg-white p-5 rounded-xl border shadow-xs">
                      <h3 className="text-sm font-black uppercase text-slate-800 mb-1">⏳ Expiry Alerts</h3>
                      <p className="text-xs text-gray-500">ඉදිරි දින 7ක් ඇතුලත Expire වන සහ දැනටමත් Expire වුනු භාණ්ඩ ලැයිස්තුව</p>
                    </div>

                    {expiringProducts.length === 0 ? (
                      <div className="bg-white p-10 rounded-xl border shadow-xs flex flex-col items-center justify-center text-center">
                        <span className="text-4xl mb-2">✅</span>
                        <p className="text-sm font-bold text-slate-700">ළඟදී Expire වන භාණ්ඩයක් නැත!</p>
                      </div>
                    ) : (
                      <div className="bg-white rounded-xl border shadow-xs overflow-hidden">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-100 text-slate-700 font-bold border-b">
                              <th className="p-3">භාණ්ඩයේ නම</th>
                              <th className="p-3 text-center">වත්මන් තොගය</th>
                              <th className="p-3 text-center">Expiry Date</th>
                              <th className="p-3 text-center">තත්ත්වය</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 font-medium">
                            {expiringProducts.map((p) => (
                              <tr key={p._id} className={p.expiryStatus === "expired" ? "bg-red-50/60" : "bg-amber-50/40"}>
                                <td className="p-3 font-bold text-slate-900">{p.name}</td>
                                <td className="p-3 text-center">{formatQtyWithUnit(p.stock, p.unit ?? "Kg")}</td>
                                <td className="p-3 text-center font-bold">{new Date(p.expiryDate).toLocaleDateString()}</td>
                                <td className="p-3 text-center">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${p.expiryStatus === "expired" ? "bg-red-600 text-white" : "bg-amber-400 text-amber-950"}`}>
                                    {p.expiryStatus === "expired" ? "⛔ කල් ඉකුත් වී ඇත" : "⚠️ ළඟදීම Expire වේ"}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* 🆕 UNREGISTERED ITEMS Sub-tab (Review Queue) */}
                {adminSubTab === "unregistered" && (
                  <div className="space-y-6">
                    <div className="bg-white p-5 rounded-xl border shadow-xs flex justify-between items-start gap-4">
                      <div>
                        <h3 className="text-sm font-black uppercase text-slate-800 mb-1">🆕 Unregistered Items</h3>
                        <p className="text-xs text-gray-500">"හදිසි අවස්ථා" එකෙන් Database එකට Register නොකර විකුණපු භාණ්ඩ ලැයිස්තුව — Review කරලා, ඕන ඒවා Catalog එකට Register කරන්න.</p>
                      </div>
                      {unregisteredItemGroups.length > 0 && (
                        <button onClick={handleClearAllUnregisteredItems} className="bg-red-50 hover:bg-red-600 text-red-600 hover:text-white border border-red-200 px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all">🧹 සියල්ල ඉවත් කරන්න</button>
                      )}
                    </div>

                    {unregisteredItemGroups.length === 0 ? (
                      <div className="bg-white p-10 rounded-xl border shadow-xs flex flex-col items-center justify-center text-center">
                        <span className="text-4xl mb-2">✅</span>
                        <p className="text-sm font-bold text-slate-700">Register කරන්න ඕන Items නැත!</p>
                        <p className="text-xs text-gray-400 mt-1">Unregistered විදිහට විකුණපු භාණ්ඩයක් තවම නැත</p>
                      </div>
                    ) : (
                      <div className="bg-white rounded-xl border shadow-xs overflow-hidden">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-100 text-slate-700 font-bold border-b">
                              <th className="p-3">භාණ්ඩයේ නම</th>
                              <th className="p-3 text-center">මුළු විකුණපු ප්‍රමාණය</th>
                              <th className="p-3 text-center">කී වතාවක් Sell වුනාද</th>
                              <th className="p-3 text-right">සාමාන්‍ය මිල</th>
                              <th className="p-3 text-center">අන්තිමට Sell වුනු දිනය</th>
                              <th className="p-3 text-center">ක්‍රියාවන්</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 font-medium">
                            {unregisteredItemGroups.map((g) => (
                              <tr key={g.name} className="hover:bg-amber-50/40">
                                <td className="p-3 font-bold text-slate-900">{g.name}</td>
                                <td className="p-3 text-center">{g.totalQty}</td>
                                <td className="p-3 text-center"><span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-black">{g.occurrences}×</span></td>
                                <td className="p-3 text-right text-gray-600">රු. {g.avgPrice.toFixed(2)}</td>
                                <td className="p-3 text-center text-gray-500">{new Date(g.lastSoldAt).toLocaleDateString()}</td>
                                <td className="p-3 text-center space-x-1.5 whitespace-nowrap">
                                  <button onClick={() => handleRegisterUnregisteredItem(g)} className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-[10px] font-bold transition-all">➕ Register</button>
                                  <button onClick={() => handleDismissUnregisteredItem(g.name)} className="bg-red-100 hover:bg-red-600 text-red-600 hover:text-white px-2 py-1 rounded text-[10px] font-bold transition-all">🗑️ Delete</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* 🆕 RETURN / EXCHANGE HISTORY Sub-tab */}
                {adminSubTab === "returns" && (
                  <div className="space-y-6">
                    <div className="bg-white p-5 rounded-xl border shadow-xs flex justify-between items-start gap-4">
                      <div>
                        <h3 className="text-sm font-black uppercase text-slate-800 mb-1">🔄 Return / Exchange History</h3>
                        <p className="text-xs text-gray-500">සිදු කරන ලද සියලුම Return, Refund සහ Exchange transactions</p>
                      </div>
                      {returnHistory.length > 0 && (
                        <button onClick={handleClearAllReturns} className="bg-red-50 hover:bg-red-600 text-red-600 hover:text-white border border-red-200 px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all">🧹 සියල්ල ඉවත් කරන්න</button>
                      )}
                    </div>

                    {returnHistory.length === 0 ? (
                      <div className="bg-white p-10 rounded-xl border shadow-xs flex flex-col items-center justify-center text-center">
                        <span className="text-4xl mb-2">📭</span>
                        <p className="text-sm font-bold text-slate-700">තවම Return/Exchange සිදුවී නැත</p>
                      </div>
                    ) : (
                      <div className="bg-white rounded-xl border shadow-xs overflow-hidden">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-100 text-slate-700 font-bold border-b">
                              <th className="p-3">දිනය</th>
                              <th className="p-3">මුල් බිල් අංකය</th>
                              <th className="p-3">වර්ගය</th>
                              <th className="p-3">කැෂියර්</th>
                              <th className="p-3">භාණ්ඩ</th>
                              <th className="p-3">Refund ක්‍රමය</th>
                              <th className="p-3 text-right">Refund මුදල</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 font-medium">
                            {returnHistory.map((r) => (
                              <tr key={r._id} className="hover:bg-slate-50/80">
                                <td className="p-3 text-gray-500">{new Date(r.createdAt).toLocaleString()}</td>
                                <td className="p-3 font-mono font-bold text-slate-700">{r.invoiceNo || `#${r.saleId.toString().slice(-8).toUpperCase()}`}</td>
                                <td className="p-3">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${r.type === "Exchange" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-600"}`}>
                                    {r.type === "Exchange" ? "🔁 Exchange" : "↩️ Return"}
                                  </span>
                                </td>
                                <td className="p-3 font-bold">{r.cashier}</td>
                                <td className="p-3 text-gray-600">{r.items.map(i => `${i.name} (${i.qty})`).join(", ")}</td>
                                <td className="p-3">{r.refundMethod}</td>
                                <td className="p-3 text-right font-black text-red-600">රු. {r.totalRefundAmount.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* Customers Sub-tab with Credit Settlements */}
                {adminSubTab === "customers" && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="bg-white p-5 rounded-xl border shadow-xs h-fit">
                      <h3 className="text-xs font-black uppercase text-slate-800 mb-4">{isEditingCustomer ? "🔄 පාරිභෝගික ගිණුම වෙනස් කිරීම" : "➕ අලුත් පාරිභෝගිකයෙක් ලියාපදිංචි කිරීම"}</h3>
                      <form onSubmit={handleCustomerSubmit} className="space-y-4">
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">පාරිභෝගිකයාගේ නම:</label>
                          <input type="text" required value={customerForm.name} onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white" />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">දුරකථන අංකය:</label>
                          <input type="text" required value={customerForm.phone} onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white" />
                        </div>
                        <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded text-xs font-bold shadow-md">{isEditingCustomer ? "යාවත්කාලීන කරන්න" : "ගිණුම සාදන්න"}</button>
                      </form>

                      {/* Manual Settle Credit Payment Section */}
                      <div className="border-t pt-4 mt-6">
                        <h3 className="text-xs font-black uppercase text-red-700 mb-3">💵 ණය මුදල් පියවීම් සටහන් කිරීම</h3>
                        <form onSubmit={handleSettleCredit} className="space-y-3">
                          <select required value={creditPayment.customerId} onChange={(e) => setCreditPayment({ ...creditPayment, customerId: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 text-gray-700 font-bold">
                            <option value="">පාරිභෝගිකයාව තෝරන්න...</option>
                            {customers.map(c => (
                              <option key={c._id} value={c._id}>{c.name} (ණය: රු.{c.creditBalance?.toFixed(2)})</option>
                            ))}
                          </select>
                          <input type="number" required placeholder="පියවන ලද මුදල (රු.)" value={creditPayment.amount} onChange={(e) => setCreditPayment({ ...creditPayment, amount: e.target.value })} className="w-full p-2 border rounded text-xs font-black text-emerald-700" />
                          <button type="submit" className="w-full bg-emerald-600 text-white py-2 rounded text-xs font-bold">ණය මුදල කපා හරින්න 🎉</button>
                        </form>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border shadow-xs overflow-hidden lg:col-span-2">
                      <div className="p-4 border-b bg-gray-50">
                        <h3 className="text-xs font-black uppercase text-slate-800">👥 ලියාපදිංචි පාරිභෝගික නාමාවලිය ({customers.length} Customers)</h3>
                      </div>
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-100 text-slate-700 font-bold border-b">
                            <th className="p-3">පාරිභෝගික නම</th>
                            <th className="p-3">දුරකථන අංකය</th>
                            <th className="p-3 text-right">දැනට ඇති මුළු ණය හිඟය</th>
                            <th className="p-3 text-center">ක්‍රියාවන්</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 font-medium">
                          {customers.map((c) => (
                              <tr key={c._id} onClick={() => setViewCustomerDetails(c._id)} className="hover:bg-blue-50/60 cursor-pointer transition-colors">
                                <td className="p-3 font-bold text-slate-900 hover:text-blue-600 hover:underline">{c.name}</td>
                                <td className="p-3 text-gray-500">{c.phone}</td>
                                <td className="p-3 text-right font-black text-red-600">රු. {c.creditBalance?.toFixed(2) || "0.00"}</td>
                                <td className="p-3 text-center space-x-1.5">
                                  <button onClick={(e) => { e.stopPropagation(); handleEditCustomerClick(c); }} className="bg-amber-500 text-white px-2 py-1 rounded text-[10px] font-bold">Edit</button>
                                  <button onClick={(e) => { e.stopPropagation(); handleDeleteCustomerClick(c._id); }} className="bg-red-600 text-white px-2 py-1 rounded text-[10px] font-bold">Delete</button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 🛠️ NEW: Suppliers Sub-tab with Balance Due Ledger */}
                {adminSubTab === "suppliers" && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="space-y-6">
                      {/* Add/Edit Supplier Form */}
                      <div className="bg-white p-5 rounded-xl border shadow-xs h-fit">
                        <h3 className="text-xs font-black uppercase text-slate-800 mb-4">{isEditingSupplier ? "🔄 සැපයුම්කරුගේ විස්තර වෙනස් කිරීම" : "➕ අලුත් සැපයුම්කරුවෙක් ලියාපදිංචි කිරීම"}</h3>
                        <form onSubmit={handleSupplierSubmit} className="space-y-4">
                          <div>
                            <label className="text-[11px] font-bold text-gray-600 block mb-1">සැපයුම්කරුගේ නම:</label>
                            <input type="text" required value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white" />
                          </div>
                          <div>
                            <label className="text-[11px] font-bold text-gray-600 block mb-1">දුරකථන අංකය:</label>
                            <input type="text" required value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white" />
                          </div>
                          <div>
                            <label className="text-[11px] font-bold text-gray-600 block mb-1">ලිපිනය (Optional):</label>
                            <input type="text" value={supplierForm.address} onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white" />
                          </div>
                          <div className="flex gap-2">
                            {isEditingSupplier && <button type="button" onClick={() => { setIsEditingSupplier(false); setEditSupplierId(null); setSupplierForm({ name: "", phone: "", address: "" }); }} className="flex-1 bg-gray-500 text-white py-2 rounded text-xs font-bold">Cancel</button>}
                            <button type="submit" className="flex-1 bg-blue-600 text-white py-2 rounded text-xs font-bold shadow-md">{isEditingSupplier ? "යාවත්කාලීන කරන්න" : "ගිණුම සාදන්න"}</button>
                          </div>
                        </form>
                      </div>

                      {/* 🛠️ UPDATED (Step 2 - GRN Multi-item): Cart-style Stock ලැබීම් සටහන් කිරීම */}
                      <div className="bg-white p-5 rounded-xl border shadow-xs h-fit">
                        <h3 className="text-xs font-black uppercase text-amber-700 mb-3">📦 Stock ලැබීමක් සටහන් කිරීම (GRN)</h3>
                        <p className="text-[10px] text-gray-500 mb-3">එකම Invoice එකකින් ලැබුණු භාණ්ඩ කිහිපයම මෙතනින් එකතු කරන්න — අන්තිමට එකවර Submit කරන්න.</p>

                        <div className="space-y-3">
                          <select value={grnSupplierId} onChange={(e) => setGrnSupplierId(e.target.value)} className="w-full p-2 border rounded text-xs bg-gray-50 text-gray-700 font-bold">
                            <option value="">සැපයුම්කරු තෝරන්න...</option>
                            {suppliers.map(s => (
                              <option key={s._id} value={s._id}>{s.name} (ගෙවීමට ඇත: රු.{s.balanceDue?.toFixed(2)})</option>
                            ))}
                          </select>

                          {/* Add Item Row */}
                          <div className="bg-amber-50/60 border border-amber-200 rounded-lg p-3 space-y-2">
                            <select
                              value={grnCurrentItem.productId}
                              onChange={(e) => {
                                const selectedProduct = products.find(p => p._id === e.target.value);
                                setGrnCurrentItem({
                                  ...grnCurrentItem,
                                  productId: e.target.value,
                                  // 🛠️ භාණ්ඩය තෝරාගත් සැණින්, දැනට තියෙන Cost Price එක auto-fill වේ
                                  costPrice: selectedProduct ? String(selectedProduct.costPrice || "") : ""
                                });
                              }}
                              className="w-full p-2 border rounded text-xs bg-white text-gray-700 font-bold"
                            >
                              <option value="">භාණ්ඩය තෝරන්න...</option>
                              {products.map(p => (
                                <option key={p._id} value={p._id}>{p.name} (වත්මන් තොගය: {formatQtyWithUnit(p.stock, p.unit ?? "Kg")})</option>
                              ))}
                            </select>

                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] font-bold text-gray-500 block mb-1">ලැබුණු ප්‍රමාණය:</label>
                                <input type="number" step="0.001" placeholder="Qty" value={grnCurrentItem.quantity} onChange={(e) => setGrnCurrentItem({ ...grnCurrentItem, quantity: e.target.value })} className="w-full p-2 border rounded text-xs font-black text-slate-800 bg-white" />
                              </div>
                              <div>
                                <label className="text-[10px] font-bold text-gray-500 block mb-1">ගැනුම් මිල (රු./ඒකකයට):</label>
                                <input type="number" step="0.01" placeholder="Cost Price" value={grnCurrentItem.costPrice} onChange={(e) => setGrnCurrentItem({ ...grnCurrentItem, costPrice: e.target.value })} className="w-full p-2 border rounded text-xs font-black text-amber-700 bg-white" />
                              </div>
                            </div>

                            {/* 🛠️ NEW: Stock Mode Toggle - Add (එකතු කරන්න) vs Set (ලෙස සකසන්න / Overwrite) */}
                            <div>
                              <label className="text-[10px] font-bold text-gray-500 block mb-1">වත්මන් තොගයට කරන්නේ:</label>
                              <div className="grid grid-cols-2 gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setGrnCurrentItem({ ...grnCurrentItem, stockMode: "add" })}
                                  className={`py-1.5 rounded text-[10px] font-bold border transition-all ${
                                    grnCurrentItem.stockMode === "add"
                                      ? "bg-blue-600 text-white border-blue-600"
                                      : "bg-white text-gray-600 border-gray-300"
                                  }`}
                                >
                                  ➕ එකතු කරන්න (Add)
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setGrnCurrentItem({ ...grnCurrentItem, stockMode: "set" })}
                                  className={`py-1.5 rounded text-[10px] font-bold border transition-all ${
                                    grnCurrentItem.stockMode === "set"
                                      ? "bg-purple-600 text-white border-purple-600"
                                      : "bg-white text-gray-600 border-gray-300"
                                  }`}
                                >
                                  🔄 මෙයට සකසන්න (Set)
                                </button>
                              </div>
                              {grnCurrentItem.stockMode === "set" && (
                                <p className="text-[9px] text-purple-600 font-bold mt-1">⚠️ වත්මන් තොගය සම්පූර්ණයෙන් මෙම ප්‍රමාණයට replace වේ (Opening Stock / Correction සඳහා පමණි)</p>
                              )}
                            </div>

                            <button type="button" onClick={handleAddGrnItem} className="w-full bg-amber-600 hover:bg-amber-700 text-white py-1.5 rounded text-xs font-bold transition-all">➕ List එකට එකතු කරන්න</button>
                          </div>

                          {/* Added Items List */}
                          {grnItems.length > 0 && (
                            <div className="border rounded-lg overflow-hidden">
                              <div className="bg-slate-100 px-3 py-1.5 text-[10px] font-black text-slate-600 uppercase">GRN List ({grnItems.length} Items)</div>
                              <div className="divide-y divide-gray-100 max-h-48 overflow-y-auto">
                                {grnItems.map((item, index) => (
                                  <div key={index} className="flex items-center justify-between px-3 py-2 text-xs">
                                    <div className="flex-1">
                                      <p className="font-bold text-slate-800">
                                        {item.productName}
                                        {item.stockMode === "set" && (
                                          <span className="ml-1.5 text-[8px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-black align-middle">SET</span>
                                        )}
                                      </p>
                                      <p className="text-[10px] text-gray-500">{formatQtyWithUnit(item.quantity, item.unit)} × රු.{item.costPrice.toFixed(2)}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="font-black text-amber-700">රු.{(item.quantity * item.costPrice).toFixed(2)}</span>
                                      <button type="button" onClick={() => handleRemoveGrnItem(index)} className="text-red-400 hover:text-red-600 font-bold px-1">✕</button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <div className="bg-amber-50 border-t border-amber-200 px-3 py-2 flex justify-between items-center">
                                <span className="text-[11px] font-bold text-amber-800">මුළු ගණන (Grand Total):</span>
                                <span className="text-sm font-black text-amber-900">රු. {grnItems.reduce((sum, item) => sum + (item.quantity * item.costPrice), 0).toFixed(2)}</span>
                              </div>
                            </div>
                          )}

                          <input type="text" placeholder="Invoice අංකය / සටහන (Optional)" value={grnDescription} onChange={(e) => setGrnDescription(e.target.value)} className="w-full p-2 border rounded text-xs" />

                          <button type="button" onClick={handleSubmitGrn} disabled={grnItems.length === 0 || !grnSupplierId} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-2 rounded text-xs font-bold transition-all">✅ GRN එක සම්පූර්ණයෙන් Submit කරන්න</button>
                        </div>
                      </div>

                      {/* Settle Supplier Payment (Balance Due අඩු කිරීම) */}
                      <div className="bg-white p-5 rounded-xl border shadow-xs h-fit">
                        <h3 className="text-xs font-black uppercase text-emerald-700 mb-3">💵 සැපයුම්කරුට මුදල් ගෙවීම</h3>
                        <form onSubmit={handleSettleSupplierPayment} className="space-y-3">
                          <select required value={supplierPayment.supplierId} onChange={(e) => setSupplierPayment({ ...supplierPayment, supplierId: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 text-gray-700 font-bold">
                            <option value="">සැපයුම්කරු තෝරන්න...</option>
                            {suppliers.map(s => (
                              <option key={s._id} value={s._id}>{s.name} (ගෙවීමට ඇත: රු.{s.balanceDue?.toFixed(2)})</option>
                            ))}
                          </select>
                          <input type="number" required placeholder="ගෙවන ලද මුදල (රු.)" value={supplierPayment.amount} onChange={(e) => setSupplierPayment({ ...supplierPayment, amount: e.target.value })} className="w-full p-2 border rounded text-xs font-black text-emerald-700" />
                          <button type="submit" className="w-full bg-emerald-600 text-white py-2 rounded text-xs font-bold">ගෙවීම සටහන් කරන්න 🎉</button>
                        </form>
                      </div>
                    </div>

                    {/* Suppliers Table */}
                    <div className="bg-white rounded-xl border shadow-xs overflow-hidden lg:col-span-2 h-fit">
                      <div className="p-4 border-b bg-gray-50">
                        <h3 className="text-xs font-black uppercase text-slate-800">🚚 ලියාපදිංචි සැපයුම්කරුවන් ({suppliers.length} Suppliers)</h3>
                        <p className="text-[10px] text-gray-400 mt-0.5">💡 සම්පූර්ණ ගණුදෙනු ඉතිහාසය බැලීමට, Supplier කෙනෙක් click කරන්න</p>
                      </div>
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-100 text-slate-700 font-bold border-b">
                            <th className="p-3">සැපයුම්කරු නම</th>
                            <th className="p-3">දුරකථන අංකය</th>
                            <th className="p-3">ලිපිනය</th>
                            <th className="p-3 text-right">අප ගෙවීමට ඇති මුදල</th>
                            <th className="p-3 text-center">ක්‍රියාවන්</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 font-medium">
                          {suppliers.length === 0 && (
                            <tr><td colSpan="5" className="p-6 text-center text-gray-400">තවම සැපයුම්කරුවන් ලියාපදිංචි කර නැත</td></tr>
                          )}
                          {suppliers.map((s) => (
                            <tr key={s._id} onClick={() => setViewSupplierDetails(s)} className="hover:bg-blue-50/60 cursor-pointer transition-colors">
                              <td className="p-3 font-bold text-slate-900 hover:text-blue-600 hover:underline">{s.name}</td>
                              <td className="p-3 text-gray-500">{s.phone}</td>
                              <td className="p-3 text-gray-500">{s.address || "-"}</td>
                              <td className="p-3 text-right font-black text-red-600">රු. {s.balanceDue?.toFixed(2) || "0.00"}</td>
                              <td className="p-3 text-center space-x-1.5">
                                <button onClick={(e) => { e.stopPropagation(); handleEditSupplierClick(s); }} className="bg-amber-500 text-white px-2 py-1 rounded text-[10px] font-bold">Edit</button>
                                <button onClick={(e) => { e.stopPropagation(); handleDeleteSupplierClick(s._id); }} className="bg-red-600 text-white px-2 py-1 rounded text-[10px] font-bold">Delete</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 🛠️ NEW: Supplier Details Modal - සම්පූර්ණ Purchase/Payment Ledger History එක */}
                {viewSupplierDetails && (
                  <div
                    className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
                    onClick={() => setViewSupplierDetails(null)}
                  >
                    <div
                      className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col relative"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Header */}
                      <div className="p-4 border-b bg-slate-900 text-white rounded-t-xl flex justify-between items-start">
                        <div>
                          <h3 className="text-sm font-black flex items-center gap-1.5">🚚 {viewSupplierDetails.name}</h3>
                          <p className="text-[11px] text-gray-300 mt-0.5">{viewSupplierDetails.phone}{viewSupplierDetails.address ? ` • ${viewSupplierDetails.address}` : ""}</p>
                        </div>
                        <button onClick={() => setViewSupplierDetails(null)} className="text-gray-300 hover:text-white font-black text-lg leading-none">✕</button>
                      </div>

                      {/* Balance Summary */}
                      <div className="p-4 bg-red-50 border-b border-red-100 flex justify-between items-center">
                        <span className="text-xs font-bold text-red-700">දැනට අප ගෙවීමට ඇති මුදල (Balance Due):</span>
                        <span className="text-lg font-black text-red-700">රු. {viewSupplierDetails.balanceDue?.toFixed(2) || "0.00"}</span>
                      </div>

                      {/* Ledger History (newest first) */}
                      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                        <h4 className="text-[10px] font-black uppercase text-gray-400 mb-1">ගණුදෙනු ඉතිහාසය (Transaction History)</h4>

                        {(!viewSupplierDetails.ledger || viewSupplierDetails.ledger.length === 0) && (
                          <p className="text-xs text-gray-400 text-center py-8">තවම ගණුදෙනු කිසිවක් සටහන් වී නැත</p>
                        )}

                        {[...(viewSupplierDetails.ledger || [])]
                          .sort((a, b) => new Date(b.date) - new Date(a.date))
                          .map((entry, index) => (
                            <div
                              key={index}
                              className={`p-3 rounded-lg border ${
                                entry.type === "purchase" ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"
                              }`}
                            >
                              <div className="flex justify-between items-start">
                                <div>
                                  <span className={`text-[10px] font-black uppercase px-1.5 py-0.5 rounded-full ${
                                    entry.type === "purchase" ? "bg-amber-200 text-amber-800" : "bg-emerald-200 text-emerald-800"
                                  }`}>
                                    {entry.type === "purchase" ? "📦 Stock ලැබීම" : "💵 ගෙවීම"}
                                  </span>
                                  <p className="text-[10px] text-gray-500 mt-1">{new Date(entry.date).toLocaleString()}</p>
                                </div>
                                <span className={`text-sm font-black ${entry.type === "purchase" ? "text-amber-800" : "text-emerald-700"}`}>
                                  {entry.type === "purchase" ? "+" : "-"} රු. {entry.amount?.toFixed(2)}
                                </span>
                              </div>

                              {entry.description && (
                                <p className="text-[11px] text-gray-600 mt-1.5 italic">{entry.description}</p>
                              )}

                              {/* Purchase items breakdown */}
                              {entry.items && entry.items.length > 0 && (
                                <div className="mt-2 bg-white/70 rounded border border-amber-100 divide-y divide-amber-100">
                                  {entry.items.map((it, i) => (
                                    <div key={i} className="flex justify-between px-2 py-1 text-[10px]">
                                      <span className="text-gray-700 font-medium">
                                        {it.productName} <span className="text-gray-400">({it.quantity} × රු.{it.costPrice?.toFixed(2)})</span>
                                        {it.stockMode === "set" && <span className="ml-1 text-[8px] bg-purple-100 text-purple-700 px-1 rounded-full font-black">SET</span>}
                                      </span>
                                      <span className="font-bold text-gray-800">රු.{it.subtotal?.toFixed(2)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                )}
                {/* 🆕 Customer Credit Ledger Modal */}
{activeCustomerDetails && (
  <div
    className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
    onClick={() => setViewCustomerDetails(null)}
  >
    <div
      className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col relative"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="p-4 border-b bg-slate-900 text-white rounded-t-xl flex justify-between items-start">
        <div>
          <h3 className="text-sm font-black flex items-center gap-1.5">👤 {activeCustomerDetails.name}</h3>
          <p className="text-[11px] text-gray-300 mt-0.5">{activeCustomerDetails.phone}</p>
        </div>
        <button onClick={() => setViewCustomerDetails(null)} className="text-gray-300 hover:text-white font-black text-lg leading-none">✕</button>
      </div>

      <div className="p-4 bg-red-50 border-b border-red-100 flex justify-between items-center">
        <span className="text-xs font-bold text-red-700">දැනට තියෙන මුළු ණය හිඟය:</span>
        <span className="text-lg font-black text-red-700">රු. {activeCustomerDetails.creditBalance?.toFixed(2) || "0.00"}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        <h4 className="text-[10px] font-black uppercase text-gray-400 mb-1">ණය ගණුදෙනු ඉතිහාසය (Credit History)</h4>

        {(!activeCustomerDetails.creditHistory || activeCustomerDetails.creditHistory.length === 0) && (
          <p className="text-xs text-gray-400 text-center py-8">තවම ණය ගණුදෙනු කිසිවක් සටහන් වී නැත</p>
        )}

        {[...(activeCustomerDetails.creditHistory || [])]
          .sort((a, b) => new Date(b.date) - new Date(a.date))
          .map((entry, index) => {
            const isCreditGiven = entry.amount >= 0;
            return (
              <div key={index} className={`p-3 rounded-lg border ${isCreditGiven ? "bg-red-50 border-red-200" : "bg-emerald-50 border-emerald-200"}`}>
                <div className="flex justify-between items-start">
                  <div>
                    <span className={`text-[10px] font-black uppercase px-1.5 py-0.5 rounded-full ${isCreditGiven ? "bg-red-200 text-red-800" : "bg-emerald-200 text-emerald-800"}`}>
                      {isCreditGiven ? "📕 ණයට ගත්තා" : "💵 ගෙවීම / සරිකිරීම"}
                    </span>
                    <p className="text-[10px] text-gray-500 mt-1">{new Date(entry.date).toLocaleString()}</p>
                  </div>
                  <span className={`text-sm font-black ${isCreditGiven ? "text-red-700" : "text-emerald-700"}`}>
                    {isCreditGiven ? "+" : "-"} රු. {Math.abs(entry.amount).toFixed(2)}
                  </span>
                </div>
                {entry.description && <p className="text-[11px] text-gray-600 mt-1.5 italic">{entry.description}</p>}
              </div>
            );
          })}
      </div>
    </div>
  </div>
)}
                {adminSubTab === "sales" && (
                  <div className="space-y-6">
                    {/* Top Stat Boxes Widget */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-white p-4 rounded-xl border shadow-xs"><p className="text-[10px] font-bold text-gray-400 uppercase">මුළු බිල්පත් ගණන</p><p className="text-xl font-black text-slate-900">{salesSummary.totalSalesCount}</p></div>
                      <div className="bg-white p-4 rounded-xl border shadow-xs"><p className="text-[10px] font-bold text-gray-400 uppercase">මුළු දළ ආදායම</p><p className="text-xl font-black text-blue-600">රු. {salesSummary.totalRevenue?.toFixed(2)}</p></div>
                      <div className="bg-white p-4 rounded-xl border shadow-xs"><p className="text-[10px] font-bold text-gray-400 uppercase">මුළු ශුද්ධ ලාභය</p><p className="text-xl font-black text-emerald-600">රු. {salesSummary.totalProfit?.toFixed(2)}</p></div>
                      <div className="bg-white p-4 rounded-xl border shadow-xs"><p className="text-[10px] font-bold text-gray-400 uppercase">පොතේ ඇති මුළු ණය</p><p className="text-xl font-black text-red-600">රු. {salesSummary.breakdown?.creditSales?.toFixed(2)}</p></div>
                    </div>

                    {/* Sales History Log Table */}
                    <div className="bg-white rounded-xl border shadow-xs overflow-hidden">
                      <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
                        <h3 className="text-xs font-black uppercase text-slate-800">📊 දිනපතා සිදුකල විකුණුම් ඉතිහාසය (Sales Logs)</h3>
                        {salesSummary.sales?.length > 0 && (
                          <button onClick={handleClearAllSales} className="bg-red-50 hover:bg-red-600 text-red-600 hover:text-white border border-red-200 px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all">🧹 සියල්ල ඉවත් කරන්න</button>
                        )}
                      </div>
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-100 text-slate-700 font-bold border-b">
                            <th className="p-3">Invoice No</th>
                            <th className="p-3">දිනය සහ වේලාව</th>
                            <th className="p-3">කැෂියර්</th>
                            <th className="p-3">ගෙවීම් ක්‍රමය</th>
                            <th className="p-3 text-right">බිල් මුදල</th>
                            <th className="p-3 text-right">ලැබුණු ලාභය</th>
                            <th className="p-3 text-center">ක්‍රියාවන්</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 font-medium">
                          {salesSummary.sales?.map((sale) => (
                            <tr key={sale._id} className="hover:bg-slate-50/80">
                              <td className="p-3 font-mono font-bold text-slate-700">{sale.invoiceNo || `#${sale._id.slice(-8).toUpperCase()}`}</td>
                              <td className="p-3 text-gray-500">{new Date(sale.createdAt).toLocaleString()}</td>
                              <td className="p-3 font-bold">{sale.cashier || "Cashier"}</td>
                              <td className="p-3"><span className={`px-2 py-0.5 rounded-sm font-bold text-[10px] ${sale.paymentMethod === 'Cash' ? 'bg-emerald-100 text-emerald-700' : sale.paymentMethod === 'Credit' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{sale.paymentMethod}</span></td>
                              <td className="p-3 text-right font-black text-slate-900">රු. {sale.totalAmount.toFixed(2)}</td>
                              <td className="p-3 text-right text-emerald-600">රු. {sale.totalProfit.toFixed(2)}</td>
                              <td className="p-3 text-center">
                                <button onClick={() => { const ref = sale.invoiceNo || sale._id; setReturnInvoiceSearch(ref); setActiveTab("returns"); handleSearchInvoiceForReturn(null, ref); }} className="bg-amber-100 hover:bg-amber-600 text-amber-700 hover:text-white px-2 py-1 rounded text-[10px] font-bold transition-all mr-1">🔄 Return</button>
                                <button onClick={() => handleVoidSale(sale._id)} className="bg-red-100 hover:bg-red-600 text-red-600 hover:text-white px-2 py-1 rounded text-[10px] font-bold transition-all">VOID ✕</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 🖨️ INVOICE PRINT LAYOUT */}
      <div className="hidden print:block p-4 w-[80mm] text-black font-mono text-xs bg-white">
        <div className="text-center font-bold text-sm">--- SmartStore ---</div>
        <div className="text-center text-[9px] text-gray-700">No. 123/A, Kandy Road, Kadawatha</div>
        <div className="text-center text-[9px] text-gray-700">071-2683025 / 078-1533835</div>
        {/* <hr className="border-dashed border-black my-1" /> */}
        {/* <div className="text-center font-black text-[13px] tracking-wider border border-red-600 rounded px-2 py-1 my-1 inline-block mx-auto w-full">
          {lastInvoiceNo || "N/A"}
        </div> */}
        <hr className="border-dotted border-black my-2" />
        <div className="text-[9px] space-y-0.5">
          
          <div className="grid grid-cols-[65px_1fr]">
            <span className="font-bold">බිල්ප​ත් අංකය</span>
            <span>: {lastInvoiceNo || "N/A"}</span>
          </div>

          <div className="grid grid-cols-[65px_1fr]">
            <span className="font-bold">අයකැමි</span>
            <span>: {user.username}</span>
          </div>

          <div className="grid grid-cols-[65px_1fr]">
            <span className="font-bold">දිනය</span>
            <span>
              : {new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}
            </span>
          </div>
        </div>
        <hr className="border-dotted border-black my-2" />
        
        {/* Table Headers */}
        <div className="text-[10px] font-bold">භාණ්ඩ​ය &</div>
        <div className="grid grid-cols-12 font-bold text-[10px] border-b border-dotted pb-0.5 mb-1 text-center bg-gray-100 p-0.5">
          <div className="col-span-4">ප්‍රමාණය</div>
          <div className="col-span-3">සා.මිල</div>
          <div className="col-span-2">අපේ මිල</div>
          <div className="col-span-3 text-right">එකතුව</div>
        </div>

        {/* Table Rows */}
        <div className="space-y-1.5">
          {cart.map((item, index) => {
            const discPercent = parseFloat(item.discountPercent || item.discount) || 0;
            const originalPrice = parseFloat(item.price);
            const discountAmount = (originalPrice * discPercent) / 100;
            const finalPrice = originalPrice - discountAmount;
            const qtyParsed = parseFloat(item.qty) || 0;

            return (
              <div key={(item._id, index)} className="text-[10px] border-b border-dotted pb-1">
                <div className="font-bold text-[11px]">{index + 1}. {item.name}</div>
                <div className="grid grid-cols-12 text-slate-900 mt-0.5">
                  <div className="col-span-4 text-center font-semibold">{formatQtyWithUnit(item.qty, item.unit)}</div>
                  <div className="col-span-3 text-center">{Number(item.marketPrice || item.price).toFixed(2)}</div>
                  <div className="col-span-2 text-center">{originalPrice.toFixed(2)}</div>
                  <div className="col-span-3 text-right font-black">{(finalPrice * qtyParsed).toFixed(2)}</div>
                </div>
                {discPercent > 0 && (
                  <div className="text-[9px] text-red-600 font-bold italic pl-1">
                    ↳ ({discPercent}% විශේෂ වට්ට​ම්)
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Financial Summary */}
        <div className="space-y-1 mt-2 text-[11px] pt-2">
          <div className="flex justify-between font-bold text-sm">
            <span>මුළු එකතුව</span>
            <span className="border-b-4 border-double border-t pt-1 pb-1">රු. {calculateTotal().toFixed(2)}</span>
          </div>
         
          
          {paymentMethod === "Credit" && (
            <div className="text-gray-700 flex justify-between border-b border-dotted pb-1 pt-1">
            <span>ගෙවූ මුදල (Amount Paid)</span>
            <span className="font-bold">
              රු. {(paymentMethod === "Credit" ? (amountPaid === "" ? 0 : parseFloat(amountPaid)) : calculateTotal()).toFixed(2)}
            </span>
          </div>
          )}
          
          
          {paymentMethod === "Credit" && (
            <div className="flex justify-between  font-bold border-b border-dotted pt-1 pb-1">
              <span className="text-red-600">ගෙවීමට ඇති මුද​ල (Credit Amount)</span>
              <span className="text-red-600">රු. {(calculateTotal() - (amountPaid === "" ? 0 : parseFloat(amountPaid))).toFixed(2)}</span>
            </div>
          )}

          {paymentMethod === "Cash" && (
            <>
              <div className="flex justify-between border-b border-dotted pb-1 pt-1 font-bold text-gray-700"><span>ලැබුණු මුදල (Cash):</span><span>රු. {parseFloat(cashReceived || 0).toFixed(2)}</span></div>
              <div className="flex justify-between border-b border-dotted pb-1 font-bold text-slate-900"><span>ඉතිරි මුදල (Balance):</span><span>රු. {balanceAmount.toFixed(2)}</span></div>
            </>
          )}

          <div className="text-gray-700 text-[9px] flex justify-between border-b border-dotted pb-1 pt-1">
            <span>මුළු භාණ්ඩ ගණ​න (No. of Items)</span>
            <span>
              {cart.length}
            </span>
          </div>

        </div>

        {/* TOTAL SAVINGS BOX */}
        {cart.reduce((sum, item) => {
          const discP = parseFloat(item.discountPercent || item.discount) || 0;
          const marketP = parseFloat(item.marketPrice || item.price);
          const priceP = parseFloat(item.price);
          const totalSavedPerItem = (marketP - priceP) + ((priceP * discP) / 100);
          return sum + (totalSavedPerItem * parseFloat(item.qty || 0));
        }, 
        0) > 0 && (
          <div className="mt-3 p-1.5 border border-black border-dashed text-center bg-slate-50">
            <div className="font-bold text-[10px]">ඔබට ලැබුණු මුළු ලාභය</div>
            <div className="font-black text-xs mt-0.5">
              Rs.{cart.reduce((sum, item) => {
                const discP = parseFloat(item.discountPercent || item.discount) || 0;
                const marketP = parseFloat(item.marketPrice || item.price);
                const priceP = parseFloat(item.price);
                const totalSavedPerItem = (marketP - priceP) + ((priceP * discP) / 100);
                return sum + (totalSavedPerItem * parseFloat(item.qty || 0));
              }, 0).toFixed(2)}
            </div>
          </div>
        )
        }

        <hr className="border-dashed border-black my-2" />
        <div className="text-center font-bold text-[9px] uppercase tracking-wider">Thank you! Come Again.</div>
      </div>
    </div>
  );
}

export default App;