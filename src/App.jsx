import { useState, useEffect } from "react";
import { flushSync } from "react-dom";
import axios from "axios";
import { db } from "./db";

// 🛠️ HOSTING CONFIGURATION: Localhost සහ Render.com දෙකටම ගැලපෙන සේ පොදු URL එකක් සාදා ඇත
// Render එකට දැමූ පසු "http://localhost:5008/api" වෙනුවට Render Live URL එක දමන්න
const API_BASE_URL = "http://localhost:5008/api"; 

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

function App() {
  const [activeTab, setActiveTab] = useState("billing");
  const [adminSubTab, setAdminSubTab] = useState("products");
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(true);

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

  // Product CRUD States
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState(null);
  const [productForm, setProductForm] = useState({ name: "", marketPrice: "", price: "", costPrice: "", stock: "", barcode: "", discountPercent: "", unit: "Kg", category: "Grocery", minStockLevel: "5", preferredSupplierId: "", expiryDate: "" });

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
  const [exchangeProductSearch, setExchangeProductSearch] = useState("");

  // 🆕 EXPIRY TRACKING State
  const [expiringProducts, setExpiringProducts] = useState([]);

  // 🆕 PRINT RECEIPT: අන්තිමට Checkout කරපු Sale එකේ Professional Invoice Number එක (Return search එකට use වෙන්නේ මේකයි)
  const [lastInvoiceNo, setLastInvoiceNo] = useState(null);
  const [lastSaleIsOffline, setLastSaleIsOffline] = useState(false);

  // Emergency Temp Item Form State (For Any Role)
  const [tempItemForm, setTempItemForm] = useState({ name: "", price: "", qty: "1", unit: "Kg", barcode: "" });

  const [showTempItemModal, setShowTempItemModal] = useState(false);

  // Custom Toast State
  const [toasts, setToasts] = useState([]);

  let barcodeBuffer = "";
  let lastKeyTime = Date.now();

  // Helper to trigger custom beautiful toast notifications
  const showToast = (message, type = "success") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4000);
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
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [products]);

  // Barcode Scanner Logic
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === "INPUT") return;
      if (activeTab !== "billing" || !user) return;
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
  }, [products, cart, activeTab, user]);

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
    if (window.confirm("මෙම පාරිභෝගිකයාව මකා දැමීමට අවශ්‍ය බව විශ්වාසද? 🗑️")) {
      try {
        // 🛠️ Port 5008 සහ API Base URL එකට ගැළපෙන සේ සකසා ඇත
        await axios.delete(`${API_BASE_URL}/customers/delete/${id}`);
        showToast("මකා දැමීම සාර්ථකයි!");
        fetchCustomers();
      } catch (error) { showToast("මකා දැමීම අසාර්ථකයි!", "error"); }
    }
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
    if (window.confirm("මෙම සැපයුම්කරුව මකා දැමීමට අවශ්‍ය බව විශ්වාසද? 🗑️")) {
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
      unit: product.unit || "Kg",
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
  const addToCart = (product) => {
    // 🆕 EXPIRY CHECK: කල් ඉකුත් වූ භාණ්ඩයක් විකිණීමට ඉඩ නොදේ
    const expiryStatus = getExpiryStatus(product);
    if (expiryStatus === "expired") {
      return showToast(`🚫 "${product.name}" කල් ඉකුත් වී ඇත! (${new Date(product.expiryDate).toLocaleDateString()}) - මෙය විකිණීමට ඉඩ නොදේ.`, "error");
    }
    if (expiryStatus === "expiring") {
      showToast(`⚠️ "${product.name}" ළඟදීම කල් ඉකුත් වේ (${new Date(product.expiryDate).toLocaleDateString()})! අවධානයෙන් විකුණන්න.`, "warning");
    }

    const existingIndex = cart.findIndex((item) => item._id === product._id);
    if (existingIndex !== -1) {
      const newCart = [...cart];
      newCart[existingIndex].qty = parseFloat(newCart[existingIndex].qty) + 1;
      setCart(newCart);
    } else {
      setCart([...cart, { ...product, qty: 1 }]);
    }
    showToast(`"${product.name}" බිලට එකතු කලා`);
  };

  // Emergency Temp Item Add Logic (Does not hit DB, directly into Cart)
  const handleAddTempItemToCart = (e) => {
    e.preventDefault();
    if (!tempItemForm.name || !tempItemForm.price || !tempItemForm.qty) {
      return showToast("කරුණාකර නම, මිල සහ ප්‍රමාණය ඇතුලත් කරන්න!", "warning");
    }

    const tempProduct = {
      // 🛠️ Unsaved අලුත් අයිටම් එකට Front-end එකෙන් හදන Dynamic ID එකක් ලබාදෙයි
      _id: `temp_${Date.now()}`, 
      name: `${tempItemForm.name}`,
      price: parseFloat(tempItemForm.price),
      marketPrice: parseFloat(tempItemForm.price),
      costPrice: parseFloat(tempItemForm.price) * 0.85, 
      stock: parseFloat(tempItemForm.qty) + 10, 
      barcode: tempItemForm.barcode || "N/A",
      discount: 0,
      discountPercent: 0,
      unit: tempItemForm.unit,
      qty: parseFloat(tempItemForm.qty),
      isTemporary: true 
    };

    setCart([...cart, tempProduct]);
    showToast(`"${tempProduct.name}" තාවකාලිකව බිලට එකතු කලා! 📥`, "warning");
    setTempItemForm({ name: "", price: "", qty: "1", unit: "Kg", barcode: "" });
  };

  const updateCartQtyDirectly = (id, value) => {
    const newCart = cart.map((item) => {
      if (item._id === id) return { ...item, qty: value };
      return item;
    });
    setCart(newCart);
  };

  const updateQty = (id, amount) => {
    const newCart = cart.map((item) => {
      if (item._id === id) {
        const newQty = parseFloat(item.qty) + amount;
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
      const availableStock = dbProduct ? dbProduct.stock : 0;
      if (parseFloat(item.qty) > availableStock) {
        return showToast(`🚫 තොග නොමැත! "${item.name}" තොගයේ ඇත්තේ: ${availableStock} ${item.unit || 'Kg'}`, "error");
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
  };

  const handleVoidSale = async (saleId) => {
    if (window.confirm("මෙම බිල්පත අවලංගු කිරීමට අවශ්‍යද?")) {
      try {
        await axios.post(`${API_BASE_URL}/products/void-sale/${saleId}`);
        showToast("බිල්පත සාර්ථකව අවලංගු කලා!");
        fetchProducts();
        fetchSalesSummary();
        fetchCustomers();
      } catch (error) { showToast("අසාර්ථකයි!", "error"); }
    }
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
      expiryDate: productForm.expiryDate || null // 🆕 EXPIRY DATE
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
      setProductForm({ name: "", marketPrice: "", price: "", costPrice: "", stock: "", barcode: "", discountPercent: "", unit: "Kg", category: "Grocery", minStockLevel: "5", preferredSupplierId: "", expiryDate: "" });
      fetchProducts();
      fetchExpiringProducts();
    } catch (error) { showToast("ක්‍රියාවලිය අසාර්ථකයි!", "error"); }
  };

  const handleEditClick = (product) => {
    setIsEditing(true);
    setEditId(product._id);
    setProductForm({
      name: product.name.replace("⚠️ ", "").replace(" (Unsaved)", ""),
      marketPrice: product.marketPrice || "",
      price: product.price,
      costPrice: product.costPrice || "",
      stock: product.stock,
      barcode: product.barcode || "",
      discountPercent: product.discount || "", 
      unit: product.unit || "Kg",
      category: product.category || "Grocery",
      minStockLevel: product.minStockLevel ?? 5,
      preferredSupplierId: product.preferredSupplierId || "",
      expiryDate: product.expiryDate ? new Date(product.expiryDate).toISOString().split("T")[0] : "" // 🆕
    });
  };

  const handleDeleteClick = async (id) => {
    if (window.confirm("මෙම භාණ්ඩය මකා දැමීමට අවශ්‍ය බව විශ්වාසද? 🗑️")) {
      try {
        await axios.delete(`${API_BASE_URL}/products/delete/${id}`);
        showToast("භාණ්ඩය සාර්ථකව මකා දැමුවා.");
        fetchProducts();
      } catch (error) { showToast("මකා දැමීම අසාර්ථකයි!", "error"); }
    }
  };

  const filteredBillingProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(billingSearch.toLowerCase()) || 
      (p.barcode && p.barcode.includes(billingSearch));
    const matchesCategory = billingCategoryFilter === "All" || (p.category || "Grocery") === billingCategoryFilter;
    return matchesSearch && matchesCategory;
  });

  // 🛠️ NEW: Category tab එක් එකකට කීයක් products තියෙනවද කියලා ගණන් කිරීම (badge count සඳහා)
  const billingCategoryCounts = products.reduce((counts, p) => {
    const cat = p.category || "Grocery";
    counts[cat] = (counts[cat] || 0) + 1;
    return counts;
  }, {});

  const filteredAdminProducts = products.filter(p => 
    p.name.toLowerCase().includes(adminProductSearch.toLowerCase()) || 
    (p.barcode && p.barcode.includes(adminProductSearch))
  );

  // 🛠️ NEW (Step 3 - Low Stock Reorder Alert): අවම තොග මට්ටමට වඩා අඩු Products ලැයිස්තුව
  const lowStockProducts = products.filter(p => p.stock <= (p.minStockLevel ?? 5));

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
      <div className="flex items-center justify-center h-screen bg-gray-200">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-96 border">
          <h2 className="text-2xl font-bold text-center text-blue-600 mb-6">POS System Login 🔑</h2>
          <form onSubmit={handleLogin} className="space-y-4">
            <input type="text" placeholder="Username" required value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })} className="w-full p-2 border rounded" />
            <input type="password" placeholder="Password" required value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} className="w-full p-2 border rounded" />
            {loginError && <p className="text-xs text-red-500 font-bold">{loginError}</p>}
            <button type="submit" className="w-full bg-blue-600 text-white p-2 rounded font-bold">Login</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100 font-sans antialiased text-gray-800 relative">
      
      {/* CUSTOM TOAST CONTAINER WINDOW */}
      <div className="fixed top-4 right-4 z-50 space-y-2 pointer-events-none print:hidden max-w-sm w-full">
        {toasts.map((toast) => (
          <div key={toast.id} className={`p-4 rounded-xl shadow-2xl border flex items-center gap-3 text-sm font-bold text-white transition-all transform animate-bounce duration-300 ${
            toast.type === "error" ? "bg-red-600 border-red-700" :
            toast.type === "warning" ? "bg-amber-500 border-amber-600 text-slate-900" :
            "bg-slate-900 border-slate-950 text-emerald-400"
          }`}>
            <span>{toast.type === "error" ? "🛑" : toast.type === "warning" ? "⚠️" : "✨"}</span>
            <div className="flex-1">{toast.message}</div>
          </div>
        ))}
      </div>

      <div className="print:hidden flex flex-col h-full">
        {/* Header */}
        <header className="bg-slate-900 text-white px-6 py-2.5 flex justify-between items-center shadow-md">
          <h1 className="text-xl font-black tracking-wider flex items-center gap-2">SmartStore <span className="bg-blue-600 px-2 py-0.5 rounded text-xs font-bold">PRO-POS v2.0</span></h1>
          <div className="flex space-x-3">
            <button onClick={() => setActiveTab("billing")} className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${activeTab === "billing" ? "bg-blue-600 text-white shadow" : "text-gray-300 hover:bg-slate-800"}`}>Billing Window</button>
            <button onClick={() => { setActiveTab("returns"); resetReturnUI(); }} className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${activeTab === "returns" ? "bg-amber-600 text-white shadow" : "text-gray-300 hover:bg-slate-800"}`}>🔄 Returns / Exchange</button>
            {user.role === "admin" && <button onClick={() => setActiveTab("admin")} className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${activeTab === "admin" ? "bg-blue-600 text-white shadow" : "text-gray-300 hover:bg-slate-800"}`}>Admin Dashboard</button>}
            
            {/* 🛠Header Logout එකේදී LocalStorage එකත් Clear කරයි */}
            <button onClick={() => { localStorage.removeItem("pos_user"); setUser(null); }} className="bg-red-600 hover:bg-red-700 px-3 py-1.5 text-xs font-bold rounded">Logout</button>
          </div>
        </header>

        {/* Main Content */}
        <div className="flex flex-1 overflow-hidden">
          {activeTab === "billing" && (
            <div className="flex w-full h-full flex-col lg:flex-row">
              
              {/* LEFT SIDE: POS CART PANEL */}
              <div className="w-full lg:w-3/5 p-4 bg-white flex flex-col justify-between shadow-inner border-r border-gray-200">
                <div className="flex flex-col h-full overflow-hidden">
                  <div className="flex justify-between items-center border-b pb-2 mb-3">
                    <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">🛒 වත්මන් ​බිල්පත <span className="bg-slate-200 text-slate-700 text-xs px-2 py-0.5 rounded-full">{cart.length} Items</span></h2>
                    <button onClick={() => { setCart([]); showToast("බිල්පත හිස් කලා"); }} className="text-xs text-red-500 hover:underline font-bold">බිල හිස් කරන්න (Clear All)</button>
                  </div>

                  {/* Cart List */}
                  <div className="flex-1 overflow-y-auto pr-1">
                    {cart.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-gray-400 py-20">
                        <span className="text-5xl">📥</span>
                        <p className="mt-2 text-sm font-medium">බිල්පත හිස්ව පවතී. භාණ්ඩ ඇතුලත් කරන්න.</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {cart.map((item) => {
                          const discP = parseFloat(item.discountPercent || item.discount) || 0;
                          const originalP = parseFloat(item.price);
                          const finalP = originalP - (originalP * discP) / 100;
                          return (
                            <div key={item._id} className={`flex items-center justify-between p-3 rounded-xl border shadow-sm hover:bg-slate-100 transition-all ${item.isTemporary ? 'bg-amber-50/70 border-amber-300' : 'bg-slate-50 border-slate-200'}`}>
                              <div className="w-1/3">
                                <span className="font-bold text-sm block text-slate-900 truncate">{item.name}</span>
                                <span className="text-[11px] text-gray-500 block">1 {item.unit || "Kg"} = රු. {originalP.toFixed(2)}</span>
                              </div>
                              
                              <div className="flex items-center space-x-1 bg-white p-1 rounded-lg border border-slate-300">
                                <button onClick={() => updateQty(item._id, -1)} className="bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded font-bold text-xs">-1</button>
                                {item.unit === "Kg" && <button onClick={() => updateQty(item._id, -0.1)} className="bg-slate-100 hover:bg-slate-200 px-1 py-1 rounded text-[10px] text-gray-600">-100g</button>}
                                <input 
                                  type="number" 
                                  step="0.001"
                                  value={item.qty} 
                                  onChange={(e) => updateCartQtyDirectly(item._id, e.target.value)}
                                  className="w-16 text-center font-black text-sm text-blue-700 focus:outline-none" 
                                />
                                {item.unit === "Kg" && <button onClick={() => updateQty(item._id, 0.1)} className="bg-slate-100 hover:bg-slate-200 px-1 py-1 rounded text-[10px] text-gray-600">+100g</button>}
                                <button onClick={() => updateQty(item._id, 1)} className="bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded font-bold text-xs">+1</button>
                                <span className="text-xs text-gray-500 font-bold px-1">{item.unit || "Kg"}</span>
                              </div>

                              <div className="text-right w-1/4">
                                <span className="font-black text-sm block text-slate-900">රු. {(finalP * parseFloat(item.qty || 0)).toFixed(2)}</span>
                                {discP > 0 && <span className="text-[10px] bg-red-100 text-red-600 font-bold px-1.5 py-0.2 rounded">{discP}% OFF</span>}
                              </div>
                              <button onClick={() => { setCart(cart.filter(c => c._id !== item._id)); showToast("භාණ්ඩය ඉවත් කලා"); }} className="text-gray-400 hover:text-red-500 font-bold p-1">✕</button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Checkout Footer */}
                <div className="border-t border-slate-200 pt-3 mt-2 bg-slate-50 p-4 rounded-xl">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                    {['Cash', 'Card', 'QR', 'Credit'].map((method) => (
                      <button key={method} type="button" onClick={() => setPaymentMethod(method)} className={`py-2 rounded-xl font-black text-xs tracking-wider transition-all ${paymentMethod === method ? 'bg-blue-600 text-white shadow-md' : 'bg-white border text-gray-600 hover:bg-gray-100'}`}>
                        {method.toUpperCase()}
                      </button>
                    ))}
                  </div>

                  {/* UI Dynamic Inputs */}
                  <div className="bg-white p-3 rounded-xl border border-slate-200 mb-2">
                    {paymentMethod === "Credit" ? (
                      <div>
                        <label className="text-[11px] font-bold text-red-700 block mb-1">💳 පාරිභෝගිකයා දැනට ගෙවන මුදල (Paid Amount):</label>
                        <input type="number" placeholder="ණය බිලෙන් අඩුවන මුදල (ගෙවන්නේ නැත්නම් හිස්ව තබන්න)" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} className="w-full p-2 border rounded text-sm font-black text-slate-800 bg-red-50/30" />
                        <div className="bg-slate-900 text-white p-3 mt-3 rounded-xl shadow relative">
                  <h3 className="text-xs font-bold text-gray-400 mb-2">👤 CREDIT ACCOUNT LEDGER CONNECTOR</h3>

                  <div className="relative">
                    <div className="flex items-center space-x-2">
                      {/* 🛠️ UPDATED: දැන් type කරන කොටම (Live) suggestions පෙන්වයි, Enter → තෝරාගැනීම */}
                      <input
                        type="text"
                        placeholder="නම හෝ දුරකථන අංකය type කරන්න..."
                        value={searchPhone}
                        onChange={(e) => setSearchPhone(e.target.value)}
                        onKeyDown={handleCustomerSearchKeyDown}
                        autoComplete="off"
                        className="p-2 border rounded-lg bg-slate-800 text-white flex-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      {customerSearchLoading && (
                        <span className="text-[10px] text-amber-400 whitespace-nowrap">සොයමින්...</span>
                      )}
                    </div>

                    {/* 🛠️ NEW: Live Search Suggestions Dropdown */}
                    {showCustomerDropdown && customerSuggestions.length > 0 && (
                      <ul className="absolute z-20 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {customerSuggestions.map((customer, index) => (
                          <li
                            key={customer._id}
                            onClick={() => handleSelectCustomer(customer)}
                            onMouseEnter={() => setHighlightedCustomerIndex(index)}
                            className={`px-3 py-2 cursor-pointer border-b border-slate-700 last:border-b-0 text-xs transition-colors ${
                              index === highlightedCustomerIndex ? "bg-blue-700/60" : "hover:bg-slate-700"
                            }`}
                          >
                            <p className="font-bold text-white">{customer.name}</p>
                            <p className="text-[10px] text-gray-400">{customer.phone}</p>
                          </li>
                        ))}
                      </ul>
                    )}

                    {showCustomerDropdown && customerSuggestions.length === 0 && !customerSearchLoading && (
                      <div className="absolute z-20 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-lg px-3 py-2 text-[11px] text-gray-400">
                        පාරිභෝගිකයෙකු සොයාගත නොහැක!
                      </div>
                    )}
                  </div>

                  {selectedCustomer && (
                    <div className="mt-2 bg-blue-900/50 p-2 rounded border border-blue-700 flex justify-between items-center text-xs">
                      <div>Account: <span className="font-bold text-yellow-400">{selectedCustomer.name}</span></div>
                      <div className="text-red-400 font-bold">ණය: රු. {selectedCustomer.creditBalance}/=</div>
                    </div>
                  )}
                </div>
                      </div>
                    ) : paymentMethod === "Cash" ? (
                      <div className="grid grid-cols-2 gap-3 bg-emerald-50/50 p-1 rounded-lg">
                        <div>
                          <label className="text-[11px] font-bold text-emerald-800 block mb-1">💵 ලැබුණු මුදල (Cash):</label>
                          <input type="number" placeholder="0.00" value={cashReceived} onChange={(e) => setCashReceived(e.target.value)} className="w-full p-2 border rounded text-sm font-black text-emerald-700 bg-white" />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-emerald-800 block mb-1">🔄 ඉතිරි මුදල (Balance):</label>
                          <div className="p-2 bg-white border border-emerald-300 rounded-lg font-black text-sm text-red-600 text-center">රු. {balanceAmount.toFixed(2)}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-2 text-xs font-bold text-blue-600">
                        📱 {paymentMethod.toUpperCase()} හරහා සම්පූර්ණ මුදලම ගෙවීම් සිදු කෙරේ.
                      </div>
                    )}
                  </div>

                  <div className="flex justify-between items-center text-xl font-black text-slate-900 border-t pt-2">
                    <span>NET TOTAL:</span>
                    <span className="text-2xl text-blue-600">රු. {calculateTotal().toFixed(2)}/=</span>
                  </div>
                  <button onClick={handleCheckoutAndPrint} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-3 rounded-xl shadow-lg text-lg mt-2 transition-all">
                    PROCEED & PRINT INVOICE (F12) 🖨️
                  </button>
                </div>
              </div>

              {/* RIGHT SIDE: PRODUCTS PANEL & EMERGENCY QUICK ADD */}
              <div className="w-full lg:w-2/5 p-4 flex flex-col space-y-4 overflow-hidden">
                
                {/* Emergency Unsaved Item Adding Widget */}
                {/* 🔘 Trigger Button - ඔයාට ඕන තැනකට JSX return එකේ දාන්න */}
                  <button
                    onClick={() => setShowTempItemModal(true)}
                    className="flex justify-center items-center  gap-2 bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-900 font-black px-3 py-2 rounded-lg text-xs transition-all"
                  >
                    <span className="text-base">🚨</span>
                    හදිසි අවස්ථා - තාවකාලික භාණ්ඩ ඇතුලත් කිරීම
                    <span className="text-base">➕</span>

                  </button>

                  {/* 🪟 Modal Popup */}
                  {showTempItemModal && (
                    <div
                      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
                      onClick={() => setShowTempItemModal(false)}
                    >
                      <div
                        className="bg-linear-to-br from-amber-50 to-orange-100/60 p-4 rounded-xl border border-amber-300 shadow-xl w-full max-w-md relative"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => setShowTempItemModal(false)}
                          className="absolute top-3 right-3 text-amber-800 hover:text-amber-950 font-black text-lg leading-none"
                        >
                          ✕
                        </button>

                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-base">🚨</span>
                          <h3 className="text-xs font-black text-amber-900 tracking-wider uppercase pr-4">
                            හදිසි අවස්ථා - තාවකාලික භාණ්ඩ ඇතුලත් කිරීම
                          </h3>
                        </div>
                        <p className="text-[10px] text-amber-800 font-semibold mb-3">
                          Database එකේ නැති අලුත් බඩු, DB එකට සේව් නොකර කෙලින්ම මෙම බිලට පමණක් එකතු කිරීමට පහත විස්තර පුරවන්න.
                        </p>

                        <form
                          onSubmit={(e) => {
                            handleAddTempItemToCart(e);
                            setShowTempItemModal(false);
                          }}
                          className="space-y-2"
                        >
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="text"
                              placeholder="භාණ්ඩයේ නම"
                              value={tempItemForm.name}
                              onChange={(e) => setTempItemForm({ ...tempItemForm, name: e.target.value })}
                              className="p-2 text-xs bg-white border border-amber-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold"
                            />
                            <input
                              type="number"
                              placeholder="විකුණුම් මිල (රු.)"
                              value={tempItemForm.price}
                              onChange={(e) => setTempItemForm({ ...tempItemForm, price: e.target.value })}
                              className="p-2 text-xs bg-white border border-amber-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold"
                            />
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <input
                              type="number"
                              step="0.001"
                              placeholder="ප්‍රමාණය"
                              value={tempItemForm.qty}
                              onChange={(e) => setTempItemForm({ ...tempItemForm, qty: e.target.value })}
                              className="p-2 text-xs bg-white border border-amber-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold"
                            />
                            <select
                              value={tempItemForm.unit}
                              onChange={(e) => setTempItemForm({ ...tempItemForm, unit: e.target.value })}
                              className="p-2 text-xs bg-white border border-amber-300 rounded-lg font-bold"
                            >
                              <option value="Kg">Kilogram (Kg)</option>
                              <option value="G">Gram (G)</option>
                              <option value="Pieces">Pieces</option>
                              <option value="Packet">Packet</option>
                              <option value="Bottle">Bottle</option>
                            </select>
                            <input
                              type="text"
                              placeholder="Barcode (Optional)"
                              value={tempItemForm.barcode}
                              onChange={(e) => setTempItemForm({ ...tempItemForm, barcode: e.target.value })}
                              className="p-2 text-xs bg-white border border-amber-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500"
                            />
                          </div>
                          <button
                            type="submit"
                            className="w-full bg-amber-600 hover:bg-amber-700 text-white font-black py-2 rounded-lg text-xs transition-all shadow-sm"
                          >
                            ➕ Add to Bill (Without Database)
                          </button>
                        </form>
                      </div>
                    </div>
                  )}

                

                {/* 🛠️ UPDATED: Category Sidebar (vertical, scrollable) + Search/Grid column - Real POS layout */}
                <div className="flex-1 flex gap-3 min-h-0">

                  {/* Category Sidebar */}
                  <div className="w-16 sm:w-20 shrink-0 flex flex-col gap-1.5 overflow-y-auto pr-1">
                    <button
                      onClick={() => setBillingCategoryFilter("All")}
                      className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-xl border text-center transition-all ${
                        billingCategoryFilter === "All"
                          ? "bg-blue-600 text-white border-blue-600 shadow-md"
                          : "bg-white text-gray-600 border-gray-200 hover:border-blue-400 hover:text-blue-600"
                      }`}
                    >
                      <span className="text-base leading-none">🗂️</span>
                      <span className="text-[9px] font-bold leading-tight truncate w-full">සියල්ල</span>
                      <span className={`text-[9px] px-1 rounded-full ${billingCategoryFilter === "All" ? "bg-white/20" : "bg-gray-100"}`}>{products.length}</span>
                    </button>

                    {PRODUCT_CATEGORIES.map((cat) => (
                      <button
                        key={cat.value}
                        onClick={() => setBillingCategoryFilter(cat.value)}
                        className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-xl border text-center transition-all ${
                          billingCategoryFilter === cat.value
                            ? "bg-blue-600 text-white border-blue-600 shadow-md"
                            : "bg-white text-gray-600 border-gray-200 hover:border-blue-400 hover:text-blue-600"
                        }`}
                      >
                        <span className="text-base leading-none">{cat.icon}</span>
                        <span className="text-[9px] font-bold leading-tight truncate w-full">{cat.value}</span>
                        <span className={`text-[9px] px-1 rounded-full ${billingCategoryFilter === cat.value ? "bg-white/20" : "bg-gray-100"}`}>{billingCategoryCounts[cat.value] || 0}</span>
                      </button>
                    ))}
                  </div>

                  {/* Search + Product Grid (scrolls independently from the sidebar) */}
                  <div className="flex-1 flex flex-col gap-3 min-w-0 overflow-y pr-1">
                    <div className="relative top-0 z-10 bg-gray-100/95 backdrop-blur-sm pb-1 -mt-0.5">
                      <input type="text" placeholder="🔍  භාණ්ඩයේ නම හෝ බාර්කෝඩ් එක ඇතුලත් කරන්න..." value={billingSearch} onChange={(e) => setBillingSearch(e.target.value)} className="w-full p-2.5 pl-9 border rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium text-sm" />
                      <span className="absolute left-3 top-3 text-gray-400 text-sm">🔍</span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {filteredBillingProducts.length === 0 && (
                        <div className="col-span-2 sm:col-span-3 flex flex-col items-center justify-center text-gray-400 py-10">
                          <span className="text-3xl mb-2">🔍</span>
                          <p className="text-xs font-medium">මෙම වර්ගයේ / නමින් භාණ්ඩයක් හම්බ වුනේ නැහැ</p>
                        </div>
                      )}
                      {filteredBillingProducts.map((product) => {
                        const discP = parseFloat(product.discount) || 0; 
                        const finalPrice = product.price - (product.price * discP) / 100;
                        const isLowStock = product.stock <= (product.minStockLevel ?? 5);
                        const expStatus = getExpiryStatus(product);
                        
                        return (
                          <button 
                            key={product._id} 
                            onClick={() => addToCart(product)} 
                            className={`p-3 rounded-xl shadow-sm text-left border relative transition-all active:scale-95 ${
                              expStatus === "expired"
                                ? 'border-gray-400 bg-gray-200 text-gray-500 cursor-not-allowed opacity-70'
                                : isLowStock 
                                ? 'border-red-500 bg-red-100 text-red-900 animate-pulse ring-2 ring-red-400 shadow-md shadow-red-200' 
                                : expStatus === "expiring"
                                ? 'border-amber-400 bg-amber-50 hover:border-amber-500'
                                : 'bg-white hover:border-blue-400'
                            }`}
                          >
                            {discP > 0 && <span className="absolute top-1 right-1 bg-red-500 text-white text-[9px] px-1.5 rounded-full font-bold">{discP}% OFF</span>}
                            <div className="font-bold text-slate-800 text-xs truncate">{product.name}</div>
                            <div className="text-blue-600 font-black text-sm mt-1">රු. {finalPrice.toFixed(2)}</div>
                            <div className={`text-[10px] font-bold mt-1 ${isLowStock ? 'text-red-700 bg-red-200 px-1 py-0.5 rounded w-fit' : 'text-gray-400'}`}>
                              {isLowStock ? `⚠️ අඩු තොග (Low): ${product.stock}` : `තොග: ${product.stock}`} {product.unit || "Kg"}
                            </div>
                            {expStatus === "expired" && <div className="text-[10px] font-black mt-1 text-white bg-gray-600 px-1 py-0.5 rounded w-fit">⛔ EXPIRED</div>}
                            {expStatus === "expiring" && <div className="text-[10px] font-black mt-1 text-amber-800 bg-amber-200 px-1 py-0.5 rounded w-fit">⏳ {new Date(product.expiryDate).toLocaleDateString()}</div>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
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
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">ගැනුම් මිල (Cost Price):</label>
                          <input type="number" required value={productForm.costPrice} onChange={(e) => setProductForm({ ...productForm, costPrice: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white" />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">ආරම්භක තොගය (Stock Qty):</label>
                          <input type="number" required value={productForm.stock} onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white" />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">බාර්කෝඩ් අංකය (Barcode - Optional):</label>
                          <input type="text" value={productForm.barcode} onChange={(e) => setProductForm({ ...productForm, barcode: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white" />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">භාණ්ඩයේ ප්‍රමාණය මනින ඒකකය (Unit):</label>
                          <select value={productForm.unit} onChange={(e) => setProductForm({ ...productForm, unit: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 text-gray-700">
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
                        <div className="col-span-2 md:col-span-4 flex justify-end gap-2 pt-2">
                          {isEditing && <button type="button" onClick={() => { setIsEditing(false); setProductForm({ name: "", marketPrice: "", price: "", costPrice: "", stock: "", barcode: "", discountPercent: "", unit: "Kg", category: "Grocery", minStockLevel: "5", preferredSupplierId: "", expiryDate: "" }); }} className="bg-gray-500 text-white px-4 py-2 rounded text-xs font-bold">Cancel</button>}
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
                              <td className="p-3 text-center font-black"><span className={`px-2 py-0.5 rounded-sm ${p.stock > (p.minStockLevel ?? 5) ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-600'}`}>{p.stock} {p.unit || 'Kg'}</span></td>
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
                                    <td className="p-3 text-center"><span className="bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-black">{p.stock} {p.unit || "Kg"}</span></td>
                                    <td className="p-3 text-center text-gray-500">{p.minStockLevel ?? 5} {p.unit || "Kg"}</td>
                                    <td className="p-3 text-center font-black text-emerald-700">{getSuggestedReorderQty(p)} {p.unit || "Kg"}</td>
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
                                <td className="p-3 text-center">{p.stock} {p.unit || "Kg"}</td>
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

                {/* 🆕 RETURN / EXCHANGE HISTORY Sub-tab */}
                {adminSubTab === "returns" && (
                  <div className="space-y-6">
                    <div className="bg-white p-5 rounded-xl border shadow-xs">
                      <h3 className="text-sm font-black uppercase text-slate-800 mb-1">🔄 Return / Exchange History</h3>
                      <p className="text-xs text-gray-500">සිදු කරන ලද සියලුම Return, Refund සහ Exchange transactions</p>
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
                            <tr key={c._id} className="hover:bg-slate-50/80">
                              <td className="p-3 font-bold text-slate-900">{c.name}</td>
                              <td className="p-3 text-gray-500">{c.phone}</td>
                              <td className="p-3 text-right font-black text-red-600">රු. {c.creditBalance?.toFixed(2) || "0.00"}</td>
                              <td className="p-3 text-center space-x-1.5">
                                <button onClick={() => handleEditCustomerClick(c)} className="bg-amber-500 text-white px-2 py-1 rounded text-[10px] font-bold">Edit</button>
                                <button onClick={() => handleDeleteCustomerClick(c._id)} className="bg-red-600 text-white px-2 py-1 rounded text-[10px] font-bold">Delete</button>
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
                                <option key={p._id} value={p._id}>{p.name} (වත්මන් තොගය: {p.stock} {p.unit || "Kg"})</option>
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
                                      <p className="text-[10px] text-gray-500">{item.quantity} {item.unit} × රු.{item.costPrice.toFixed(2)}</p>
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
                      <div className="p-4 border-b bg-gray-50"><h3 className="text-xs font-black uppercase text-slate-800">📊 දිනපතා සිදුකල විකුණුම් ඉතිහාසය (Sales Logs)</h3></div>
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
        <div className="text-[9px] pt-3 space-y-0.5">
          {lastSaleIsOffline && (
            <div className="text-red-600 font-bold">
              ⚠️ Offline බිල - Internet ලැබුනාට පස්සේ Sync වේ. Sync වෙනකම් Return/Exchange කළ නොහැක.
            </div>
          )}

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
            const unitSymbols = { Kg: "kg", G: "g", Pieces: "Pieces", Packet: "Packet", Bottle: "Bottle" };
            const unitSymbol = unitSymbols[item.unit] || "";

            return (
              <div key={item._id, index} className="text-[10px] border-b border-dotted pb-1">
                <div className="font-bold text-[11px]">{index + 1}. {item.name}</div>
                <div className="grid grid-cols-12 text-slate-900 mt-0.5">
                  <div className="col-span-4 text-center font-semibold">{qtyParsed} {unitSymbol}</div>
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