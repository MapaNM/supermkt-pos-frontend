import React, { useState } from 'react';
import axios from 'axios';

const ReturnItems = ({ API_BASE_URL, showToast, fetchProducts }) => {
  const [saleId, setSaleId] = useState('');
  const [saleData, setSaleData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [returnQuantities, setReturnQuantities] = useState({}); // {_id: return_qty}

  // 🔍 1. බිල්පත් අංකයෙන් පැරණි බිල සෙවීම
  const handleSearchInvoice = async (e) => {
    e.preventDefault();
    if (!saleId.trim()) return showToast("කරුණාකර බිල්පත් අංකයක් ඇතුලත් කරන්න!", "warning");

    setLoading(true);
    setSaleData(null);
    try {
      // අපි Backend එකේ හදපු /invoice/:id API එකට කෝල් කරයි
      const response = await axios.get(`${API_BASE_URL}/products/invoice/${saleId.trim()}`);
      setSaleData(response.data);
      
      // Return Qty සේරම මුලින් 0 ලෙස සෙට් කරයි
      const initialQtys = {};
      response.data.cartItems.forEach(item => {
        initialQtys[item._id] = 0;
      });
      setReturnQuantities(initialQtys);
    } catch (error) {
      showToast(error.response?.data?.message || "ბිල සොයාගත නොහැක! ❌", "error");
    } finally {
      setLoading(false);
    }
  };

  // Qty වෙනස් කරන විට පාලනය කිරීම
  const handleQtyChange = (itemId, val, maxQty) => {
    const qty = parseInt(val) || 0;
    if (qty > maxQty) {
      showToast(`මිලදී ගත් ප්‍රමාණය (${maxQty}) ඉක්මවා Return කල නොහැක!`, "warning");
      return;
    }
    setReturnQuantities({ ...returnQuantities, [itemId]: qty });
  };

  // 🔄 2. තෝරාගත් භාණ්ඩය Return කිරීම
  const handleReturnItem = async (item) => {
    const returnQty = returnQuantities[item._id];
    if (!returnQty || returnQty <= 0) {
      return showToast("කරුණාකර Return කරන ප්‍රමාණය ඇතුලත් කරන්න!", "warning");
    }

    if (window.confirm(`"${item.name}" භාණ්ඩයෙන් ${returnQty}ක් ආපසු බාර ගැනීමට අවශ්‍යද?`)) {
      try {
        // බිලේ අයිතමයේ මුල් මිල ගණන් අනුව Refund එක ගණනය කරයි
        const refundAmount = parseFloat(item.price) * returnQty;

        await axios.post(`${API_BASE_URL}/products/return-item`, {
          saleId: saleData._id,
          productId: item._id, // Backend එකේ Stock වැඩි වෙන්න ඕන නිසා
          returnQty: returnQty,
          refundAmount: refundAmount
        });

        showToast("භාණ්ඩය සාර්ථකව Return කලා! 🔄 සාදන්නාගේ මුදල් ලාච්චුවෙන් මුදල් ගෙවන්න.", "success");
        
        // UI එක Update කිරීමට නැවත Invoice එක සර්ච් කරයි
        const updatedSale = await axios.get(`${API_BASE_URL}/products/invoice/${saleData._id}`);
        setSaleData(updatedSale.data);
        fetchProducts(); // Main Stock එක අලුත් කරයි

      } catch (error) {
        showToast(error.response?.data?.message || "Return ක්‍රියාවලිය අසාර්ථකයි!", "error");
      }
    }
  };

  return (
    <div style={{ padding: '20px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
      <h2 style={{ color: '#333', marginBottom: '20px' }}>🔄 භාණ්ඩ ආපසු බාරගැනීම (Return / Refund)</h2>
      
      {/* Search Bar */}
      <form onSubmit={handleSearchInvoice} style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
        <input 
          type="text" 
          placeholder="බිල්පත් අංකය (Sale ID/Invoice ID) ඇතුලත් කරන්න..." 
          value={saleId}
          onChange={(e) => setSaleId(e.target.value)}
          style={{ flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
        />
        <button type="submit" disabled={loading} style={{ padding: '10px 20px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          {loading ? "සොයමින්..." : "බිල සොයන්න 🔍"}
        </button>
      </form>

      {/* Invoice Data Display */}
      {saleData && (
        <div style={{ backgroundColor: 'white', padding: '15px', borderRadius: '6px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #eee', paddingBottom: '10px', marginBottom: '15px' }}>
            <div>
              <h4>බිල්පත් අංකය: <span style={{ color: '#007bff' }}>{saleData._id}</span></h4>
              <small>කැෂියර්: {saleData.cashierName} | දිනය: {new Date(saleData.createdAt).toLocaleString()}</small>
            </div>
            <div style={{ textAlign: 'right' }}>
              <h4>මුළු එකතුව: රු. {saleData.totalAmount?.toFixed(2)}</h4>
              <span style={{ backgroundColor: '#28a745', color: 'white', padding: '3px 8px', borderRadius: '4px', fontSize: '12px' }}>{saleData.paymentMethod}</span>
            </div>
          </div>

          <h5>බිල්පතේ ඇති භාණ්ඩ ලැයිස්තුව:</h5>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f1f1f1', textAlign: 'left' }}>
                <th style={{ padding: '10px' }}>භාණ්ඩයේ නම</th>
                <th style={{ padding: '10px' }}>මිල (රු.)</th>
                <th style={{ padding: '10px' }}>ගැනුම් ප්‍රමාණය</th>
                <th style={{ padding: '10px', width: '150px' }}>Return Qty</th>
                <th style={{ padding: '10px' }}>ක්‍රියාවන්</th>
              </tr>
            </thead>
            <tbody>
              {saleData.cartItems.map((item) => (
                <tr key={item._id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '10px' }}>{item.name}</td>
                  <td style={{ padding: '10px' }}>{parseFloat(item.price).toFixed(2)}</td>
                  <td style={{ padding: '10px', fontWeight: 'bold' }}>{item.qty} {item.unit || 'Pcs'}</td>
                  <td style={{ padding: '10px' }}>
                    <input 
                      type="number" 
                      min="0"
                      max={item.qty}
                      value={returnQuantities[item._id] || 0}
                      onChange={(e) => handleQtyChange(item._id, e.target.value, item.qty)}
                      disabled={item.qty === 0}
                      style={{ width: '80px', padding: '5px', borderRadius: '4px', border: '1px solid #ccc' }}
                    />
                  </td>
                  <td style={{ padding: '10px' }}>
                    <button 
                      onClick={() => handleReturnItem(item)}
                      disabled={item.qty === 0 || !returnQuantities[item._id]}
                      style={{ padding: '5px 12px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', opacity: item.qty === 0 ? 0.5 : 1 }}
                    >
                      {item.qty === 0 ? "Returned" : "Return කරන්න 🔄"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ReturnItems;