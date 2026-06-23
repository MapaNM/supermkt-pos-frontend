import { useState, useEffect } from "react";
import axios from "axios";
import { db } from "./db";

// 🛠️ HOSTING CONFIGURATION: Localhost සහ Render.com දෙකටම ගැලපෙන සේ පොදු URL එකක් සාදා ඇත
// Render එකට දැමූ පසු "http://localhost:5008/api" වෙනුවට Render Live URL එක දමන්න
const API_BASE_URL = "https://supermkt-pos-backend.onrender.com/api"; 

function App() {
  const [activeTab, setActiveTab] = useState("billing");
  const [adminSubTab, setAdminSubTab] = useState("products");
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(true);

  // Search States
  const [billingSearch, setBillingSearch] = useState("");
  const [adminProductSearch, setAdminProductSearch] = useState("");

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
  const [productForm, setProductForm] = useState({ name: "", marketPrice: "", price: "", costPrice: "", stock: "", barcode: "", discountPercent: "", unit: "Kg" });

  // Emergency Temp Item Form State (For Any Role)
  const [tempItemForm, setTempItemForm] = useState({ name: "", price: "", qty: "1", unit: "Pcs", barcode: "" });

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
      }
    }
  }, [user]);

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
          console.error("ბიල Sync කිරීම අසාර්ථකයි:", err);
        }
      }
      showToast("✅ සියලුම Offline බිල්පත් සාර්ථකව සර්වර් එකට යැවුවා! 🎉");
      fetchProducts(); 
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [products]);

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

  const handleSearchCustomer = async (e) => {
    e.preventDefault();
    try {
      // 🛠️ UPDATED: දැන් නම හෝ දුරකථන අංකය යන දෙකෙන්ම සෙවිය හැක
      const response = await axios.get(`${API_BASE_URL}/customers/search/${searchPhone}`);
      setSelectedCustomer(response.data);
      showToast("පාරිභෝගික ගිණුම සාර්ථකව සම්බන්ධ කලා! 👤");
    } catch (error) { showToast("මෙම නමින් හෝ අංකයෙන් පාරිභෝගිකයෙකු සොයාගත නොහැක!", "warning"); }
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

  // --- BILLING LOGIC ---
  const addToCart = (product) => {
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
      name: `⚠️ ${tempItemForm.name} (Unsaved)`,
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
    setTempItemForm({ name: "", price: "", qty: "1", unit: "Pcs", barcode: "" });
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

    // Stock Validation (Skip temp unsaved items)
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

    // Backend එකට සහ Offline DB එකට යැවීමට පොදුවේ සකස් කරගත් Cart Object එක
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
      // 🌐 ONLINE MODE: සර්වර් එකට දත්ත යැවීමට උත්සාහ කරයි
      await axios.post(`${API_BASE_URL}/products/checkout`, checkoutData);
      
      window.print();
      resetBillingUI();
      showToast("ඉන්වොයිසිය සාර්ථකව මුද්‍රණය කලා! 🖨️✨");
      fetchProducts();
      fetchCustomers();

    } catch (error) {
      // 📴 OFFLINE MODE: ඉන්ටර්නෙට් නැතිනම් හෝ සර්වර් එක Down නම් ක්‍රියාත්මක වේ
      if (!navigator.onLine || error.message === "Network Error") {
        try {
          // IndexedDB එකට "pending" එකක් ලෙස බිල ඇතුලත් කරයි
          await db.offlineSales.add({
            ...checkoutData,
            createdAt: new Date().toISOString(),
            status: "pending"
          });

          window.print(); // ඉන්ටර්නෙට් නැතත් බිල මුද්‍රණය වේ
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

  // 🛠️ Helper Function: බිලක් අවසන් වූ පසු UI එක Reset කරන කොටස (Code එක පිරිසිදුව තබා ගැනීමට)
  const resetBillingUI = () => {
    setCart([]);
    setSelectedCustomer(null);
    setSearchPhone("");
    setCashReceived("");
    setAmountPaid(""); 
    setBalanceAmount(0);
    setPaymentMethod("Cash");
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
      unit: productForm.unit
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
      setProductForm({ name: "", marketPrice: "", price: "", costPrice: "", stock: "", barcode: "", discountPercent: "", unit: "Kg" });
      fetchProducts();
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
      unit: product.unit || "Kg"
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

  const filteredBillingProducts = products.filter(p => 
    p.name.toLowerCase().includes(billingSearch.toLowerCase()) || 
    (p.barcode && p.barcode.includes(billingSearch))
  );

  const filteredAdminProducts = products.filter(p => 
    p.name.toLowerCase().includes(adminProductSearch.toLowerCase()) || 
    (p.barcode && p.barcode.includes(adminProductSearch))
  );

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
          <h1 className="text-xl font-black tracking-wider flex items-center gap-2">GROCERY <span className="bg-blue-600 px-2 py-0.5 rounded text-xs font-bold">PRO-POS v2.0</span></h1>
          <div className="flex space-x-3">
            <button onClick={() => setActiveTab("billing")} className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${activeTab === "billing" ? "bg-blue-600 text-white shadow" : "text-gray-300 hover:bg-slate-800"}`}>Billing Window</button>
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
                    <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">🛒 වත්මන් බිල්පත <span className="bg-slate-200 text-slate-700 text-xs px-2 py-0.5 rounded-full">{cart.length} Items</span></h2>
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
              <div className="w-full lg:w-2/5 p-4 overflow-y-auto flex flex-col space-y-4">
                
                {/* Emergency Unsaved Item Adding Widget */}
                <div className="bg-linear-to-br from-amber-50 to-orange-100/60 p-4 rounded-xl border border-amber-300 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-base">🚨</span>
                    <h3 className="text-xs font-black text-amber-900 tracking-wider uppercase">හදිසි අවස්ථා - තාවකාලික භාණ්ඩ ඇතුලත් කිරීම</h3>
                  </div>
                  <p className="text-[10px] text-amber-800 font-semibold mb-3">Database එකේ නැති අලුත් බඩු, DB එකට සේව් නොකර කෙලින්ම මෙම බිලට පමණක් එකතු කිරීමට පහත විස්තර පුරවන්න.</p>
                  
                  <form onSubmit={handleAddTempItemToCart} className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" placeholder="භාණ්ඩයේ නම" value={tempItemForm.name} onChange={(e) => setTempItemForm({ ...tempItemForm, name: e.target.value })} className="p-2 text-xs bg-white border border-amber-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold" />
                      <input type="number" placeholder="විකුණුම් මිල (රු.)" value={tempItemForm.price} onChange={(e) => setTempItemForm({ ...tempItemForm, price: e.target.value })} className="p-2 text-xs bg-white border border-amber-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold" />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <input type="number" step="0.001" placeholder="ප්‍රමාණය" value={tempItemForm.qty} onChange={(e) => setTempItemForm({ ...tempItemForm, qty: e.target.value })} className="p-2 text-xs bg-white border border-amber-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 font-bold" />
                      <select value={tempItemForm.unit} onChange={(e) => setTempItemForm({ ...tempItemForm, unit: e.target.value })} className="p-2 text-xs bg-white border border-amber-300 rounded-lg font-bold">
                        <option value="Pcs">Pcs</option>
                        <option value="Kg">Kg</option>
                      </select>
                      <input type="text" placeholder="Barcode (Optional)" value={tempItemForm.barcode} onChange={(e) => setTempItemForm({ ...tempItemForm, barcode: e.target.value })} className="p-2 text-xs bg-white border border-amber-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500" />
                    </div>
                    <button type="submit" className="w-full bg-amber-600 hover:bg-amber-700 text-white font-black py-2 rounded-lg text-xs transition-all shadow-sm">
                      ➕ ඩේටාබේස් රහිතව බිලට පමණක් ඇතුලත් කරන්න
                    </button>
                  </form>
                </div>

                <div className="bg-slate-900 text-white p-3 rounded-xl shadow">
                  <h3 className="text-xs font-bold text-gray-400 mb-2">👤 CREDIT ACCOUNT LEDGER CONNECTOR</h3>
                  <form onSubmit={handleSearchCustomer} className="flex space-x-2">
                    {/* 🛠️ UPDATED: Placeholder එක නම හෝ දුරකථන අංකය ලෙස වෙනස් කර ඇත */}
                    <input type="text" placeholder="නම හෝ දුරකථන අංකය ඇතුලත් කරන්න..." value={searchPhone} onChange={(e) => setSearchPhone(e.target.value)} className="p-2 border rounded-lg bg-slate-800 text-white flex-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-3 text-xs font-bold rounded-lg">Link</button>
                  </form>
                  {selectedCustomer && (
                    <div className="mt-2 bg-blue-900/50 p-2 rounded border border-blue-700 flex justify-between items-center text-xs">
                      <div>Account: <span className="font-bold text-yellow-400">{selectedCustomer.name}</span></div>
                      <div className="text-red-400 font-bold">ණය: රු. {selectedCustomer.creditBalance}/=</div>
                    </div>
                  )}
                </div>

                <div className="relative">
                  <input type="text" placeholder="🔍  භාණ්ඩයේ නම හෝ බාර්කෝඩ් ගසන්න..." value={billingSearch} onChange={(e) => setBillingSearch(e.target.value)} className="w-full p-2.5 pl-9 border rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium text-sm" />
                  <span className="absolute left-3 top-3 text-gray-400 text-sm">🔍</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {filteredBillingProducts.map((product) => {
                    const discP = parseFloat(product.discount) || 0; 
                    const finalPrice = product.price - (product.price * discP) / 100;
                    const isLowStock = product.stock <= 5;
                    
                    return (
                      <button 
                        key={product._id} 
                        onClick={() => addToCart(product)} 
                        className={`p-3 rounded-xl shadow-sm text-left border relative transition-all active:scale-95 ${
                          isLowStock 
                            ? 'border-red-500 bg-red-100 text-red-900 animate-pulse ring-2 ring-red-400 shadow-md shadow-red-200' 
                            : 'bg-white hover:border-blue-400'
                        }`}
                      >
                        {discP > 0 && <span className="absolute top-1 right-1 bg-red-500 text-white text-[9px] px-1.5 rounded-full font-bold">{discP}% OFF</span>}
                        <div className="font-bold text-slate-800 text-xs truncate">{product.name}</div>
                        <div className="text-blue-600 font-black text-sm mt-1">රු. {finalPrice.toFixed(2)}</div>
                        <div className={`text-[10px] font-bold mt-1 ${isLowStock ? 'text-red-700 bg-red-200 px-1 py-0.5 rounded w-fit' : 'text-gray-400'}`}>
                          {isLowStock ? `⚠️ අඩු තොග (Low): ${product.stock}` : `තොග: ${product.stock}`} {product.unit || "Kg"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Admin Panels */}
          {activeTab === "admin" && user.role === "admin" && (
            <div className="flex flex-col w-full h-full p-6 overflow-y-auto">
              <div className="flex space-x-4 mb-4 border-b pb-2">
                <button onClick={() => setAdminSubTab("products")} className={`pb-2 px-4 font-bold ${adminSubTab === "products" ? "border-b-4 border-blue-600 text-blue-600" : "text-gray-500"}`}>භාණ්ඩ කළමනාකරණය</button>
                <button onClick={() => setAdminSubTab("sales")} className={`pb-2 px-4 font-bold ${adminSubTab === "sales" ? "border-b-4 border-blue-600 text-blue-600" : "text-gray-500"}`}>විකුණුම් වාර්තා</button>
                <button onClick={() => setAdminSubTab("customers")} className={`pb-2 px-4 font-bold ${adminSubTab === "customers" ? "border-b-4 border-blue-600 text-blue-600" : "text-gray-500"}`}>📝 ණය පොත & පාරිභෝගිකයෝ</button>
              </div>

              {adminSubTab === "products" && (
                <div className="flex flex-col space-y-4">
                  <input type="text" placeholder="🔍 භාණ්ඩ සෙවීම..." value={adminProductSearch} onChange={(e) => setAdminProductSearch(e.target.value)} className="w-full p-2 border rounded-xl shadow-sm" />
                  <div className="flex flex-col lg:flex-row gap-6">
                    <div className="w-full lg:w-1/3 bg-white p-5 rounded-xl shadow border h-fit">
                      <h3 className="font-bold text-gray-700 mb-3">{isEditing ? "භාණ්ඩය සංස්කරණය ✏️" : "අලුත් භාණ්ඩයක් ඇතුලත් කිරීම ➕"}</h3>
                      <form onSubmit={handleFormSubmit} className="space-y-3">
                        <input type="text" placeholder="භාණ්ඩයේ නම" required value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} className="w-full p-2 border rounded" />
                        <div className="grid grid-cols-2 gap-2">
                          <input type="number" placeholder="සාමාන්‍ය මිල (MRP)" required value={productForm.marketPrice} onChange={(e) => setProductForm({ ...productForm, marketPrice: e.target.value })} className="p-2 border rounded" />
                          <input type="number" placeholder="අපේ විකුණුම් මිල" required value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} className="p-2 border rounded" />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input type="number" placeholder="ගත් මිල (Cost Price)" required value={productForm.costPrice} onChange={(e) => setProductForm({ ...productForm, costPrice: e.target.value })} className="p-2 border rounded" />
                          <input type="number" placeholder="වට්ටම් ප්‍රතිශතය (% වලින්)" value={productForm.discountPercent} onChange={(e) => setProductForm({ ...productForm, discountPercent: e.target.value })} className="p-2 border rounded bg-red-50 text-red-700 font-bold" />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input type="number" step="0.001" placeholder="තොගය" required value={productForm.stock} onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })} className="p-2 border rounded" />
                          <select value={productForm.unit} onChange={(e) => setProductForm({ ...productForm, unit: e.target.value })} className="p-2 border rounded bg-white font-bold">
                            <option value="Kg">කිලෝග්‍රෑම් (Kg)</option>
                            <option value="Pcs">කෑලි / පැකට් (Pcs)</option>
                          </select>
                        </div>
                        <input type="text" placeholder="Barcode (Optional)" value={productForm.barcode} onChange={(e) => setProductForm({ ...productForm, barcode: e.target.value })} className="w-full p-2 border rounded" />
                        <button type="submit" className="w-full bg-blue-600 text-white p-2 rounded font-bold">{isEditing ? "Update Product" : "Save Product"}</button>
                      </form>
                    </div>
                    
                    <div className="w-full lg:w-2/3 bg-white p-5 rounded-xl shadow overflow-x-auto border">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-100 border-b text-slate-700 font-bold">
                            <th className="p-3">නම</th>
                            <th>ඒකකය</th>
                            <th>සා. මිල</th>
                            <th>අපේ මිල</th>
                            <th className="text-teal-700">ගත් මිල</th>
                            <th className="text-red-600">වට්ටම (%)</th>
                            <th>තොගය</th>
                            <th>ක්‍රියාකාරකම්</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredAdminProducts.map((p) => (
                            <tr key={p._id} className="border-b hover:bg-slate-50">
                              <td className="p-3 font-semibold text-slate-800">{p.name}</td>
                              <td className="font-bold text-gray-500">{p.unit || "Kg"}</td>
                              <td className="font-bold text-gray-600">රු. {p.marketPrice}</td>
                              <td className="font-bold text-blue-600">රු. {p.price}</td>
                              <td className="text-teal-700 font-bold">රු. {p.costPrice}</td>
                              <td className="text-red-600 font-bold">{p.discount || 0}%</td>
                              <td className="font-medium">{p.stock}</td>
                              <td className="p-2 flex space-x-1">
                                <button onClick={() => handleEditClick(p)} className="text-blue-600 bg-blue-50 px-2 py-1 rounded font-bold hover:bg-blue-100">Edit</button>
                                <button onClick={() => handleDeleteClick(p._id)} className="text-red-600 bg-red-50 px-2 py-1 rounded font-bold hover:bg-red-100">Delete</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Sales Panel */}
              {adminSubTab === "sales" && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-white text-center font-bold">
                    <div className="bg-emerald-600 p-4 rounded-xl shadow"><div>මුළු ආදායම</div><div className="text-2xl font-black mt-1">රු. {salesSummary.totalRevenue?.toFixed(2)}</div></div>
                    <div className="bg-teal-600 p-4 rounded-xl shadow"><div>ශුද්ධ ලාභය</div><div className="text-2xl font-black mt-1">රු. {salesSummary.totalProfit?.toFixed(2)}</div></div>
                    <div className="bg-slate-800 p-4 rounded-xl shadow"><div>Total Invoices</div><div className="text-2xl font-black mt-1">{salesSummary.totalSalesCount}</div></div>
                  </div>
                  <div className="bg-white p-4 rounded-xl border shadow-sm">
                    <table className="w-full text-left text-xs">
                      <thead><tr className="bg-gray-100 border-b p-2"><th>දිනය/වේලාව</th><th>ගෙවීම් ක්‍රමය</th><th>මුළු මුදල</th><th>ක්‍රියාකාරකම්</th></tr></thead>
                      <tbody>
                        {salesSummary.sales?.map((sale) => (
                          <tr key={sale._id} className="border-b hover:bg-slate-50">
                            <td className="p-2.5">{new Date(sale.createdAt).toLocaleString()}</td>
                            <td className="font-semibold">{sale.paymentMethod}</td>
                            <td className="font-bold text-blue-600">රු. {sale.totalAmount.toFixed(2)}</td>
                            <td><button onClick={() => handleVoidSale(sale._id)} className="text-red-500 font-bold hover:underline">Void Bill</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Customers Panel */}
              {adminSubTab === "customers" && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-white p-5 rounded-xl shadow border h-fit">
                    <h3 className="font-bold mb-4">{isEditingCustomer ? "👤 විස්තර සංස්කරණය" : "👤 අලුත් පාරිභෝගිකයෙක්"}</h3>
                    <form onSubmit={handleCustomerSubmit} className="space-y-4">
                      <input type="text" placeholder="නම" required value={customerForm.name} onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })} className="w-full p-2 border rounded" />
                      <input type="text" placeholder="දුරකථන අංකය" required value={customerForm.phone} onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })} className="w-full p-2 border rounded" />
                      <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded font-bold">{isEditingCustomer ? "Update" : "Save"}</button>
                    </form>
                  </div>
                  <div className="bg-white p-5 rounded-xl shadow border h-fit">
                    <h3 className="font-bold mb-4">💰 ණය මුදල් පියවීම</h3>
                    <form onSubmit={handleSettleCredit} className="space-y-4">
                      <select required value={creditPayment.customerId} onChange={(e) => setCreditPayment({ ...creditPayment, customerId: e.target.value })} className="w-full p-2 border rounded bg-white">
                        <option value="">-- තෝරන්න --</option>
                        {customers.map(c => <option key={c._id} value={c._id}>{c.name} - ණය රු.{c.creditBalance}</option>)}
                      </select>
                      <input type="number" placeholder="පියවන මුදල (රු.)" required value={creditPayment.amount} onChange={(e) => setCreditPayment({ ...creditPayment, amount: e.target.value })} className="w-full p-2 border rounded" />
                      <button type="submit" className="w-full bg-green-600 text-white py-2 rounded font-bold">Settle</button>
                    </form>
                  </div>
                  
                  {/* 🛠️ UPDATED: ණය පොතෙහි එක් එක් ගනුදෙනුකරුවාගේ ණය ඉතිහාසය (Logs) වෙන වෙනම පෙන්වන කොටස */}
                  <div className="bg-white p-5 rounded-xl shadow border">
                    <h3 className="font-bold mb-4">📝 ණය පොත / පාරිභෝගිකයෝ</h3>
                    <div className="space-y-3 overflow-y-auto max-h-[60vh]">
                      {customers.map((c) => (
                        <div key={c._id} className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex flex-col space-y-2 shadow-sm">
                          
                          <div className="flex justify-between items-center border-b pb-1.5">
                            <div>
                              <div className="font-black text-xs text-slate-800">{c.name}</div>
                              <div className="text-[10px] text-gray-500">{c.phone}</div>
                            </div>
                            <div className="text-right">
                              <span className="text-[10px] text-gray-400 block font-bold">මුළු ණය එකතුව</span>
                              <span className="text-red-600 font-black text-xs">රු. {c.creditBalance}/=</span>
                            </div>
                          </div>

                          {/* ණය ගත් ඉතිහාසය Logs ලැයිස්තුව */}
                          <div className="bg-white rounded-lg p-2 border border-gray-100 max-h-24 overflow-y-auto space-y-1">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1">📅 ණය ගත් ඉතිහාසය (Logs):</span>
                            
                            {!c.creditHistory || c.creditHistory.length === 0 ? (
                              <div className="text-[10px] text-gray-400 italic text-center py-1">ණය ඉතිහාසයක් නොමැත.</div>
                            ) : (
                              c.creditHistory.map((history, idx) => (
                                <div key={idx} className="flex justify-between items-center text-[10px] bg-slate-50 p-1 rounded border-l-2 border-red-500">
                                  <span className="text-gray-600 font-medium">
                                    {new Date(history.date).toLocaleDateString()} - {new Date(history.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                  </span>
                                  <span className="font-black text-red-600">රු. {history.amount.toFixed(2)}</span>
                                </div>
                              ))
                            )}
                          </div>

                          <div className="flex justify-end space-x-2 border-t pt-1.5 mt-1">
                            <button onClick={() => handleEditCustomerClick(c)} className="text-[10px] bg-blue-50 text-blue-600 hover:bg-blue-100 px-2.5 py-1 rounded font-bold transition-all">Edit</button>
                            <button onClick={() => handleDeleteCustomerClick(c._id)} className="text-[10px] bg-red-50 text-red-600 hover:bg-red-100 px-2.5 py-1 rounded font-bold transition-all">Delete</button>
                          </div>

                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 🖨️ INVOICE PRINT LAYOUT */}
      <div className="hidden print:block p-4 w-[80mm] text-black font-mono text-xs bg-white">
        <div className="text-center font-bold text-sm">--- ABC GROCERY ---</div>
        <div className="text-center text-[9px] text-gray-600">No. 123, Galle Road, Colombo</div>
        <hr className="border-dashed border-black my-1" />
        <div className="text-[10px] space-y-0.5">
          <div><b>බිල් අංකය:</b> IN-{Math.floor(1000 + Math.random() * 9000)}</div>
          <div><b>අයකැමි:</b> {user.username}</div>
          <div><b>දිනය:</b> {new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}</div>
        </div>
        <hr className="border-dashed border-black my-1" />
        
        {/* Table Headers */}
        <div className="grid grid-cols-12 font-bold text-[9px] border-b pb-0.5 mb-1 text-center bg-gray-100 p-0.5">
          <div className="col-span-4 text-left">ප්‍රමාණය</div>
          <div className="col-span-3">සා.මිල</div>
          <div className="col-span-2">අපේ මිල</div>
          <div className="col-span-3 text-right">එකතුව</div>
        </div>

        {/* Table Rows */}
        <div className="space-y-1.5 border-b pb-1">
          {cart.map((item) => {
            const discPercent = parseFloat(item.discountPercent || item.discount) || 0;
            const originalPrice = parseFloat(item.price);
            const discountAmount = (originalPrice * discPercent) / 100;
            const finalPrice = originalPrice - discountAmount;
            const qtyParsed = parseFloat(item.qty) || 0;
            const unitSymbol = item.unit === "Kg" ? "kg" : "Pcs";

            return (
              <div key={item._id} className="text-[10px] border-b border-dotted pb-1">
                <div className="font-bold text-[11px]">{item.name}</div>
                <div className="grid grid-cols-12 text-slate-900 mt-0.5">
                  <div className="col-span-4 text-left font-semibold">{qtyParsed} {unitSymbol}</div>
                  <div className="col-span-3 text-center">{Number(item.marketPrice || item.price).toFixed(2)}</div>
                  <div className="col-span-2 text-center">{originalPrice.toFixed(2)}</div>
                  <div className="col-span-3 text-right font-black">{(finalPrice * qtyParsed).toFixed(2)}</div>
                </div>
                {discPercent > 0 && (
                  <div className="text-[9px] text-red-600 font-bold italic pl-1">
                    ↳ ({discPercent}% විශේෂ වට්ටම්)
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Financial Summary */}
        <div className="space-y-1 mt-2 text-[11px] border-t pt-1">
          <div className="flex justify-between font-bold text-sm">
            <span>මුළු එකතුව (Total Amount)</span>
            <span>රු. {calculateTotal().toFixed(2)}</span>
          </div>
          
          <div className="flex justify-between">
            <span>ගෙවූ මුදල (Amount Paid)</span>
            <span className="font-bold">
              රු. {(paymentMethod === "Credit" ? (amountPaid === "" ? 0 : parseFloat(amountPaid)) : calculateTotal()).toFixed(2)}
            </span>
          </div>
          
          {paymentMethod === "Credit" && (
            <div className="flex justify-between text-red-600 font-bold border-t border-dashed pt-0.5">
              <span>ගෙවීමට ඇති මුදල</span>
              <span>රු. {(calculateTotal() - (amountPaid === "" ? 0 : parseFloat(amountPaid))).toFixed(2)}</span>
            </div>
          )}

          {paymentMethod === "Cash" && (
            <>
              <div className="flex justify-between border-t pt-0.5 text-gray-600"><span>ලැබුණු මුදල:</span><span>රු. {parseFloat(cashReceived || 0).toFixed(2)}</span></div>
              <div className="flex justify-between font-bold text-slate-900"><span>ඉතිරි මුදල (Balance):</span><span>රු. {balanceAmount.toFixed(2)}</span></div>
            </>
          )}
        </div>

        {/* TOTAL SAVINGS BOX */}
        {cart.reduce((sum, item) => {
          const discP = parseFloat(item.discountPercent || item.discount) || 0;
          const marketP = parseFloat(item.marketPrice || item.price);
          const priceP = parseFloat(item.price);
          const totalSavedPerItem = (marketP - priceP) + ((priceP * discP) / 100);
          return sum + (totalSavedPerItem * parseFloat(item.qty || 0));
        }, 0) > 0 && (
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
        )}

        <hr className="border-dashed border-black my-2" />
        <div className="text-center font-bold text-[9px] uppercase tracking-wider">Thank you! Come Again.</div>
      </div>
    </div>
  );
}

export default App;