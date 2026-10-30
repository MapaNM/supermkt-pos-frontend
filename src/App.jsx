import { useState, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import axios from "axios";
import { db } from "./db";

// 🛠️ HOSTING CONFIGURATION: now decided by a Vite environment variable (VITE_API_URL) -
// so the same code works for both local dev (localhost:5173) and Vercel production without any edits.
//   local: create a .env.local file in the project root → VITE_API_URL=http://localhost:5008/api
//   Vercel: Project Settings → Environment Variables → VITE_API_URL = https://supermkt-pos-backend.onrender.com/api
// If neither is set, it defaults to the local dev backend (localhost:5008).
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5008/api";

// 🔐 AUTH: on page load, if a token was saved in localStorage from an earlier session,
// it is set as the axios default header - after that, every axios.get/
// post/put/delete call in the APP gets it automatically, with no need to attach a separate header.
const storedToken = localStorage.getItem("pos_token");
if (storedToken) {
  axios.defaults.headers.common["Authorization"] = `Bearer ${storedToken}`;
}

// 🔐 AUTH: If the token is missing/invalid/expired, the backend returns a 401 - we catch it right here,
// clear the session, and send the user back to the login screen. Without this, every button
// click would just show an "Error" toast and the user would be confused without knowing why.
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("pos_token");
      localStorage.removeItem("pos_user");
      delete axios.defaults.headers.common["Authorization"];
      // Simplest way to reset the App() component state - go back to the login screen
      if (!sessionStorage.getItem("pos_session_expired_reload")) {
        sessionStorage.setItem("pos_session_expired_reload", "1");
        window.location.reload();
      }
    }
    return Promise.reject(error);
  }
);

// 🛠️ NEW: To manage all Product Categories in one place (used by both the Admin dropdown + Billing sidebar)
const PRODUCT_CATEGORIES = [
  { value: "Grocery", label: "Grocery", icon: "👜" },
  { value: "Vegetables", label: "Vegetables", icon: "🥦" },
  { value: "Fruits", label: "Fruits", icon: "🍎" },
  { value: "Beverages", label: "Beverages", icon: "🥤" },
  { value: "Snacks", label: "Snacks", icon: "🍟" },
  { value: "Sweets", label: "Sweets", icon: "🍬" },
  { value: "Biscuits", label: "Biscuits", icon: "🍪" },
  { value: "Dairy", label: "Dairy", icon: "🥛" },
  { value: "Bakery", label: "Bakery", icon: "🍞" },
  { value: "Cosmetics", label: "Cosmetics", icon: "💄" },
  { value: "Household", label: "Household", icon: "🧴" },
  { value: "Other", label: "Other", icon: "📦" },
];

// 🛠️ NEW: Unit symbols - centralized (also handles "" for items with no Unit/Empty)
const UNIT_SYMBOLS = { Kg: "kg", G: "g", Pieces: "Pieces", Packet: "Packet", Bottle: "Bottle", "": "" };

// 🆕 HOLD BILL HELPERS: Token number (H-01, H-02… resets daily), smart label, age calculation.
const nextHoldNo = () => {
  try {
    const today = new Date().toDateString();
    const saved = JSON.parse(localStorage.getItem("pos_hold_counter") || "null");
    const n = saved && saved.date === today ? saved.n + 1 : 1;
    localStorage.setItem("pos_hold_counter", JSON.stringify({ date: today, n }));
    return n;
  } catch { return Math.floor(Date.now() / 1000) % 1000; }
};
const formatHoldNo = (n) => (n ? `H-${String(n).padStart(2, "0")}` : "—");
// For bills without a name: the names of the first 2 items (+ the remaining count)
const itemsPreview = (cart) => {
  const names = (cart || []).map((i) => i.name).filter(Boolean);
  if (names.length === 0) return "";
  return names.slice(0, 2).join(", ") + (names.length > 2 ? ` +${names.length - 2}` : "");
};
const holdAgeInfo = (heldAt, nowMs) => {
  const mins = Math.max(0, Math.floor((nowMs - new Date(heldAt).getTime()) / 60000));
  const text = mins < 1 ? "Held just now" : mins < 60 ? `${mins} min ago` : `${Math.floor(mins / 60)} hr${mins % 60 ? ` ${mins % 60} min` : ""} ago`;
  const level = mins >= 120 ? "red" : mins >= 30 ? "amber" : "normal";
  return { mins, text, level };
};

// 🆕 AUTO-SAVE DRAFT BILL: if the page is refreshed / the browser crashes /
// there is a power cut while the cashier is building a bill, the cart is not lost. Cart + Customer + Payment Method + Bill Discount +
// the paid/received amount are auto-saved to localStorage and restored when the page loads again.
// 🔐 The draft is bound to that cashier only (it is not restored if someone else logs in), and
// a draft older than 12 hours is not restored.
const BILL_DRAFT_KEY = "pos_draft_bill";
const BILL_DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const readBillDraft = () => {
  try {
    const raw = localStorage.getItem(BILL_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    const currentUser = JSON.parse(localStorage.getItem("pos_user") || "null");
    const fresh = draft?.savedAt && Date.now() - draft.savedAt <= BILL_DRAFT_MAX_AGE_MS;
    if (!draft || !Array.isArray(draft.cart) || draft.cart.length === 0 || !fresh || !currentUser || draft.cashier !== currentUser.username) {
      localStorage.removeItem(BILL_DRAFT_KEY);
      return null;
    }
    return draft;
  } catch { return null; }
};

// 🛠️ NEW: To fix JavaScript Floating-Point Precision Errors (like 0.1 + 0.2 = 0.30000000000000004)
// Rounds to 3 decimal places (Gram-level accuracy - accurate down to 1g, removes any unnecessary decimal noise beyond that)
const roundQty = (num) => Math.round((parseFloat(num) || 0) * 1000) / 1000;

// 🛠️ NEW: Format Quantity + Unit in a standard way
// - For the "Kg" Unit, if the quantity is less than 1 (e.g. 0.5 Kg) → converts to grams and shows it as "500g"
// - For all other Units, shows the normal symbol as-is (kg/Pieces/Packet/Bottle)
// - If no Unit is selected (Empty), shows only the quantity without a symbol
// 🆕 PHONE VALIDATION: Sri Lankan numbers — 10 digits starting with 0 (0771234567),
// or the same number written with a +94 / 94 country code. Spaces/dashes are
// tolerated while typing but stripped before checking.
const isValidPhone = (phone) => {
  const cleaned = (phone || "").replace(/[\s-]/g, "");
  return /^(0\d{9}|(\+94|94)\d{9})$/.test(cleaned);
};

const formatQtyWithUnit = (qty, unit) => {
  const qtyNum = roundQty(qty); // 🛠️ Floating-point drift (like 3.5500000000000007) gets cleaned up right here
  if (unit === "Kg" && qtyNum > 0 && qtyNum < 1) {
    const grams = Math.round(qtyNum * 1000);
    return `${grams}g`;
  }
  const symbol = UNIT_SYMBOLS[unit] ?? unit ?? "";
  return symbol ? `${qtyNum} ${symbol}` : `${qtyNum}`;
};

// 🆕 DASHBOARD: Daily sales Bar Chart - built with a lightweight inline SVG, without needing to install
// any extra npm library (recharts/chart.js). Since it is a single series (Revenue),
// no Legend is needed - the Title says it all. On hover, a Tooltip shows that day's Revenue/Profit/Bills.
function DailySalesChart({ data }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  if (!data || data.length === 0) return null;

  const maxRevenue = Math.max(...data.map((d) => d.revenue), 1); // 0-data uneweda, 1 avoids div-by-zero
  const chartHeight = 140;
  const barGapPercent = 28; // % of each column's width left as gap between bars

  const formatDayLabel = (dateStr) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  };

  return (
    <div className="relative">
      <div className="flex items-end gap-0" style={{ height: chartHeight }}>
        {data.map((d, i) => {
          const heightPercent = (d.revenue / maxRevenue) * 100;
          const isHovered = hoverIndex === i;
          return (
            <div
              key={d.date}
              className="flex-1 h-full flex flex-col items-center justify-end relative cursor-pointer"
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex(null)}
            >
              {isHovered && (
                <div className="absolute bottom-full mb-1.5 z-10 bg-slate-900 text-white text-[10px] rounded-md px-2.5 py-1.5 whitespace-nowrap shadow-lg">
                  <p className="font-black">{formatDayLabel(d.date)}</p>
                  <p>Sales: Rs.{d.revenue.toFixed(2)}</p>
                  <p className="text-emerald-300">Profit: Rs.{d.profit.toFixed(2)}</p>
                  <p className="text-blue-300">Bills: {d.billCount}</p>
                </div>
              )}
              <div
                className={`w-full rounded-t-sm transition-colors ${isHovered ? "bg-[#095446]" : "bg-[#0B6B5B]"}`}
                style={{
                  height: `${Math.max(heightPercent, d.revenue > 0 ? 2 : 0)}%`,
                  marginLeft: `${barGapPercent / 2}%`,
                  marginRight: `${barGapPercent / 2}%`,
                  width: `${100 - barGapPercent}%`,
                }}
              />
            </div>
          );
        })}
      </div>
      {/* baseline */}
      <div className="h-px bg-slate-200 w-full" />
      <div className="flex mt-1.5">
        {data.map((d, i) => (
          <div key={d.date} className="flex-1 text-center text-[9px] text-gray-400 font-medium">
            {i % 2 === 0 ? formatDayLabel(d.date) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

// 🆕 SMART DASHBOARD (v3 - simplified): Only the essentials the Admin needs to understand the state of the day within 5 seconds.
// 1) Today's sales + target  2) Chips needing attention  3) Trend + Top items  4) Credit / Payables
// Backend `/products/dashboard` data, inline SVG/CSS with no extra chart library.
const DASH_TARGET_KEY = "pos_dash_target";
const dashMoney = (n) => `Rs. ${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dashCompact = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return v.toFixed(0);
};
const dashPct = (curr, prev) => (prev > 0 ? Math.round(((curr - prev) / prev) * 100) : null);
const dashHourLabel = (h) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "AM" : "PM"}`;
const dashDayLabel = (dateStr) => new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
const dashGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};

function DeltaChip({ pct, suffix = "" }) {
  if (pct === null || pct === undefined) return <span className="text-[11px] font-semibold text-slate-400">No earlier data</span>;
  const up = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-black px-2 py-0.5 rounded-full ${up ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct)}% {suffix}
    </span>
  );
}

function DashCard({ title, subtitle, right, children, className = "" }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden ${className}`}>
      <div className="px-5 pt-4 pb-2 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-black text-slate-800">{title}</h3>
          {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        {right}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </div>
  );
}

// Daily sales (bars) + average line. Today is shown in a darker color.
function DashTrendChart({ data }) {
  const [hover, setHover] = useState(null);
  if (!data || data.length === 0) return null;
  const W = 640, H = 180, padL = 36, padR = 8, padT = 10, padB = 22;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const max = Math.max(...data.map((d) => d.revenue), 1);
  const colW = innerW / data.length;
  const barW = Math.max(4, colW * 0.62);
  const y = (v) => padT + innerH - (v / max) * innerH;
  const labelEvery = data.length > 16 ? 4 : data.length > 8 ? 2 : 1;
  const avg = data.reduce((t, d) => t + d.revenue, 0) / data.length;
  const hd = hover !== null ? data[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Daily sales">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(max * t)} y2={y(max * t)} stroke="#DCE2E8" strokeWidth="1" strokeDasharray={t === 0 ? "" : "3 3"} />
            <text x={padL - 5} y={y(max * t) + 3} textAnchor="end" fontSize="9" fill="#8A98A6">{dashCompact(max * t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const h = Math.max(d.revenue > 0 ? 2 : 0, (d.revenue / max) * innerH);
          const isLast = i === data.length - 1;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + colW * i} y={padT} width={colW} height={innerH} fill="transparent" />
              <rect x={padL + colW * i + (colW - barW) / 2} y={padT + innerH - h} width={barW} height={h} rx="3"
                fill={isLast ? "#0B6B5B" : hover === i ? "#4FAE9B" : "#C5E2DA"} />
              {i % labelEvery === 0 && (
                <text x={padL + colW * i + colW / 2} y={H - 6} textAnchor="middle" fontSize="9" fill="#8A98A6">{dashDayLabel(d.date)}</text>
              )}
            </g>
          );
        })}
        {avg > 0 && (
          <g>
            <line x1={padL} x2={W - padR} y1={y(avg)} y2={y(avg)} stroke="#D9A23A" strokeWidth="1.2" strokeDasharray="5 4" />
            <text x={W - padR} y={y(avg) - 3} textAnchor="end" fontSize="9" fill="#9A6B0C" fontWeight="700">Average {dashCompact(avg)}</text>
          </g>
        )}
      </svg>
      {hd && (
        <div className="absolute top-0 left-10 bg-slate-900 text-white text-[11px] rounded-lg px-3 py-2 shadow-lg pointer-events-none">
          <p className="font-black">{dashDayLabel(hd.date)}</p>
          <p>Sales: {dashMoney(hd.revenue)}</p>
          <p className="text-emerald-300">Profit: {dashMoney(hd.profit)}</p>
          <p className="text-blue-300">Bills: {hd.billCount}</p>
        </div>
      )}
    </div>
  );
}

function DashboardView({ data, days, onChangeDays, isLoading, onRefresh, lastUpdated, lowStock, expiring, onGo, username }) {
  // Target: the one set by the Admin (localStorage), otherwise the average of previous days
  const [custom, setCustom] = useState(() => {
    try { return Number(localStorage.getItem(DASH_TARGET_KEY)) || 0; } catch { return 0; }
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (!data) {
    return (
      <div className="p-5 max-w-300 mx-auto space-y-4">
        {isLoading ? (
          <>
            <div className="h-44 rounded-3xl bg-slate-200/70 animate-pulse" />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="h-56 rounded-2xl bg-slate-200/70 animate-pulse lg:col-span-2" />
              <div className="h-56 rounded-2xl bg-slate-200/70 animate-pulse" />
            </div>
          </>
        ) : (
          <div className="p-10 text-center text-slate-400 text-sm">
            Could not load Dashboard data. Check that the Backend server is running and try again.
            <div><button onClick={onRefresh} className="mt-3 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold">🔄 Try again</button></div>
          </div>
        )}
      </div>
    );
  }

  const { period, previous, today, yesterday, daily, hourly, topProducts, voids, credit, payables } = data;

  const pastDays = daily.slice(0, -1).filter((d) => d.revenue > 0);
  const autoTarget = pastDays.length > 0 ? pastDays.reduce((t, d) => t + d.revenue, 0) / pastDays.length : 0;
  const target = custom > 0 ? custom : autoTarget;
  const pct = target > 0 ? (today.revenue / target) * 100 : 0;
  const reached = target > 0 && today.revenue >= target;

  const saveTarget = () => {
    const v = Number(draft);
    const next = v > 0 ? v : 0;
    setCustom(next);
    try {
      if (next > 0) localStorage.setItem(DASH_TARGET_KEY, String(next));
      else localStorage.removeItem(DASH_TARGET_KEY);
    } catch {}
    setEditing(false);
  };

  const peak = hourly.reduce((best, h) => (h.revenue > best.revenue ? h : best), hourly[0]);
  const top5 = topProducts.slice(0, 5);
  const topMax = Math.max(...top5.map((p) => p.revenue), 1);

  // Only the things needing attention (otherwise ✅)
  const outOfStock = lowStock.filter((p) => p.total <= 0).length;
  const expiredCount = expiring.filter((p) => p.expiryStatus === "expired").length;
  const attention = [];
  if (outOfStock > 0) attention.push({ key: "oos", text: `⛔ Out of stock ${outOfStock}`, cls: "bg-red-50 border-red-200 text-red-700", go: "products" });
  if (lowStock.length - outOfStock > 0) attention.push({ key: "low", text: `⚠️ Low stock ${lowStock.length - outOfStock}`, cls: "bg-amber-50 border-amber-200 text-amber-800", go: "reorder" });
  if (expiring.length > 0) attention.push({ key: "exp", text: `⏳ ${expiredCount > 0 ? `Expired ${expiredCount}` : `Expiring ${expiring.length}`}${expiredCount > 0 && expiring.length > expiredCount ? ` (+${expiring.length - expiredCount})` : ""}`, cls: expiredCount > 0 ? "bg-red-50 border-red-200 text-red-700" : "bg-amber-50 border-amber-200 text-amber-800", go: "expiry" });
  if (voids.count >= 3) attention.push({ key: "void", text: `🚫 Void ${voids.count} (${days} days)`, cls: "bg-red-50 border-red-200 text-red-700", go: null });

  return (
    <div className="p-5 space-y-4 max-w-300 mx-auto">
      {isLoading && <div className="fixed top-0 left-0 right-0 h-0.5 bg-blue-500/70 animate-pulse z-50" />}

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-slate-900 tracking-tight">{dashGreeting()}{username ? `, ${username}` : ""} 👋</h2>
          <p className="text-[11.5px] text-slate-400 mt-0.5 flex items-center gap-1.5">
            {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long" })}
            {lastUpdated && <><i className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" /> Live</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-white border border-slate-200 rounded-xl p-0.5">
            {[7, 14, 30].map((d) => (
              <button key={d} onClick={() => onChangeDays(d)} className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-colors ${days === d ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>{d} days</button>
            ))}
          </div>
          <button onClick={onRefresh} title="Refresh" className="w-9 h-9 rounded-xl border border-slate-200 bg-white text-sm hover:bg-slate-50">{isLoading ? "⏳" : "🔄"}</button>
        </div>
      </div>

      {/* Hero: Today's sales + target */}
      <div className="rounded-3xl bg-linear-to-br from-blue-600 to-indigo-700 text-white p-6 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
          <div>
            <p className="text-[12px] font-bold text-blue-100 uppercase tracking-wider">Today's Sales</p>
            <p className="text-[36px] leading-tight font-black mt-1">{dashMoney(today.revenue)}</p>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              {(() => {
                const p = dashPct(today.revenue, yesterday.revenue);
                if (p === null) return <span className="text-[11.5px] text-blue-100">No data for yesterday</span>;
                return <span className={`text-[11.5px] font-black px-2 py-0.5 rounded-full ${p >= 0 ? "bg-emerald-400/25 text-emerald-100" : "bg-red-400/25 text-red-100"}`}>{p >= 0 ? "▲" : "▼"} {Math.abs(p)}% vs yesterday</span>;
              })()}
              {peak && peak.revenue > 0 && <span className="text-[11.5px] text-blue-100">⏰ Peak: {dashHourLabel(peak.hour)}</span>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-5 md:text-right">
            <div><p className="text-[11px] text-blue-100 font-bold">Profit</p><p className="text-[18px] font-black">{dashMoney(today.profit)}</p></div>
            <div><p className="text-[11px] text-blue-100 font-bold">Bills</p><p className="text-[18px] font-black">{today.bills}</p></div>
            <div><p className="text-[11px] text-blue-100 font-bold">Average Bill</p><p className="text-[18px] font-black">{today.bills > 0 ? dashCompact(today.avgBill) : "—"}</p></div>
          </div>
        </div>

        {/* Goal bar */}
        <div className="mt-5">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                type="number" min="0" autoFocus value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveTarget(); if (e.key === "Escape") setEditing(false); }}
                placeholder="Daily target (Rs.) - Auto if empty"
                className="flex-1 min-w-0 h-9 px-3 text-xs rounded-lg text-slate-800 outline-none"
              />
              <button onClick={saveTarget} className="h-9 px-4 rounded-lg bg-white text-blue-700 text-xs font-black">Save</button>
              <button onClick={() => setEditing(false)} className="h-9 px-2 text-xs font-bold text-blue-100">✕</button>
            </div>
          ) : target > 0 ? (
            <>
              <div className="flex items-center justify-between text-[11.5px] font-semibold text-blue-100 mb-1.5">
                <span>🎯 Today's target {dashMoney(target)}{custom > 0 ? "" : " (Auto)"}</span>
                <span className="flex items-center gap-2">
                  <b className="text-white">{reached ? "🎉 Completed" : `${Math.round(pct)}% • ${dashCompact(target - today.revenue)} to go`}</b>
                  <button onClick={() => { setDraft(custom > 0 ? String(custom) : ""); setEditing(true); }} className="opacity-80 hover:opacity-100" title="Change target">✏️</button>
                </span>
              </div>
              <div className="h-2.5 bg-white/20 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-700 ${reached ? "bg-emerald-300" : "bg-white"}`} style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
            </>
          ) : (
            <button onClick={() => { setDraft(""); setEditing(true); }} className="text-[11.5px] font-bold text-blue-100 hover:text-white">🎯 Set a daily target</button>
          )}
        </div>
      </div>

      {/* Needs attention - only if there is actually something */}
      <div className="flex items-center gap-2 flex-wrap">
        {attention.length === 0 ? (
          <span className="text-[12.5px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">✅ Nothing needs attention</span>
        ) : attention.map((a) => {
          const Tag = a.go ? "button" : "span";
          return (
            <Tag key={a.key} onClick={a.go ? () => onGo(a.go) : undefined}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[12px] font-bold ${a.cls} ${a.go ? "hover:shadow-sm transition cursor-pointer" : ""}`}>
              {a.text}{a.go && <span className="opacity-50">→</span>}
            </Tag>
          );
        })}
      </div>

      {/* Trend + Top items */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <DashCard
          title={`📊 Daily sales (${days} days)`}
          className="lg:col-span-2"
          subtitle={<><b className="text-slate-600">{dashMoney(period.revenue)}</b> • Profit <b className="text-emerald-600">{dashMoney(period.profit)}</b> ({period.margin.toFixed(1)}%)</>}
          right={<DeltaChip pct={dashPct(period.revenue, previous.revenue)} suffix="vs previous period" />}
        >
          <DashTrendChart data={daily} />
        </DashCard>

        <DashCard title="🏅 Top Items" subtitle={`${days} days • by revenue`}>
          {top5.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">No sales yet</p>
          ) : (
            <div className="space-y-3">
              {top5.map((p, i) => (
                <div key={p.name}>
                  <div className="flex items-center justify-between text-[12px] mb-1 gap-2">
                    <span className="font-bold text-slate-700 truncate">{i + 1}. {p.name}</span>
                    <span className="text-slate-500 font-semibold shrink-0">{dashCompact(p.revenue)}</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(p.revenue / topMax) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </DashCard>
      </div>

      {/* Credit / Payables */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button onClick={() => onGo("customers")} className="text-left bg-white rounded-2xl border border-slate-200 shadow-xs p-5 hover:shadow-md transition-shadow">
          <p className="text-[12px] font-bold text-slate-400">📕 Credit Receivable • Customers {credit.customerCount}</p>
          <p className={`text-[24px] font-black mt-1 ${credit.outstanding > 0 ? "text-rose-600" : "text-emerald-600"}`}>{credit.outstanding > 0 ? dashMoney(credit.outstanding) : "✅ No credit"}</p>
          {credit.top[0] && <p className="text-[11.5px] text-slate-500 mt-1 truncate">Highest: <b className="text-slate-700">{credit.top[0].name}</b> ({dashCompact(credit.top[0].balance)})</p>}
        </button>
        <button onClick={() => onGo("suppliers")} className="text-left bg-white rounded-2xl border border-slate-200 shadow-xs p-5 hover:shadow-md transition-shadow">
          <p className="text-[12px] font-bold text-slate-400">🚚 Payables • Suppliers {payables.supplierCount}</p>
          <p className={`text-[24px] font-black mt-1 ${payables.total > 0 ? "text-amber-600" : "text-emerald-600"}`}>{payables.total > 0 ? dashMoney(payables.total) : "✅ No payments due"}</p>
          {payables.top[0] && <p className="text-[11.5px] text-slate-500 mt-1 truncate">Highest: <b className="text-slate-700">{payables.top[0].name}</b> ({dashCompact(payables.top[0].balance)})</p>}
        </button>
      </div>
    </div>
  );
}

function App() {
  // 🛠️ FIX: page refresh always dropped you back on Billing regardless of what
  // screen you were on. Now the last tab survives a refresh (sessionStorage —
  // clears when the browser/tab actually closes, so it doesn't linger forever).
  const [activeTab, setActiveTab] = useState(() => {
    try {
      return sessionStorage.getItem("pos_activeTab") || "billing";
    } catch {
      return "billing";
    }
  });
  const [adminSubTab, setAdminSubTab] = useState(() => {
    try {
      const saved = sessionStorage.getItem("pos_adminSubTab");
      return saved && saved !== "dashboard" ? saved : "products"; // Dashboard is now in the Main menu
    } catch {
      return "products";
    }
  });
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState(() => readBillDraft()?.cart || []);
  const [loading, setLoading] = useState(true);

  // 🆕 HOLD BILL (Park Sale): lets a cashier Hold a cart and start a new cart
  // - the same feature as "Park Sale" / "Suspend Ticket" in restaurant/POS systems.
  // Kept locally on the Device itself (not synced to the server - it only goes to the server after checkout),
  // and persisted in localStorage so it is not lost on a browser refresh/power cut.
  const [heldBills, setHeldBills] = useState(() => {
    try {
      const saved = localStorage.getItem("pos_held_bills");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [showHeldBillsPanel, setShowHeldBillsPanel] = useState(false);
  const [heldSearch, setHeldSearch] = useState("");
  // 🆕 SMART DASHBOARD states
  const [dashboardData, setDashboardData] = useState(null);
  const [dashboardDays, setDashboardDays] = useState(() => {
    try { const d = parseInt(sessionStorage.getItem("pos_dashboardDays"), 10); return [7, 14, 30].includes(d) ? d : 14; } catch { return 14; }
  });
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);
  const [dashboardUpdatedAt, setDashboardUpdatedAt] = useState(null);
  const [holdNowTick, setHoldNowTick] = useState(() => Date.now()); // To refresh Age/colors
  const [editingHoldNoteId, setEditingHoldNoteId] = useState(null);
  const [holdNoteDraft, setHoldNoteDraft] = useState("");

  // 🆕 ON-DEMAND PRINTING: instead of auto-printing when checkout succeeds, this snapshot
  // stores the data of the last completed sale, so that the cashier can "Print" it whenever they want.
  // (Even though the cart is reset after checkout, the receipt is rendered from this snapshot, so nothing goes wrong.)
  const [lastCompletedSale, setLastCompletedSale] = useState(null);
  const [showSaleCompleteModal, setShowSaleCompleteModal] = useState(false);

  // 🆕 SPEED: "Auto-print Receipt" toggle - when on, the receipt is printed
  // instantly as soon as checkout succeeds (the cashier does not need to click the "Print" button). Persisted
  // on the Device itself (localStorage) - turn it off if there is no thermal printer connected to the terminal.
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(() => {
    try { return localStorage.getItem("pos_autoPrintReceipt") === "true"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("pos_autoPrintReceipt", String(autoPrintReceipt)); } catch {}
  }, [autoPrintReceipt]);

  // 🆕 RECENT BILLS QUEUE: *Every* bill, whether printed or not (not only from the current session),
  // is stored here so the cashier can find and print it later whenever needed (even after several hours, or after a shift change).
  // Persisted in localStorage on the Device itself, and after 3 days
  // (auto-prune) old entries are removed so the list does not grow unnecessarily.
  const RECENT_BILLS_RETENTION_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
  const RECENT_BILLS_MAX = 150;
  const pruneRecentBills = (bills) =>
    bills
      .filter((b) => Date.now() - new Date(b.date).getTime() < RECENT_BILLS_RETENTION_MS)
      .slice(0, RECENT_BILLS_MAX);

  const [recentBills, setRecentBills] = useState(() => {
    try {
      const saved = localStorage.getItem("pos_recent_bills");
      return saved ? pruneRecentBills(JSON.parse(saved)) : [];
    } catch { return []; }
  });
  const [showRecentBillsPanel, setShowRecentBillsPanel] = useState(false);
  const [recentBillsFilter, setRecentBillsFilter] = useState("unprinted"); // "unprinted" | "all"

  // Both Held Bills and Recent Bills are persisted in localStorage
  useEffect(() => {
    try { localStorage.setItem("pos_held_bills", JSON.stringify(heldBills)); } catch {}
  }, [heldBills]);

  // 🆕 If there are Hold bills, refreshes Age/colors every minute (when the Panel is open or on the header badge)
  useEffect(() => {
    if (heldBills.length === 0) return;
    const t = setInterval(() => setHoldNowTick(Date.now()), 30000);
    return () => clearInterval(t);
  }, [heldBills.length]);

  useEffect(() => {
    try { localStorage.setItem("pos_recent_bills", JSON.stringify(recentBills)); } catch {}
  }, [recentBills]);

  // 🆕 SHIFT / CASH DRAWER RECONCILIATION: A Cashier records an Opening Float and "Opens"
  // a Shift, and when work is done enters the Actual Counted Cash and "Closes" it - the backend itself calculates the Expected Cash
  // from the Cash Sales/Refunds made during that period and shows the Over/Short.
  const [activeShift, setActiveShift] = useState(null); // null = no Shift is Open
  const [isLoadingShift, setIsLoadingShift] = useState(true);
  const [showStartShiftModal, setShowStartShiftModal] = useState(false);
  const [startShiftFloat, setStartShiftFloat] = useState("");
  const [showEndShiftModal, setShowEndShiftModal] = useState(false);
  const [closingCountedCash, setClosingCountedCash] = useState("");
  const [shiftCloseResult, setShiftCloseResult] = useState(null); // To show the Over/Short summary after Closing

  // 🆕 Admin "Shift History" tab states
  const [shiftHistory, setShiftHistory] = useState([]);
  const [isLoadingShiftHistory, setIsLoadingShiftHistory] = useState(false);
  const [shiftHistoryFilters, setShiftHistoryFilters] = useState({ cashier: "", from: "", to: "", includeAdmin: true });
  // 🆕 "Transactions without a Shift" report (Admin) - Cash Drawer transactions made without an Open Shift
  const [outsideActivity, setOutsideActivity] = useState({ items: [], totals: null, truncated: false });
  const [isLoadingOutside, setIsLoadingOutside] = useState(false);
  const [outsideFilters, setOutsideFilters] = useState({ cashier: "", from: "", to: "", includeAdmin: true });

  // 🆕 MULTI-PRICE POPUP: If the scanned/searched item has several Price Batches, the popup to choose from
  const [multiPricePopup, setMultiPricePopup] = useState(null); // holds the product pending price selection

  // Search States
  const [billingSearch, setBillingSearch] = useState("");
  const [adminProductSearch, setAdminProductSearch] = useState("");
  const [billingCategoryFilter, setBillingCategoryFilter] = useState("All"); // 🛠️ NEW: Billing screen category filter

  // Cash & Payment States
  const [cashReceived, setCashReceived] = useState(() => readBillDraft()?.cashReceived ?? "");
  const [balanceAmount, setBalanceAmount] = useState(0);
  const [amountPaid, setAmountPaid] = useState(() => readBillDraft()?.amountPaid ?? ""); 

  // Customer & Credit Book States
  const [customers, setCustomers] = useState([]);

  // 🆕 BILL-LEVEL DISCOUNT: Special Occasion Promotions (Loyalty feature intentionally omitted)
  const [promotions, setPromotions] = useState([]);
  const [appliedBillDiscount, setAppliedBillDiscount] = useState(() => readBillDraft()?.appliedBillDiscount ?? null); // { name, percent }
  const [promotionForm, setPromotionForm] = useState({ name: "", discountPercent: "" });

  // 🆕 ADMIN: Cashier/Staff Account Management (POST /api/users/register, admin-only)
  const [staffUsers, setStaffUsers] = useState([]); // 🆕 admin can see which accounts exist (username + role only, never password)
  const [newUserForm, setNewUserForm] = useState({ username: "", password: "", role: "cashier" });
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(() => readBillDraft()?.selectedCustomer ?? null);
  const [searchPhone, setSearchPhone] = useState(""); // Holds Name or Phone query
  const [customerForm, setCustomerForm] = useState({ name: "", phone: "" });
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [editCustomerId, setEditCustomerId] = useState(null);
  const [creditPayment, setCreditPayment] = useState({ customerId: "", amount: "", paymentMethod: "Cash" });

  // 🛠️ NEW: Supplier Management States
  const [suppliers, setSuppliers] = useState([]);
  const [supplierForm, setSupplierForm] = useState({ name: "", phone: "", address: "" });
  const [isEditingSupplier, setIsEditingSupplier] = useState(false);
  const [editSupplierId, setEditSupplierId] = useState(null);
  // 🆕 PROFESSIONAL GRN REBUILD: To add multiple Products from a single Supplier Invoice as a cart +
  // Ordered vs Received (Discrepancy), Expiry Date, Supplier Invoice Reference
  const [grnSupplierId, setGrnSupplierId] = useState("");
  const [grnSupplierInvoiceRef, setGrnSupplierInvoiceRef] = useState(""); // 🆕 The supplier's Invoice/Delivery Note number
  const [grnCurrentItem, setGrnCurrentItem] = useState({ productId: "", orderedQty: "", quantity: "", costPrice: "", expiryDate: "", stockMode: "add" });
  const [grnItems, setGrnItems] = useState([]); // [{ productId, productName, unit, orderedQty, quantity, costPrice, expiryDate }]
  const [grnDescription, setGrnDescription] = useState("");
  const [isSubmittingGrn, setIsSubmittingGrn] = useState(false); // 🆕 To prevent double-submit

  // 🆕 GRN History tab states
  const [grnHistory, setGrnHistory] = useState([]);
  const [isLoadingGrnHistory, setIsLoadingGrnHistory] = useState(false);
  const [grnHistoryFilters, setGrnHistoryFilters] = useState({ supplierId: "", from: "", to: "", q: "" });
  const [viewGrnDetails, setViewGrnDetails] = useState(null); // 🆕 Single GRN detail/print modal

  const [viewSupplierDetails, setViewSupplierDetails] = useState(null); // 🛠️ NEW: For the Supplier details modal (ledger history)
  const [viewCustomerDetails, setViewCustomerDetails] = useState(null); // 🆕 For the Customer credit ledger modal (customer _id)
  const [supplierPayment, setSupplierPayment] = useState({ supplierId: "", amount: "", paymentMethod: "Cash" });

  // 🛠️ NEW: Live Customer Search (Suggestions Dropdown) States
  const [customerSuggestions, setCustomerSuggestions] = useState([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [highlightedCustomerIndex, setHighlightedCustomerIndex] = useState(-1);

  // Payment Method State
  const [paymentMethod, setPaymentMethod] = useState(() => readBillDraft()?.paymentMethod || "Cash");

  // Sales Summary State
  const [salesSummary, setSalesSummary] = useState({
    totalSalesCount: 0, totalRevenue: 0, totalProfit: 0,
    breakdown: { cashSales: 0, cardSales: 0, qrSales: 0, creditSales: 0 }, sales: [],
    dailySales: [], cashierPerformance: [] // 🆕 DASHBOARD
  });

  // 🛠️ UPDATED: When the system is Refreshed, checks LocalStorage and retains the logged-in user
  // 🔐 AUTH: a user session cannot be validated without a token - for someone who had
  // logged in before this update, pos_user exists but pos_token does not; since that is a stale session, it is cleared and
  // they are sent back to log in again (this happens only once).
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem("pos_user");
    const savedToken = localStorage.getItem("pos_token");
    if (savedUser && savedToken) return JSON.parse(savedUser);
    localStorage.removeItem("pos_user");
    localStorage.removeItem("pos_token");
    return null;
  });

  // Held bills are private to the cashier who parked them. The list is stored per device (shared
  // browser), so we filter by owner here. Admin sees everything (supervision); legacy bills with no
  // owner are visible to Admin only.
  const myHeldBills = heldBills.filter((h) => user?.role === "admin" || (h.cashier && h.cashier === user?.username));
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginError, setLoginError] = useState("");

  // 🆕 Billing redesign: declared here (not lower down) because the barcode-scanner
  // useEffect above references showTender, and hooks run top-to-bottom each render —
  // a const declared later would be read before initialization otherwise.
  const [showTender, setShowTender] = useState(false);       // payment moved out of the footer
  const [catalogOpen, setCatalogOpen] = useState(true);      // F8 collapses it for scanner-only work
  const [catalogSearch, setCatalogSearch] = useState("");    // separate from the scan bar
  const [showVoidedSales, setShowVoidedSales] = useState(false); // 🆕 hidden by default to declutter; toggle brings them back for the audit trail
  const [billingHighlightIndex, setBillingHighlightIndex] = useState(-1); // 🛠️ FIX: keyboard nav for the scan-bar suggestions dropdown
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const billingSearchRef = useRef(null);
  const cartScrollRef = useRef(null);
  const productFormRef = useRef(null); // 🆕 so Edit can scroll the form into view
  const lowStockAlertShownRef = useRef(false); // 🆕 DASHBOARD: low-stock toast once per login session, not on every products refresh

  // Product CRUD States
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState(null);
  const [productForm, setProductForm] = useState({ name: "", marketPrice: "", price: "", costPrice: "", stock: "", barcode: "", discountPercent: "", unit: "Kg", category: "Grocery", minStockLevel: "5", preferredSupplierId: "", expiryDate: "", batches: [] });
  // 🆕 MULTI-PRICE (Simplified): Remember the Original Price/Stock in the Database of the Product being Edited (to Auto-create the old Batch)
  const [editingOriginalProduct, setEditingOriginalProduct] = useState(null);
  // 🆕 MULTI-PRICE (Simplified): State for the "Stock received at a new price" mini-form
  const [showNewPriceEntry, setShowNewPriceEntry] = useState(false);
  const [newPriceEntry, setNewPriceEntry] = useState({ price: "", qty: "", costPrice: "", discount: "" });

  // 🆕 RETURN / REFUND / EXCHANGE States
  const [returnInvoiceSearch, setReturnInvoiceSearch] = useState("");
  const [returnSaleData, setReturnSaleData] = useState(null); // The original bill that came from the Server
  const [returnSelections, setReturnSelections] = useState({}); // { [itemId]: { qty, reason, checked } }
  const [refundMethod, setRefundMethod] = useState("Cash");
  const [isExchangeMode, setIsExchangeMode] = useState(false);
  const [exchangeCart, setExchangeCart] = useState([]); // Items newly given out during the Exchange
  const [exchangeCashReceived, setExchangeCashReceived] = useState("");
  const [exchangePaymentMethod, setExchangePaymentMethod] = useState("Cash");
  const [returnLoading, setReturnLoading] = useState(false);
  const [returnHistory, setReturnHistory] = useState([]);
  // 🆕 The item names Manually "Deleted" from the Unregistered Items tab - persisted in localStorage (Local to the Browser/Device)
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

  // 🆕 PRINT RECEIPT: The Professional Invoice Number of the last Checked-out Sale (this is what is used for the Return search)
  // 🆕 lastInvoiceNo/lastSaleIsOffline replaced by the lastCompletedSale snapshot (see near the cart state)

  // Emergency Temp Item Form State (For Any Role)
  const [tempItemForm, setTempItemForm] = useState({ name: "", price: "", qty: "1", unit: "Kg", barcode: "" });
  const [registerTempAsProduct, setRegisterTempAsProduct] = useState(false); // 🆕 Whether to also Register the Emergency item in the Database

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
        title: options.title || "Confirm",
        message: options.message || "",
        tone: options.tone || "default", // "default" | "danger" | "warning"
        confirmLabel: options.confirmLabel || "Confirm",
        cancelLabel: options.cancelLabel || "Cancel",
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
      fetchPromotions(); // 🆕 Needed by both Cashier and Admin - to show the Live discount option on the Billing Screen
      if (user.role === "admin") {
        fetchSalesSummary();
        fetchSuppliers();
        fetchReturnHistory();
        fetchStaffUsers(); // 🆕 Cashier/Staff Account list
      }
      fetchExpiringProducts();
      fetchCurrentShift(); // 🆕 On Login/Page refresh, checks whether there is currently an Open Shift
    }
  }, [user]);

  // 🆕 Persist the active tab across refreshes, and make sure a cashier account
  // can never land on a restricted (admin-only) tab (e.g. if "admin" was left over
  // from a previous session on a shared till). Billing AND Returns are both fine
  // for a cashier — only "admin" is off-limits to them.
  useEffect(() => {
    if (user?.role === "cashier" && activeTab !== "billing" && activeTab !== "returns") {
      setActiveTab("billing");
      return;
    }
    try { sessionStorage.setItem("pos_activeTab", activeTab); } catch {}
  }, [activeTab, user]);

  // 🆕 Same fix, one level deeper: persist which ADMIN sub-tab (Reorder, Expiry,
  // Sales, etc.) was open too — otherwise a refresh kept you on "Admin" but
  // silently bounced you back to the default "Products" sub-tab.
  useEffect(() => {
    try { sessionStorage.setItem("pos_adminSubTab", adminSubTab); } catch {}
  }, [adminSubTab]);

  // 🆕 LIVE SALES LOG: fetchSalesSummary() only ever ran when THIS session did the
  // checkout/void/return — so a sale from another till, or another browser tab,
  // never showed up here until a manual page refresh. Polling every 5s while this
  // specific tab is open gives near-real-time updates without background load the
  // rest of the time (it stops the instant you navigate away).
  useEffect(() => {
    // 🆕 The "dashboard" tab has also been added to this - the Daily Sales Graph/Cashier Performance table should
    // also update live; previously it was limited to just the "sales" log tab.
    if (!(user?.role === "admin" && activeTab === "admin" && adminSubTab === "sales")) return;
    const interval = setInterval(() => { fetchSalesSummary(); }, 5000);
    return () => clearInterval(interval);
  }, [user, activeTab, adminSubTab]);

  // 🆕 SMART DASHBOARD: Loads data when the Dashboard tab is opened (and when the time range is changed),
  // and auto-refreshes every 30 seconds while the tab is open.
  const fetchDashboard = async (daysOverride) => {
    setIsLoadingDashboard(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/products/dashboard`, { params: { days: daysOverride || dashboardDays } });
      setDashboardData(response.data);
      setDashboardUpdatedAt(new Date());
    } catch (error) {
      console.error("Failed to load Dashboard data", error);
      if (!dashboardData) showToast(error.response?.data?.message || "Failed to load Dashboard data!", "error");
    } finally {
      setIsLoadingDashboard(false);
    }
  };

  useEffect(() => {
    if (!(user?.role === "admin" && activeTab === "dashboard")) return;
    fetchDashboard();
    fetchExpiringProducts();
    const interval = setInterval(() => { fetchDashboard(); }, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeTab, dashboardDays]);

  // 🆕 AUTO-SAVE DRAFT BILL: Saves to localStorage every time the cart/customer/payment state changes.
  // If the Cart is empty (bill completed / Cleared / Held), the draft is deleted.
  useEffect(() => {
    if (!user) return;
    try {
      if (cart.length === 0) {
        localStorage.removeItem(BILL_DRAFT_KEY);
      } else {
        localStorage.setItem(BILL_DRAFT_KEY, JSON.stringify({
          savedAt: Date.now(),
          cashier: user.username,
          cart, selectedCustomer, paymentMethod, cashReceived, amountPaid, appliedBillDiscount,
        }));
      }
    } catch {}
  }, [user, cart, selectedCustomer, paymentMethod, cashReceived, amountPaid, appliedBillDiscount]);

  // 🆕 RESTORE VALIDATION: Once the products list has loaded, the cart restored from the Draft is checked, a single time,
  // against the current state - removes deleted items and reduces quantities that exceed
  // stock down to the available stock. (If price/discount has changed, the server rejects it at checkout and asks for a refresh.)
  const draftRestoreCheckedRef = useRef(false);
  const readBillDraftMarker = useRef(cart.length > 0); // Whether the cart already had items when this session started (was a Draft restored)
  useEffect(() => {
    if (draftRestoreCheckedRef.current || products.length === 0 || cart.length === 0) return;
    draftRestoreCheckedRef.current = true;
    if (!readBillDraftMarker.current) return;
    let removed = 0;
    let reduced = 0;
    const checked = [];
    for (const item of cart) {
      if (item.isTemporary) { checked.push(item); continue; }
      if (!products.some((p) => p._id === item._id)) { removed++; continue; }
      const available = getAvailableStock(item);
      if (available <= 0) { removed++; continue; }
      if (parseFloat(item.qty) > available) { reduced++; checked.push({ ...item, qty: available }); continue; }
      checked.push(item);
    }
    if (removed > 0 || reduced > 0) setCart(checked);
    showToast(
      `🔄 Previous bill restored!${removed > 0 ? ` (${removed} item(s) removed as out of stock)` : ""}${reduced > 0 ? ` (${reduced} quantity(ies) reduced to available stock)` : ""}`,
      removed > 0 || reduced > 0 ? "warning" : "success"
    );
  }, [products]);

  // 🆕 Loads the list when the GRN History tab is opened (or a Filter is changed)
  useEffect(() => {
    if (!(user?.role === "admin" && activeTab === "admin" && adminSubTab === "grnHistory")) return;
    fetchGrnHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeTab, adminSubTab]);

  // 🆕 Loads the report when the "Transactions without a Shift" tab is opened
  useEffect(() => {
    if (!(user?.role === "admin" && activeTab === "admin" && adminSubTab === "outsideShift")) return;
    fetchOutsideActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeTab, adminSubTab]);

  // 🆕 Loads the list when the Shift History tab is opened
  useEffect(() => {
    if (!(user?.role === "admin" && activeTab === "admin" && adminSubTab === "shiftHistory")) return;
    fetchShiftHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeTab, adminSubTab]);

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
      showToast("🔄 Internet connection restored! Syncing data...", "warning");
      
      // Gets the list of Pending bills
      const pendingSales = await db.offlineSales.where('status').equals('pending').toArray();
      
      if (pendingSales.length === 0) return;

      for (const sale of pendingSales) {
        try {
          // Sends them to the server one by one
          await axios.post(`${API_BASE_URL}/products/checkout`, {
            cartItems: sale.cartItems,
            cashierName: sale.cashierName,
            shiftId: sale.shiftId || null,
            paymentMethod: sale.paymentMethod,
            customerId: sale.customerId,
            cashReceived: sale.cashReceived,
            balanceAmount: sale.balanceAmount,
            amountPaid: sale.amountPaid,
            amountDue: sale.amountDue
          });
          
          // If successful, deletes from the Local DB
          await db.offlineSales.delete(sale.id);
        } catch (err) {
          console.error("Failed to sync bill:", err);
        }
      }
      showToast("✅ All Offline bills were successfully sent to the server! 🎉");
      fetchProducts();
      if (user.role === "admin") fetchSalesSummary(); // 🛠️ FIX: Unregistered Items/Sales Logs are Refreshed even after Offline sales are synced
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
            showToast(`⚠️ Barcode "${barcodeBuffer}" not found in the system! Please add it temporarily.`, "warning");
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

    // 🛠️ UPDATED: As soon as Online, the items are also saved to the local DB for Offline use
    await db.products.clear(); // Clears the old data
    await db.products.bulkAdd(response.data); // Adds the new items
    
  } catch (error) {
    console.log("Could not connect to the Backend. Checking Offline data... ⚠️");
    
    // 🛠️ UPDATED: If there is a Server Error (if Offline), takes the items from the Local DB
    const localProducts = await db.products.toArray();
    if (localProducts.length > 0) {
      setProducts(localProducts);
      showToast("System is running Offline! 📴", "warning");
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

  // 🆕 BILL-LEVEL DISCOUNT (Occasion only): Fetching Promotions
  const fetchPromotions = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/promotions`);
      setPromotions(response.data);
    } catch (error) { console.error(error); }
  };

  // 🆕 ADMIN: Cashier/Staff Account Management
  const fetchStaffUsers = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/users`);
      setStaffUsers(response.data);
    } catch (error) { console.error(error); }
  };

  const handleCreateUserSubmit = async (e) => {
    e.preventDefault();
    if (!newUserForm.username.trim() || !newUserForm.password) {
      return showToast("Please enter both Username and Password!", "warning");
    }
    if (newUserForm.password.length < 8) {
      return showToast("Password must be at least 8 characters!", "warning");
    }
    setIsCreatingUser(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/users/register`, newUserForm);
      showToast(response.data.message || "Account created successfully! ✅");
      setNewUserForm({ username: "", password: "", role: "cashier" });
      fetchStaffUsers();
    } catch (error) {
      showToast(error.response?.data?.message || "Failed to create account!", "error");
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleDeleteUser = async (id, username) => {
    if (!window.confirm(`Are you sure you want to delete the account "${username}"?`)) return;
    try {
      const response = await axios.delete(`${API_BASE_URL}/users/${id}`);
      showToast(response.data.message || "Account deleted! 🗑️");
      fetchStaffUsers();
    } catch (error) {
      showToast(error.response?.data?.message || "Failed to delete!", "error");
    }
  };

  const handlePromotionSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE_URL}/promotions/add`, { ...promotionForm, type: "occasion" });
      showToast("Discount added successfully! 🎉");
      setPromotionForm({ name: "", discountPercent: "" });
      fetchPromotions();
    } catch (error) { showToast("Failed to add!", "error"); }
  };

  const handleActivatePromotion = async (id) => {
    try {
      await axios.put(`${API_BASE_URL}/promotions/activate/${id}`);
      showToast("Discount activated successfully! ✅");
      fetchPromotions();
    } catch (error) { showToast("Failed to Activate!", "error"); }
  };

  const handleDeactivatePromotion = async (id) => {
    try {
      await axios.put(`${API_BASE_URL}/promotions/deactivate/${id}`);
      showToast("Discount deactivated! ❌");
      fetchPromotions();
    } catch (error) { showToast("Failed to Deactivate!", "error"); }
  };

  const handleDeletePromotion = async (id) => {
    const confirmed = await askConfirm({
      title: "Delete Discount",
      message: "Are you sure you want to delete this Discount?",
      tone: "danger",
      confirmLabel: "🗑️ Delete"
    });
    if (!confirmed) return;
    try {
      await axios.delete(`${API_BASE_URL}/promotions/delete/${id}`);
      showToast("Discount deleted!");
      fetchPromotions();
    } catch (error) { showToast("Failed to delete!", "error"); }
  };

  // 🆕 The Active Occasion Promotion (Derived) - even if a Loyalty type exists, it is ignored here
  const activeOccasionPromotion = promotions.find((p) => p.type === "occasion" && p.isActive);

  const applyBillDiscount = () => {
    if (!activeOccasionPromotion) return;
    setAppliedBillDiscount({ name: activeOccasionPromotion.name, percent: activeOccasionPromotion.discountPercent });
    showToast(`🎉 "${activeOccasionPromotion.name}" applied to the Bill!`);
  };

  const removeBillDiscount = () => {
    setAppliedBillDiscount(null);
    showToast("Bill Discount removed.");
  };

  // 🛠️ NEW: Fetching Suppliers
  const fetchSuppliers = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/suppliers`);
      setSuppliers(response.data);
    } catch (error) { console.error(error); }
  };

  // 🆕 Fetching items that are Expiring / have Expired (within the next 7 days)
  const fetchExpiringProducts = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/products/expiring?days=7`);
      setExpiringProducts(response.data);
    } catch (error) { console.error(error); }
  };

  // 🆕 Fetching Return/Exchange History (Admin Reporting)
  const fetchReturnHistory = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/products/returns`);
      setReturnHistory(response.data);
    } catch (error) { console.error(error); }
  };

  // 🆕 Permanently Clear all Return/Exchange History
  // ⚠️ A Destructive action - you must type "DELETE" to confirm
  const handleClearAllReturns = async () => {
    const confirmed = await askConfirm({
      title: "Clear Return/Exchange History!",
      message: `This will permanently delete the Return/Exchange history (${returnHistory.length} Records) and cannot be undone!`,
      tone: "danger",
      confirmLabel: "Delete all",
      requireText: "DELETE",
    });
    if (!confirmed) return;
    try {
      const response = await axios.delete(`${API_BASE_URL}/products/returns/clear-all`);
      showToast(response.data.message || "Return/Exchange history Cleared! 🧹");
      fetchReturnHistory();
    } catch (error) { showToast("Failed to Clear!", "error"); }
  };

  // --- CUSTOMER CRUD ---
  const handleCustomerSubmit = async (e) => {
    e.preventDefault();
    if (!isValidPhone(customerForm.phone)) {
      return showToast("⚠️ Please enter a valid phone number (e.g. 0771234567)", "warning");
    }
    try {
      if (isEditingCustomer) {
        // 🛠️ Set to match Port 5008 and the API Base URL
        await axios.put(`${API_BASE_URL}/customers/update/${editCustomerId}`, customerForm);
        setIsEditingCustomer(false);
        setEditCustomerId(null);
        showToast("Customer details updated successfully!");
      } else {
        const response = await axios.post(`${API_BASE_URL}/customers/add`, customerForm);
        showToast(response.data.message || "Customer added successfully!");
        setSelectedCustomer(response.data.customer);
      }
      setCustomerForm({ name: "", phone: "" });
      fetchCustomers();
    } catch (error) { showToast("Operation failed!", "error"); }
  };

  const handleEditCustomerClick = (customer) => {
    setIsEditingCustomer(true);
    setEditCustomerId(customer._id);
    setCustomerForm({ name: customer.name, phone: customer.phone });
  };

  const handleDeleteCustomerClick = async (id) => {
    const confirmed = await askConfirm({
      title: "Delete Customer",
      message: "Are you sure you want to delete this customer?",
      tone: "danger",
      confirmLabel: "Delete",
    });
    if (!confirmed) return;
    try {
      // 🛠️ Set to match Port 5008 and the API Base URL
      await axios.delete(`${API_BASE_URL}/customers/delete/${id}`);
      showToast("Deleted successfully!");
      fetchCustomers();
    } catch (error) { showToast("Failed to delete!", "error"); }
  };

  // 🛠️ UPDATED: Selecting a customer from the Dropdown or with the Enter key
  const handleSelectCustomer = (customer) => {
    setSelectedCustomer(customer);
    setSearchPhone(customer.name);
    setShowCustomerDropdown(false);
    setCustomerSuggestions([]);
    setHighlightedCustomerIndex(-1);
    showToast("Customer account linked successfully! 👤");
  };

  // 🛠️ UPDATED: Navigating the suggestions dropdown with the Keyboard (ArrowUp/Down + Enter + Escape)
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
        showToast("No customer found with this name or number!", "warning");
      }
    } else if (e.key === "Escape") {
      setShowCustomerDropdown(false);
      setHighlightedCustomerIndex(-1);
    }
  };

  const handleSettleCredit = async (e) => {
    e.preventDefault();
    // 🆕 If trying to record a Cash payment without an Open Shift - the cashier is informed and asked to confirm beforehand that it will not be
    // included in the Shift Close Cash Drawer calculation
    if ((creditPayment.paymentMethod || "Cash") === "Cash" && !ensureShiftOpen()) return;
    try {
      // 🆕 Uses the message that came from the backend as-is - if more than the credit is paid,
      // the cashier sees the note sent by the server right here, such as "Change to return: Rs.X"
      const response = await axios.post(`${API_BASE_URL}/customers/pay-credit/${creditPayment.customerId}`, {
        amount: creditPayment.amount,
        paymentMethod: creditPayment.paymentMethod || "Cash"
      });
      showToast(response.data.message || "Credit amount settled successfully! 🎉", response.data.changeGiven > 0 ? "warning" : "success");
      setCreditPayment({ customerId: "", amount: "", paymentMethod: "Cash" });
      fetchCustomers();
    } catch (error) { showToast(error.response?.data?.message || "Failed to settle credit!", "error"); }
  };

  // --- SUPPLIER CRUD ---
  const handleSupplierSubmit = async (e) => {
    e.preventDefault();
    if (!isValidPhone(supplierForm.phone)) {
      return showToast("⚠️ Please enter a valid phone number (e.g. 0771234567)", "warning");
    }
    try {
      if (isEditingSupplier) {
        await axios.put(`${API_BASE_URL}/suppliers/update/${editSupplierId}`, supplierForm);
        setIsEditingSupplier(false);
        setEditSupplierId(null);
        showToast("Supplier details updated successfully!");
      } else {
        await axios.post(`${API_BASE_URL}/suppliers/add`, supplierForm);
        showToast("Supplier added successfully! 🚚");
      }
      setSupplierForm({ name: "", phone: "", address: "" });
      fetchSuppliers();
    } catch (error) { showToast(error.response?.data?.message || "Operation failed!", "error"); }
  };

  const handleEditSupplierClick = (supplier) => {
    setIsEditingSupplier(true);
    setEditSupplierId(supplier._id);
    setSupplierForm({ name: supplier.name, phone: supplier.phone, address: supplier.address || "" });
  };

  const handleDeleteSupplierClick = async (id) => {
    const confirmed = await askConfirm({
      title: "Delete Supplier",
      message: "Are you sure you want to delete this supplier?",
      tone: "danger",
      confirmLabel: "Delete",
    });
    if (confirmed) {
      try {
        await axios.delete(`${API_BASE_URL}/suppliers/delete/${id}`);
        showToast("Deleted successfully!");
        fetchSuppliers();
      } catch (error) { showToast("Failed to delete!", "error"); }
    }
  };

  // 🆕 PROFESSIONAL GRN REBUILD: Adding the current Row to the GRN List (with Ordered Qty + Expiry Date)
  const handleAddGrnItem = () => {
    if (!grnCurrentItem.productId) {
      return showToast("Please select an item!", "warning");
    }
    if (!grnCurrentItem.quantity || parseFloat(grnCurrentItem.quantity) <= 0) {
      return showToast("Please enter a valid received quantity!", "warning");
    }
    if (!grnCurrentItem.costPrice || parseFloat(grnCurrentItem.costPrice) <= 0) {
      return showToast("Please enter a valid purchase price!", "warning");
    }

    const product = products.find(p => p._id === grnCurrentItem.productId);
    if (!product) return showToast("Item not found!", "error");

    const orderedQty = parseFloat(grnCurrentItem.orderedQty) || 0;
    const receivedQty = parseFloat(grnCurrentItem.quantity);

    setGrnItems([...grnItems, {
      productId: product._id,
      productName: product.name,
      unit: product.unit ?? "Kg",
      orderedQty,
      quantity: receivedQty,
      costPrice: parseFloat(grnCurrentItem.costPrice),
      expiryDate: grnCurrentItem.expiryDate || "",
      stockMode: grnCurrentItem.stockMode || "add",
      // 🆕 For UI - if an Ordered Qty was noted and it differs from the Received Qty, highlight it
      hasDiscrepancy: orderedQty > 0 && orderedQty !== receivedQty,
    }]);

    // Resets the row, type the next item
    setGrnCurrentItem({ productId: "", orderedQty: "", quantity: "", costPrice: "", expiryDate: "", stockMode: "add" });
  };

  // 🛠️ NEW: Remove an item from the GRN List
  const handleRemoveGrnItem = (index) => {
    setGrnItems(grnItems.filter((_, i) => i !== index));
  };

  // 🆕 PROFESSIONAL GRN REBUILD: Submits all Items in the List at once and creates a GRN Document
  const handleSubmitGrn = async () => {
    if (!grnSupplierId) return showToast("Please select a supplier!", "warning");
    if (grnItems.length === 0) return showToast("Please add at least one item to the GRN List!", "warning");

    setIsSubmittingGrn(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/suppliers/record-purchase/${grnSupplierId}`, {
        items: grnItems.map(item => ({
          productId: item.productId,
          orderedQty: item.orderedQty,
          receivedQty: item.quantity,
          costPrice: item.costPrice,
          expiryDate: item.expiryDate || null,
          stockMode: item.stockMode,
        })),
        description: grnDescription,
        supplierInvoiceRef: grnSupplierInvoiceRef,
        receivedBy: user?.username || "",
      });
      showToast(response.data.message || "GRN recorded successfully! 📦");
      setGrnSupplierId("");
      setGrnSupplierInvoiceRef("");
      setGrnItems([]);
      setGrnCurrentItem({ productId: "", orderedQty: "", quantity: "", costPrice: "", expiryDate: "", stockMode: "add" });
      setGrnDescription("");
      fetchSuppliers();
      fetchProducts(); // 🛠️ Refreshes the Products list since Stock and Cost Price have changed
      if (response.data?.grn) {
        setGrnHistory(prev => [response.data.grn, ...prev]);
      }
    } catch (error) {
      showToast(error.response?.data?.message || "Failed to record!", "error");
    } finally {
      setIsSubmittingGrn(false);
    }
  };

  // 🆕 Fetch GRN History (with filters)
  const fetchGrnHistory = async () => {
    setIsLoadingGrnHistory(true);
    try {
      const params = {};
      if (grnHistoryFilters.supplierId) params.supplierId = grnHistoryFilters.supplierId;
      if (grnHistoryFilters.from) params.from = grnHistoryFilters.from;
      if (grnHistoryFilters.to) params.to = grnHistoryFilters.to;
      if (grnHistoryFilters.q) params.q = grnHistoryFilters.q;
      const response = await axios.get(`${API_BASE_URL}/suppliers/grn/list`, { params });
      setGrnHistory(response.data);
    } catch (error) {
      showToast("Failed to fetch GRN history!", "error");
    } finally {
      setIsLoadingGrnHistory(false);
    }
  };

  // 🆕 Print/PDF a GRN - opens a document prepared specifically for printing in a new window
  const handlePrintGrn = (grn) => {
    const printWindow = window.open("", "_blank", "width=800,height=900");
    if (!printWindow) return showToast("Could not open the Print Window because of the Pop-up Blocker!", "error");

    const rowsHtml = grn.items.map((item, i) => `
      <tr>
        <td style="padding:6px;border:1px solid #ddd;">${i + 1}</td>
        <td style="padding:6px;border:1px solid #ddd;">${item.productName}</td>
        <td style="padding:6px;border:1px solid #ddd;text-align:right;">${item.orderedQty || "-"}</td>
        <td style="padding:6px;border:1px solid #ddd;text-align:right;">${item.receivedQty} ${item.unit || ""}</td>
        <td style="padding:6px;border:1px solid #ddd;text-align:right;">Rs. ${Number(item.costPrice).toFixed(2)}</td>
        <td style="padding:6px;border:1px solid #ddd;text-align:right;">Rs. ${Number(item.subtotal).toFixed(2)}</td>
        <td style="padding:6px;border:1px solid #ddd;">${item.expiryDate ? new Date(item.expiryDate).toLocaleDateString() : "-"}</td>
      </tr>
    `).join("");

    printWindow.document.write(`
      <html>
        <head>
          <title>${grn.grnNo}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #1e293b; }
            h1 { font-size: 20px; margin-bottom: 2px; }
            table { border-collapse: collapse; width: 100%; margin-top: 16px; font-size: 12px; }
            th { background: #f1f5f9; padding: 6px; border: 1px solid #ddd; text-align: left; }
            .meta { font-size: 12px; margin-top: 10px; line-height: 1.6; }
            .badge { display:inline-block; padding:2px 8px; border-radius: 10px; font-size: 11px; font-weight: bold; }
            .total { text-align: right; font-size: 14px; font-weight: bold; margin-top: 10px; }
          </style>
        </head>
        <body>
          <h1>📦 Goods Received Note</h1>
          <div class="meta">
            <div><b>GRN No:</b> ${grn.grnNo}</div>
            <div><b>Date:</b> ${new Date(grn.date).toLocaleString()}</div>
            <div><b>Supplier:</b> ${grn.supplierName}</div>
            ${grn.supplierInvoiceRef ? `<div><b>Supplier Invoice Ref:</b> ${grn.supplierInvoiceRef}</div>` : ""}
            <div><b>Status:</b> <span class="badge" style="background:${grn.hasDiscrepancy ? "#fee2e2" : "#dcfce7"};color:${grn.hasDiscrepancy ? "#b91c1c" : "#15803d"};">${grn.status}</span></div>
            ${grn.notes ? `<div><b>Notes:</b> ${grn.notes}</div>` : ""}
            ${grn.receivedBy ? `<div><b>Received By:</b> ${grn.receivedBy}</div>` : ""}
          </div>
          <table>
            <thead>
              <tr><th>#</th><th>Product</th><th>Ordered</th><th>Received</th><th>Cost Price</th><th>Subtotal</th><th>Expiry</th></tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
          <div class="total">Grand Total: Rs. ${Number(grn.grandTotal).toFixed(2)}</div>
          <script>window.onload = () => window.print();</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // 🛠️ NEW: Pay money to a Supplier (reduces Balance Due)
  const handleSettleSupplierPayment = async (e) => {
    e.preventDefault();
    // 🆕 If trying to record a Cash payment without an Open Shift - it will not be deducted from the Drawer count
    // so the user is notified and asked to confirm beforehand
    if ((supplierPayment.paymentMethod || "Cash") === "Cash" && !ensureShiftOpen()) return;
    try {
      // 🆕 Uses the message that came from the backend as-is - if more than the credit amount was paid,
      // the note sent by the server such as "Amount to be returned: Rs.X" is shown right here
      const response = await axios.post(`${API_BASE_URL}/suppliers/pay/${supplierPayment.supplierId}`, {
        amount: supplierPayment.amount,
        paymentMethod: supplierPayment.paymentMethod || "Cash"
      });
      showToast(response.data.message || "Payment recorded successfully! 💵", response.data.changeGiven > 0 ? "warning" : "success");
      setSupplierPayment({ supplierId: "", amount: "", paymentMethod: "Cash" });
      fetchSuppliers();
    } catch (error) { showToast(error.response?.data?.message || "Payment failed!", "error"); }
  };

  // --- BILLING LOGIC ---
  // 🆕 MULTI-PRICE: Helper to get the Active (stock remaining) Price Batches of an item
  const getActivePriceBatches = (product) => {
    if (!Array.isArray(product.batches)) return [];
    return product.batches.filter((b) => parseFloat(b.stock) > 0);
  };

  // 🆕 TRUE total stock: for products with price batches, the SUM of the batches'
  // own stock is the real source of truth — not the separate product.stock field,
  // which can silently drift out of sync with the batches (e.g. shows 18 while the
  // batches actually sum to 17, or shows 3 while they sum to 4). Every place that
  // displays or checks a product's stock should read through this, not product.stock
  // directly, so the number shown always matches what's actually sellable.
  const getTotalStock = (product) => {
    if (Array.isArray(product.batches) && product.batches.length > 0) {
      return product.batches.reduce((sum, b) => sum + (parseFloat(b.stock) || 0), 0);
    }
    return parseFloat(product.stock) || 0;
  };

  // 🆕 MULTI-PRICE: Set a Default Label for a Batch (if the Admin has not given a Label)
  const getBatchDisplayLabel = (batch, index, total) => {
    if (batch.label) return batch.label;
    if (total <= 1) return "";
    if (index === 0) return "Old Price";
    if (index === total - 1) return "New Price";
    return `Price ${index + 1}`;
  };

  // 🛠️ UPDATED (Multi-Price Popup): If a scannedBatch is given, adds directly to the Cart at that price,
  //     otherwise if the Product has multiple Price Batches, shows the Popup to choose from
  // 🆕 STOCK-AWARE QUANTITY: single source of truth for "how much of this exact
  // item/batch is actually available right now" — used everywhere qty can change,
  // so a cashier can never scan/click/type past what's actually in stock.
  const getAvailableStock = (item) => {
    if (item.isTemporary) return Infinity; // emergency items aren't stock-tracked the same way
    const dbProduct = products.find(p => p._id === item._id);
    if (!dbProduct) return parseFloat(item.stock) || 0;
    if (item.batchId && Array.isArray(dbProduct.batches)) {
      const batch = dbProduct.batches.find(b => b.batchId === item.batchId);
      return batch ? (parseFloat(batch.stock) || 0) : 0;
    }
    return getTotalStock(dbProduct);
  };

  const addToCart = (product, selectedBatch = null) => {
    // 🆕 EXPIRY CHECK: Does not allow selling an expired item
    const expiryStatus = getExpiryStatus(product);
    if (expiryStatus === "expired") {
      return showToast(`🚫 "${product.name}" has expired! (${new Date(product.expiryDate).toLocaleDateString()}) - This cannot be sold.`, "error");
    }
    if (expiryStatus === "expiring") {
      showToast(`⚠️ "${product.name}" expires soon (${new Date(product.expiryDate).toLocaleDateString()})! Sell with caution.`, "warning");
    }

    // 🆕 MULTI-PRICE CHECK: If no Batch has been selected yet, and the Product has more than 1 Active Batch - show the Popup
    const activeBatches = getActivePriceBatches(product);
    if (!selectedBatch && activeBatches.length > 1) {
      setMultiPricePopup(product);
      return;
    }

    // If a Batch exists (whether selected or the only one), uses its price/stock
    const activeBatch = selectedBatch || (activeBatches.length === 1 ? activeBatches[0] : null);
    const effectivePrice = activeBatch ? parseFloat(activeBatch.price) : parseFloat(product.price);
    const batchId = activeBatch ? activeBatch.batchId : null; // 🛠️ The batch identity string in the Backend schema (not the Mongo _id)
    const batchIndex = activeBatch ? activeBatches.findIndex(b => b.batchId === batchId) : -1;
    const batchLabel = activeBatch ? getBatchDisplayLabel(activeBatch, batchIndex, activeBatches.length) : null;
    const batchCostPrice = activeBatch ? parseFloat(activeBatch.costPrice || product.costPrice || 0) : parseFloat(product.costPrice || 0);
    const batchMarketPrice = activeBatch ? parseFloat(activeBatch.marketPrice || product.marketPrice || effectivePrice) : parseFloat(product.marketPrice || product.price);
    // 🆕 The discount % specific to this Batch (batch.discount) - used in place of the Product-level Discount only if it is explicitly set above 0
    // (This guard exists so that if a Default Batch has no discount it stays 0, and the Product-level Discount of normal Products does not break)
    const batchDiscount = activeBatch && parseFloat(activeBatch.discount) > 0
      ? parseFloat(activeBatch.discount)
      : parseFloat(product.discount || product.discountPercent || 0);
    // 🆕 Unique Identity of the Cart line - because two Batches of the same Product must appear separately in the cart
    const cartLineId = batchId ? `${product._id}__${batchId}` : product._id;

    // 🆕 OUT-OF-STOCK CHECK: an empty shelf can't be added to a bill, full stop
    const stockNow = activeBatch ? (parseFloat(activeBatch.stock) || 0) : getTotalStock(product);
    if (!product.isTemporary && stockNow <= 0) {
      return showToast(`🚫 "${product.name}"${batchLabel ? ` (${batchLabel})` : ""} is out of stock! (Out of stock)`, "error");
    }

    const existingIndex = cart.findIndex((item) => item.cartLineId === cartLineId);
    if (existingIndex !== -1) {
      const newCart = [...cart];
      const currentQty = parseFloat(newCart[existingIndex].qty) || 0;
      if (!product.isTemporary && currentQty + 1 > stockNow) {
        return showToast(`⚠️ Cannot add more — only ${formatQtyWithUnit(stockNow, product.unit ?? "Kg")} in stock.`, "warning");
      }
      newCart[existingIndex].qty = currentQty + 1;
      setCart(newCart);
    } else {
      // 🆕 STOCK CAP on the very first add too: a tile always used to add exactly "1"
      // regardless of unit — for a Kg item with 0.6kg left, that meant 1kg landed in
      // the bill despite only 600g actually being in stock. Now it caps to what's there.
      const initialQty = product.isTemporary ? 1 : Math.min(1, stockNow);
      if (!product.isTemporary && stockNow < 1) {
        showToast(`ℹ️ Only ${formatQtyWithUnit(stockNow, product.unit ?? "Kg")} in stock — added that full quantity.`, "warning");
      }
      setCart([...cart, {
        ...product,
        qty: initialQty,
        price: effectivePrice, // 🆕 Overrides with the price of the selected Batch
        costPrice: batchCostPrice, // 🆕 So profit is calculated from this Batch's own Cost Price
        marketPrice: batchMarketPrice, // 🆕 So Savings are calculated from this Batch's own MRP
        discount: batchDiscount, // 🆕 So reports are calculated correctly from this Batch's own discount
        discountPercent: batchDiscount, // 🛠️ Also set here because the discP calculation code checks item.discountPercent first
        batchId,
        batchLabel,
        cartLineId
      }]);
    }
    showToast(`"${product.name}"${batchLabel ? ` (${batchLabel} - Rs.${effectivePrice.toFixed(2)})` : ""} added to the bill`);
    setMultiPricePopup(null); // Close if it was selected from the Popup
  };

  // Emergency Temp Item Add Logic (Does not hit DB, directly into Cart)
  const handleAddTempItemToCart = async (e) => {
    e.preventDefault();
    if (!tempItemForm.name || !tempItemForm.price || !tempItemForm.qty) {
      return showToast("Please enter the name, price and quantity!", "warning");
    }

    const qty = parseFloat(tempItemForm.qty);
    const price = parseFloat(tempItemForm.price);

    // 🆕 If the "Also Register in Database" checkbox is checked
    if (registerTempAsProduct) {
      // 🛠️ Duplicate Prevention: Checks whether a Product with this same name already exists in the Catalog
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
        showToast(`ℹ️ A Product named "${existingProduct.name}" already exists in the Catalog — added that same one to the Bill (no Duplicate).`, "warning");
        setTempItemForm({ name: "", price: "", qty: "1", unit: "Kg", barcode: "" });
        setRegisterTempAsProduct(false);
        return;
      }

      try {
        const registrationPayload = {
          name: tempItemForm.name,
          price,
          marketPrice: price,
          costPrice: price * 0.85, // 🛠️ This is an Estimate - correct it later in Admin > Stock Management
          stock: qty, // 🛠️ The quantity currently being sold is registered as the Initial Stock (becomes 0 after the Sale)
          unit: tempItemForm.unit,
          category: "Other", // 🛠️ Admin can select a proper Category later
          minStockLevel: 5
        };
        // 🛠️ FIX: If the Barcode field is blank, removes it from the request entirely (if an empty string "" is sent,
        // and barcode has a Unique Index, it causes a 500 error with a Duplicate Key Error (E11000))
        if (tempItemForm.barcode && tempItemForm.barcode.trim() !== "") {
          registrationPayload.barcode = tempItemForm.barcode.trim();
        }

        const response = await axios.post(`${API_BASE_URL}/products/add`, registrationPayload);

        const newProduct = response.data.product;
        setCart([...cart, {
          ...newProduct,
          unit: tempItemForm.unit, // 🛠️ FIX: Forces the exact Unit the User selected (including Empty) - does not trust the Backend response
          cartLineId: `real_${newProduct._id}_${Date.now()}`,
          qty,
          discount: 0,
          discountPercent: 0,
          isTemporary: false
        }]);
        showToast(`✅ "${newProduct.name}" registered in the Database and added to the Bill too! 🗄️`);
        setTempItemForm({ name: "", price: "", qty: "1", unit: "Kg", barcode: "" });
        setRegisterTempAsProduct(false);
        fetchProducts(); // 🛠️ Also refreshes the Products list, so the new Product can be found in Billing Search
        return;
      } catch (error) {
        // 🛠️ Even if Registration fails, does not stop the Sale - adds it to the Bill as a Temp Item
        console.error("Product registration failed:", error.response?.data || error.message);
        const backendMsg = error.response?.data?.message || error.response?.data?.error;
        showToast(`⚠️ Database Registration failed${backendMsg ? ` (${backendMsg})` : ""} - temporarily added to the Bill.`, "warning");
      }
    }

    const tempProduct = {
      // 🛠️ Gives an Unsaved new item a Dynamic ID generated by the Front-end
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
      cartLineId: `temp_${Date.now()}` // 🛠️ To match the Multi-Price cart line identity
    };

    setCart([...cart, tempProduct]);
    showToast(`"${tempProduct.name}" temporarily added to the bill! 📥`, "warning");
    setTempItemForm({ name: "", price: "", qty: "1", unit: "Kg", barcode: "" });
    setRegisterTempAsProduct(false);
  };

  // 🛠️ UPDATED (Multi-Price): Matches by cartLineId instead of _id (to handle the case where two Batches of the same Product are in the cart)
  // 🆕 STOCK CAP: typing a qty higher than what's in stock now clamps to the max available, with a warning
  const updateCartQtyDirectly = (lineId, value) => {
    const newCart = cart.map((item) => {
      if (item.cartLineId !== lineId) return item;
      if (value === "") return { ...item, qty: "" };
      const desired = parseFloat(value);
      if (isNaN(desired)) return item;
      if (!item.isTemporary) {
        const stockNow = getAvailableStock(item);
        if (desired > stockNow) {
          showToast(`⚠️ Only ${formatQtyWithUnit(stockNow, item.unit ?? "Kg")} in stock — adjusted to that quantity.`, "warning");
          return { ...item, qty: stockNow };
        }
      }
      return { ...item, qty: desired };
    });
    setCart(newCart);
  };

  // 🆕 GRAM-MODE INPUT: User types in grams (Whole Numbers such as 500, 250) - converts to Kg for Storage
  // 🆕 STOCK CAP: same clamp as above, converted through grams → kg first
  const updateCartQtyDirectlyInGrams = (lineId, gramsValue) => {
    const newCart = cart.map((item) => {
      if (item.cartLineId !== lineId) return item;
      if (gramsValue === "") return { ...item, qty: "" };
      const grams = parseFloat(gramsValue);
      if (isNaN(grams)) return item;
      const desiredKg = grams / 1000;
      if (!item.isTemporary) {
        const stockNow = getAvailableStock(item);
        if (desiredKg > stockNow) {
          showToast(`⚠️ Only ${formatQtyWithUnit(stockNow, item.unit ?? "Kg")} in stock — adjusted to that quantity.`, "warning");
          return { ...item, qty: stockNow };
        }
      }
      return { ...item, qty: desiredKg };
    });
    setCart(newCart);
  };

  // 🆕 Toggle the Manual Quantity Input of a Cart Line between Kg / g Modes
  const toggleQtyInputUnit = (lineId, mode) => {
    setCart(cart.map((item) => (item.cartLineId === lineId ? { ...item, qtyInputUnit: mode } : item)));
  };

  const updateQty = (lineId, amount) => {
    const newCart = cart.map((item) => {
      if (item.cartLineId === lineId) {
        const newQty = roundQty(parseFloat(item.qty) + amount); // 🛠️ Prevents drift from repeated -100g/+100g clicks
        const floored = newQty < 0.001 ? 0.001 : newQty;
        // 🆕 STOCK CAP: "+" can never push qty past what's actually in stock
        if (amount > 0 && !item.isTemporary) {
          const stockNow = getAvailableStock(item);
          if (floored > stockNow) {
            showToast(`⚠️ Cannot add more — only ${formatQtyWithUnit(stockNow, item.unit ?? "Kg")} in stock.`, "warning");
            return { ...item, qty: stockNow < 0.001 ? 0.001 : stockNow };
          }
        }
        return { ...item, qty: floored };
      }
      return item;
    });
    setCart(newCart);
  };

  // 🆕 Subtotal with only Item-level discounts applied (before the Bill-level Discount)
  // 🛠️ ROUNDING FIX: The Server (productRoutes.js /checkout) does the same - unit discount -> line total ->
  // subtotal -> bill discount -> total, rounding to 2 decimal places at every step, so the Receipt/POS total and
  // the bill amount in the Sales Report do not differ by even a cent.
  const money = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;
  const unitDiscountAmount = (item) => {
    const discP = parseFloat(item.discountPercent || item.discount) || 0;
    return money((parseFloat(item.price) * discP) / 100);
  };
  const calculateSubtotal = () => money(cart.reduce((total, item) => {
    const finalPrice = parseFloat(item.price) - unitDiscountAmount(item);
    return total + money(finalPrice * parseFloat(item.qty || 0));
  }, 0));

  // 🆕 Rupee value of the Applied Occasion Promotion
  const calculateBillDiscountAmount = () => {
    if (!appliedBillDiscount) return 0;
    return money(calculateSubtotal() * (appliedBillDiscount.percent / 100));
  };

  // 🛠️ UPDATED: The Final Total is after also deducting the Bill-level Discount - Checkout/Print/Cash-validation are all derived from this
  const calculateTotal = () => Math.max(0, money(calculateSubtotal() - calculateBillDiscountAmount()));

  const handleCheckoutAndPrint = async () => {
    if (cart.length === 0) return showToast("The bill is empty!", "warning");
    if (!ensureShiftOpen()) return;
    
    const total = calculateTotal();
    const paid = paymentMethod === "Credit" 
      ? (amountPaid === "" ? 0 : parseFloat(amountPaid)) 
      : total;
      
    const receivedCash = parseFloat(cashReceived) || 0;

    // Stock Validation
    for (const item of cart) {
      if (item.isTemporary) continue; 
      const dbProduct = products.find(p => p._id === item._id);
      // 🛠️ UPDATED (Multi-Price): If a batchId is selected, checks the remaining stock of that same Batch
      let availableStock = dbProduct ? getTotalStock(dbProduct) : 0;
      if (item.batchId && dbProduct && Array.isArray(dbProduct.batches)) {
        const dbBatch = dbProduct.batches.find(b => b.batchId === item.batchId);
        availableStock = dbBatch ? parseFloat(dbBatch.stock) : 0;
      }
      if (parseFloat(item.qty) > availableStock) {
        return showToast(`🚫 Insufficient stock! "${item.name}"${item.batchLabel ? ` (${item.batchLabel})` : ""} in stock: ${formatQtyWithUnit(availableStock, item.unit ?? 'Kg')}`, "error");
      }
    }

    if (paymentMethod === "Credit" && parseFloat(amountPaid) > total) {
      return showToast(`⚠️ Paid Amount cannot be more than the total.`, "error");
    }

    if (paymentMethod === "Cash" && receivedCash < total) {
      return showToast(`💵 The amount received cannot be less than the bill total.`, "error");
    }

    if (paid < total && !selectedCustomer) {
      return showToast("There is an outstanding balance! Please attach a customer. 👤", "warning");
    }

    // Cart Object prepared to send to the Backend and the Offline DB
    const preparedCartItems = cart.map(item => {
      const discP = parseFloat(item.discountPercent || item.discount) || 0;
      return {
        ...item,
        _id: item.isTemporary ? null : item._id,
        batchId: item.batchId || null, // 🆕 Multi-Price: Sent to the server so stock is deducted from the selected Batch itself
        discount: unitDiscountAmount(item)
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
      amountDue: total - paid,
      // 🆕 Bill-level Discount details (for Audit/Reporting)
      billDiscountSource: appliedBillDiscount ? "occasion" : null,
      billDiscountName: appliedBillDiscount?.name || null,
      billDiscountPercent: appliedBillDiscount?.percent || 0,
      billDiscountAmount: calculateBillDiscountAmount()
    };

    // 🆕 ON-DEMAND PRINTING: Before the cart is reset, all the data needed for the receipt is frozen
    // as a snapshot - so even if the cashier goes to print after the cart is reset, the receipt displays correctly.
    const buildSaleSnapshot = (invoiceNo, isOffline) => ({
      id: `sale_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      invoiceNo,
      isOffline,
      printed: false, // 🆕 Tracks whether this bill has been printed - for the badge in the "Reprint/Bills" panel
      cashierName: user.username,
      date: new Date().toISOString(),
      // 🆕 For the Customer line on the Receipt - the name if a Credit customer is attached,
      // otherwise (Cash/Card/QR, without a customer) shows "Cash Customer"
      customerLabel: (paymentMethod === "Credit" && selectedCustomer)
        ? selectedCustomer.name
        : "Cash Customer",
      items: cart,
      paymentMethod,
      appliedBillDiscount,
      subtotal: calculateSubtotal(),
      billDiscountAmount: calculateBillDiscountAmount(),
      total,
      amountPaid: paid,
      cashReceived: receivedCash,
      balanceAmount
    });

    try {
      // 🌐 ONLINE: Tries to send the data to the server
      const checkoutResponse = await axios.post(`${API_BASE_URL}/products/checkout`, checkoutData);

      // 🆕 If the auto-print toggle is off, shows a "Sale Complete" modal and lets the cashier decide
      // - whether to Print, or go straight to the next bill. If On, prints instantly.
      const completedSale = buildSaleSnapshot(checkoutResponse.data.invoiceNo || null, false);
      flushSync(() => {
        setLastCompletedSale(completedSale);
        setShowSaleCompleteModal(true);
      });
      // 🆕 Even if not printed, this bill is also added to the "Recent Bills" queue - so it can be printed later whenever needed
      setRecentBills((prev) => pruneRecentBills([completedSale, ...prev]));
      // 🆕 SPEED: If Auto-print is on, since flushSync has already finished updating the receipt DOM, prints instantly
      if (autoPrintReceipt) {
        window.print();
        setRecentBills((prev) => prev.map((b) => (b.id === completedSale.id ? { ...b, printed: true } : b)));
      }
      resetBillingUI();
      fetchProducts();
      fetchCustomers();
      // 🛠️ FIX: After Checkout, also refreshes the Sales Summary - so things like the Unregistered Items tab, Sales Logs,
      // and Revenue/Profit stats update Instantly without a Page Refresh
      if (user.role === "admin") fetchSalesSummary();

    } catch (error) {
      // 📴 OFFLINE: If there is no internet, saves the bill in the browser
      if (!navigator.onLine || error.message === "Network Error") {
        try {
          await db.offlineSales.add({
            ...checkoutData,
            shiftId: activeShift?._id || null, // 🔐 The server verifies this Shift when Syncing
            createdAt: new Date().toISOString(),
            status: "pending"
          });

          // Only a temporary Reference for an Offline bill - a real Invoice Number is received only after it is Synced
          const offlineCompletedSale = buildSaleSnapshot(`OFFLINE-${Date.now()}`, true);
          flushSync(() => {
            setLastCompletedSale(offlineCompletedSale);
            setShowSaleCompleteModal(true);
          });
          setRecentBills((prev) => pruneRecentBills([offlineCompletedSale, ...prev]));
          if (autoPrintReceipt) {
            window.print();
            setRecentBills((prev) => prev.map((b) => (b.id === offlineCompletedSale.id ? { ...b, printed: true } : b)));
          }
          resetBillingUI();
          showToast("⚠️ No internet! Bill saved safely in the browser. 📴", "warning");
          
        } catch (dbError) {
          showToast("Failed to save to the Local Database!", "error");
        }
      } else {
        if (error.response?.data?.code === "SHIFT_REQUIRED") setShowStartShiftModal(true);
        showToast(error.response?.data?.message || "Checkout failed!", "error");
      }
    }
  };

  // 🆕 Print the receipt of the last sold bill whenever the cashier needs - since checkout does not
  // auto-print, this is the only way to print (both the "Print" button of the Sale Complete modal,
  // and the "Reprint" button of the Billing screen call this same function).
  const handlePrintReceipt = () => {
    if (!lastCompletedSale) return showToast("No Bill to Print!", "warning");
    // 🛠️ flushSync: Ensures the receipt DOM has finished rendering before printing
    flushSync(() => { setShowSaleCompleteModal(false); });
    window.print();
    // 🆕 Also marks it as "printed" in the Recent Bills queue
    setRecentBills((prev) => prev.map((b) => (b.id === lastCompletedSale.id ? { ...b, printed: true } : b)));
  };

  // 🆕 PRINT A SPECIFIC bill from the RECENT BILLS QUEUE - not just the "last completed" one,
  // any older bill that was not printed before (or needs a reprint) can be printed from here.
  const handlePrintRecentBill = (billId) => {
    const bill = recentBills.find((b) => b.id === billId);
    if (!bill) return;
    flushSync(() => {
      setLastCompletedSale(bill);
      setShowSaleCompleteModal(false);
      setShowRecentBillsPanel(false);
    });
    window.print();
    setRecentBills((prev) => prev.map((b) => (b.id === billId ? { ...b, printed: true } : b)));
  };

  // 🆕 SHIFT / CASH DRAWER RECONCILIATION -----------------------------------------------

  // On Login/Page refresh, check whether there is currently an Open Shift. If not, the Start Shift
  // modal is shown automatically (does not block the billing screen - if the cashier wishes they can "Skip" it
  // and do it later from the "Start Shift" button in the header, so it does not break the existing workflow).
  const fetchCurrentShift = async () => {
    setIsLoadingShift(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/shifts/current`);
      setActiveShift(response.data || null);
      try {
        if (response.data) localStorage.setItem("pos_active_shift", JSON.stringify({ username: user?.username, shift: response.data }));
        else localStorage.removeItem("pos_active_shift");
      } catch {}
      if (!response.data && user?.role !== "admin") setShowStartShiftModal(true); // No auto-popup for Admin
    } catch (error) {
      // 📴 Network error: So Billing is possible even Offline, uses the last known Open Shift
      // (if it is that same cashier's) from the cache. When Offline bills are Synced, the server re-verifies that Shift.
      console.error("Failed to fetch Shift status", error);
      try {
        const cached = JSON.parse(localStorage.getItem("pos_active_shift") || "null");
        if (cached?.shift && cached.username === user?.username) setActiveShift(cached.shift);
      } catch {}
    } finally {
      setIsLoadingShift(false);
    }
  };

  // 🔐 Billing/Return/Cash payments are not allowed without an Open Shift (the server enforces this too).
  // If not Open, shows the Start Shift modal.
  const ensureShiftOpen = () => {
    if (user?.role === "admin") return true; // 👑 Admin is allowed even without a Shift (noted as Admin in the Report)
    if (isLoadingShift) { showToast("Checking Shift status... please wait a moment.", "warning"); return false; }
    if (!activeShift) {
      setShowStartShiftModal(true);
      showToast("⛔ No Shift is Open! Start a Shift first.", "warning");
      return false;
    }
    return true;
  };

  const handleStartShift = async (e) => {
    e.preventDefault();
    try {
      const response = await axios.post(`${API_BASE_URL}/shifts/open`, {
        openingFloat: parseFloat(startShiftFloat) || 0,
      });
      setActiveShift(response.data.shift);
      try { localStorage.setItem("pos_active_shift", JSON.stringify({ username: user?.username, shift: response.data.shift })); } catch {}
      setShowStartShiftModal(false);
      setStartShiftFloat("");
      showToast(response.data.message || "Shift Opened! 🟢");
    } catch (error) {
      showToast(error.response?.data?.message || "Failed to Open the Shift!", "error");
    }
  };

  const handleCloseShift = async (e) => {
    e.preventDefault();
    if (closingCountedCash === "" || parseFloat(closingCountedCash) < 0) {
      return showToast("Enter the Cash amount counted in the Drawer!", "warning");
    }
    try {
      const response = await axios.post(`${API_BASE_URL}/shifts/close/${activeShift._id}`, {
        closingCountedCash: parseFloat(closingCountedCash),
      });
      setShiftCloseResult(response.data.shift); // 🆕 To show the Over/Short summary after Closing
      setActiveShift(null);
      try { localStorage.removeItem("pos_active_shift"); } catch {}
      setClosingCountedCash("");
      showToast(response.data.message || "Shift Closed!");
    } catch (error) {
      showToast(error.response?.data?.message || "Failed to Close the Shift!", "error");
    }
  };

  // 🆕 For the Admin "Shift History" tab
  const fetchOutsideActivity = async () => {
    setIsLoadingOutside(true);
    try {
      const params = {};
      if (outsideFilters.cashier) params.cashier = outsideFilters.cashier;
      if (outsideFilters.from) params.from = outsideFilters.from;
      if (outsideFilters.to) params.to = outsideFilters.to;
      if (!outsideFilters.includeAdmin) params.includeAdmin = "false";
      const response = await axios.get(`${API_BASE_URL}/shifts/outside-activity`, { params });
      setOutsideActivity(response.data);
    } catch (error) {
      showToast(error.response?.data?.message || "Failed to fetch the Report!", "error");
    } finally {
      setIsLoadingOutside(false);
    }
  };

  const fetchShiftHistory = async () => {
    setIsLoadingShiftHistory(true);
    try {
      const params = {};
      if (shiftHistoryFilters.cashier) params.cashier = shiftHistoryFilters.cashier;
      if (shiftHistoryFilters.from) params.from = shiftHistoryFilters.from;
      if (shiftHistoryFilters.to) params.to = shiftHistoryFilters.to;
      const response = await axios.get(`${API_BASE_URL}/shifts/history`, { params });
      setShiftHistory(response.data);
    } catch (error) {
      showToast("Failed to fetch Shift History!", "error");
    } finally {
      setIsLoadingShiftHistory(false);
    }
  };

  // 🆕 HOLD BILL: Holds the current cart (including customer, payment prefs) and starts
  // a new empty bill. The Held bill can be brought back any time from the "Held" panel.
  const handleHoldBill = () => {
    if (cart.length === 0) return showToast("Cannot Hold an empty bill!", "warning");
    const holdNo = nextHoldNo();
    const held = {
      id: `hold_${Date.now()}`,
      holdNo,
      note: "",
      heldAt: new Date().toISOString(),
      cashier: user?.username || null,
      cart,
      selectedCustomer,
      paymentMethod,
      cashReceived,
      amountPaid,
      appliedBillDiscount,
      label: selectedCustomer?.name || itemsPreview(cart) || `Bill with ${cart.length} item(s)`
    };
    setHeldBills((prev) => [held, ...prev]);
    resetBillingUI();
    showToast(`📌 Held as ${formatHoldNo(holdNo)}! (Tell the customer this number) • F6 = View Held bills`);
  };

  // 🆕 RESUME HELD BILL: Brings a Held bill back to the cart. If the current cart already has items
  // (if the cashier has added other items in between), that too is auto-held rather than discarded and
  // replaced - so none of the cashier's work is silently lost.
  const handleResumeHeldBill = (heldId) => {
    const target = myHeldBills.find((h) => h.id === heldId);
    if (!target) return;

    setHeldBills((prev) => {
      let next = prev.filter((h) => h.id !== heldId);
      if (cart.length > 0) {
        next = [{
          id: `hold_${Date.now()}`,
          holdNo: nextHoldNo(),
          note: "",
          heldAt: new Date().toISOString(),
          cashier: user?.username || null,
          cart, selectedCustomer, paymentMethod, cashReceived, amountPaid, appliedBillDiscount,
          label: selectedCustomer?.name || itemsPreview(cart) || `Bill with ${cart.length} item(s)`
        }, ...next];
      }
      return next;
    });

    setCart(target.cart);
    setSelectedCustomer(target.selectedCustomer);
    setPaymentMethod(target.paymentMethod);
    setCashReceived(target.cashReceived);
    setAmountPaid(target.amountPaid);
    setAppliedBillDiscount(target.appliedBillDiscount);
    setShowHeldBillsPanel(false);
    setHeldSearch("");
    showToast(cart.length > 0 ? "Bill resumed! ▶️ (Previous bill put on Hold)" : "Bill resumed! ▶️");
  };

  const handleSaveHoldNote = (heldId) => {
    const note = holdNoteDraft.trim().slice(0, 40);
    if (!myHeldBills.some((h) => h.id === heldId)) return;
    setHeldBills((prev) => prev.map((h) => (h.id === heldId ? { ...h, note } : h)));
    setEditingHoldNoteId(null);
    setHoldNoteDraft("");
  };

  // 🆕 DELETE HELD BILL: Completely removing a Held bill (e.g. when it is decided that the customer
  // will not come back) - with a confirm dialog, to prevent accidental deletion.
  const handleDeleteHeldBill = async (heldId) => {
    if (!myHeldBills.some((h) => h.id === heldId)) return;
    const confirmed = await askConfirm({
      title: "Delete Held Bill",
      message: "Are you sure you want to completely delete this Held bill? This cannot be undone.",
      tone: "danger",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
    });
    if (!confirmed) return;
    setHeldBills((prev) => prev.filter((h) => h.id !== heldId));
  };

  // Helper Function that Resets the UI (place it below handleCheckoutAndPrint)
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
    setAppliedBillDiscount(null); // 🆕 Bill Discount is also Reset
  };

  const handleVoidSale = async (saleId) => {
    const confirmed = await askConfirm({
      title: "Void Bill",
      message: "Do you want to void this bill?",
      tone: "danger",
      confirmLabel: "Void",
      cancelLabel: "Cancel",
    });
    if (!confirmed) return;
    try {
      await axios.post(`${API_BASE_URL}/products/void-sale/${saleId}`);
      showToast("Bill voided successfully!");
      fetchProducts();
      fetchSalesSummary();
      fetchCustomers();
    } catch (error) { showToast("Failed!", "error"); }
  };

  // 🆕 Permanently Clear the entire sales history (Sales Logs)
  // ⚠️ Since this is a Destructive action, there is a Type-to-Confirm guard - you must type "DELETE" to confirm
  const handleClearAllSales = async () => {
    const confirmed = await askConfirm({
      title: "Clear Sales History!",
      message: `This will Delete the sales history (${salesSummary.sales?.length || 0} Records) completely and irreversibly!`,
      tone: "danger",
      confirmLabel: "Delete All",
      requireText: "DELETE",
    });
    if (!confirmed) return;
    try {
      const response = await axios.delete(`${API_BASE_URL}/products/sales/clear-all`);
      showToast(response.data.message || "Sales history Cleared! 🧹");
      fetchSalesSummary();
    } catch (error) { showToast("Failed to Clear!", "error"); }
  };

  // --- RETURN / REFUND / EXCHANGE LOGIC ---

  // Find an old bill by Invoice number
  const handleSearchInvoiceForReturn = async (e, idOverride) => {
    if (e && e.preventDefault) e.preventDefault();
    // 🛠️ If an idOverride is given (such as from the "🔄 Return" Button in the Sales Report), it takes Priority -
    //     to avoid the React state staleness problem when calling setReturnInvoiceSearch() and Searching immediately
    const rawId = idOverride ?? returnInvoiceSearch;
    if (!rawId || !rawId.trim()) return showToast("Please enter the bill number!", "warning");
    setReturnLoading(true);
    try {
      // 🛠️ FIX: Since the "#" symbol is treated as a URL "Fragment" (Anchor) symbol,
      //          the Browser itself cuts off the part after # before even sending it to the Server!
      //          So before sending the Request, removes the # and makes it Safe with encodeURIComponent.
      const cleanId = rawId.trim().replace(/^#/, "");
      const response = await axios.get(`${API_BASE_URL}/products/invoice/${encodeURIComponent(cleanId)}`);
      setReturnSaleData(response.data);
      setReturnSelections({});
      showToast("Bill found successfully! 🧾");
    } catch (error) {
      setReturnSaleData(null);
      showToast(error.response?.data?.message || "This bill number could not be found!", "error");
    } finally {
      setReturnLoading(false);
    }
  };

  // Change the Qty/Reason of an Item being Returned
  const handleReturnSelectionChange = (itemId, field, value) => {
    setReturnSelections((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], [field]: value }
    }));
  };

  // Calculate the total amount to be Refunded from the selected items
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

  // Add a new item to the Exchange Cart
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

  // Send the Return/Refund to the Server
  const handleProcessReturn = async () => {
    if (!ensureShiftOpen()) return;
    if (!returnSaleData) return;

    const itemsToReturn = returnSaleData.items
      .filter((item) => returnSelections[item._id]?.qty && parseFloat(returnSelections[item._id].qty) > 0)
      .map((item) => ({
        itemId: item._id,
        returnQty: parseFloat(returnSelections[item._id].qty),
        reason: returnSelections[item._id].reason || "Not specified"
      }));

    if (itemsToReturn.length === 0) return showToast("Please enter a quantity of items to Return!", "warning");

    try {
      const response = await axios.post(`${API_BASE_URL}/products/return`, {
        saleId: returnSaleData._id,
        cashierName: user.username,
        refundMethod,
        items: itemsToReturn
      });
      showToast(response.data.message || "Return successful! ✅");
      resetReturnUI();
      fetchProducts();
      fetchCustomers();
      if (user.role === "admin") { fetchSalesSummary(); fetchReturnHistory(); }
    } catch (error) {
      showToast(error.response?.data?.message || "Return failed!", "error");
    }
  };

  // Send the Exchange to the Server (Return + new Sale at once)
  const handleProcessExchange = async () => {
    if (!returnSaleData) return;
    if (!ensureShiftOpen()) return;
    if (exchangeCart.length === 0) return showToast("Select the new items to Exchange!", "warning");

    const returnItems = returnSaleData.items
      .filter((item) => returnSelections[item._id]?.qty && parseFloat(returnSelections[item._id].qty) > 0)
      .map((item) => ({
        itemId: item._id,
        returnQty: parseFloat(returnSelections[item._id].qty),
        reason: returnSelections[item._id].reason || "Exchange"
      }));

    if (returnItems.length === 0) return showToast("Please enter a quantity of old items to Return!", "warning");

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
        showToast(`Exchange successful! The customer must pay Rs.${diff.toFixed(2)} more. ✅`);
      } else if (diff < 0) {
        showToast(`Exchange successful! Give Rs.${Math.abs(diff).toFixed(2)} back to the customer. ✅`);
      } else {
        showToast("Exchange completed successfully! ✅");
      }
      resetReturnUI();
      fetchProducts();
      fetchCustomers();
      if (user.role === "admin") { fetchSalesSummary(); fetchReturnHistory(); }
    } catch (error) {
      showToast(error.response?.data?.message || "Exchange failed!", "error");
    }
  };

  // --- LOGIN LOGIC ---
  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const response = await axios.post(`${API_BASE_URL}/users/login`, loginForm);
      if (response.data.success) {
        setUser(response.data.user);
        
        // 🛠️ UPDATED: After a successful login, saves to browser memory
        localStorage.setItem("pos_user", JSON.stringify(response.data.user));
        // 🔐 AUTH: Also saves the token, and from here on automatically attaches it to every axios request sent
        localStorage.setItem("pos_token", response.data.token);
        axios.defaults.headers.common["Authorization"] = `Bearer ${response.data.token}`;
        sessionStorage.removeItem("pos_session_expired_reload"); // fresh login - re-arm the 401 guard

        // 🆕 When an Admin logs in, goes straight to the Dashboard (Billing for a Cashier)
        setActiveTab(response.data.user.role === "admin" ? "dashboard" : "billing");
        setTimeout(() => showToast(`Have a great day ${response.data.user.username}! 👋`), 300);
      }
    } catch (error) { setLoginError(error.response?.data?.message || "Error"); }
  };

  // --- PRODUCT CRUD LOGIC ---
  const handleFormSubmit = async (e) => {
    e.preventDefault();

    // 🆕 MULTI-PRICE SAFETY CHECK: If the main "Price" field was changed directly, and while stock of the old price remains, an attempt is made to Submit without going through the Multi-Price flow via the 🔄 Button - asks for a final Confirmation
    if (
      isEditing && editingOriginalProduct &&
      parseFloat(productForm.price) !== parseFloat(editingOriginalProduct.price) &&
      parseFloat(editingOriginalProduct.stock) > 0 &&
      !showNewPriceEntry &&
      !(productForm.batches || []).some(b => parseFloat(b.price) === parseFloat(editingOriginalProduct.price) && parseFloat(b.stock) > 0)
    ) {
      const proceed = await askConfirm({
        title: "Confirm Price Change",
        message: `You are changing the price from Rs.${parseFloat(editingOriginalProduct.price).toFixed(2)} to Rs.${parseFloat(productForm.price).toFixed(2)}. The remaining stock at the old price (${editingOriginalProduct.stock} units) will be completely erased and replaced with the new price (without a Popup). If you also want to sell the old stock separately, "Cancel" and use the 🔄 "New stock received at a new price?" Button.`,
        tone: "warning",
        confirmLabel: "Yes, Replace",
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
        // 🛠️ The Batch Identity in the Backend Schema is "batchId" (String) - different from the Mongo _id. Generated for a new batch, and for an old one the same batchId is sent (so the Identity is preserved when Editing)
        batchId: b.batchId || `B-${Date.now()}-${index}`,
        label: b.label || "",
        price: parseFloat(b.price) || 0,
        costPrice: parseFloat(b.costPrice) || parseFloat(productForm.costPrice) || 0,
        marketPrice: parseFloat(b.marketPrice) || parseFloat(productForm.marketPrice) || 0,
        discount: parseFloat(b.discount) || 0, // 🆕 The discount % specific to this Batch - so profit reports are calculated correctly
        stock: parseFloat(b.stock) || 0,
        expiryDate: b.expiryDate || null
      })) // 🆕 MULTI-PRICE: Old/New Price Batches (in a form matching the "batches" array of the Backend Product Schema)
    };
    try {
      if (isEditing) {
        await axios.put(`${API_BASE_URL}/products/update/${editId}`, submissionData);
        setIsEditing(false);
        setEditId(null);
        showToast("Item details updated successfully! 🔄");
      } else {
        await axios.post(`${API_BASE_URL}/products/add`, submissionData);
        showToast("New item added to the database successfully! ✅");
      }
      setProductForm({ name: "", marketPrice: "", price: "", costPrice: "", stock: "", barcode: "", discountPercent: "", unit: "Kg", category: "Grocery", minStockLevel: "5", preferredSupplierId: "", expiryDate: "", batches: [] });
      setEditingOriginalProduct(null);
      setShowNewPriceEntry(false);
      setNewPriceEntry({ price: "", qty: "", costPrice: "", discount: "" });
      fetchProducts();
      fetchExpiringProducts();
    } catch (error) { showToast("Operation failed!", "error"); }
  };

  const handleEditClick = (product) => {
    setIsEditing(true);
    setEditId(product._id);
    setEditingOriginalProduct(product); // 🆕 MULTI-PRICE: Remember the Original values in the DB
    setProductForm({
      name: product.name.replace("⚠️ ", "").replace(" (Unsaved)", ""),
      marketPrice: product.marketPrice || "",
      price: product.price,
      costPrice: product.costPrice || "",
      stock: getTotalStock(product), // 🛠️ FIX: sum of batches when present, not the raw field (which could be stale)
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
    // 🛠️ FIX: the form lives at the top of the page while the product list is
    // further down — clicking Edit was only updating the form's data, never
    // actually bringing it into view, so admins had to scroll up manually.
    productFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // 🆕 MULTI-PRICE (Simplified): With the single "New stock received, price changed too" action, Batches are Auto-created.
  //     The Admin does not even need to know the word "Batch" - they only need to enter the "New Price" + "Quantity Received".
  const handleAddNewPricePoint = () => {
    if (!newPriceEntry.price || parseFloat(newPriceEntry.price) <= 0) {
      return showToast("Please enter a valid new price!", "warning");
    }
    if (newPriceEntry.qty === "" || parseFloat(newPriceEntry.qty) <= 0) {
      return showToast("Enter the newly received quantity!", "warning");
    }

    let existingBatches = productForm.batches || [];

    // 🆕 If this is the first time this Product is becoming Multi-Price, automatically creates an "Old Price" Batch from the current (Database) price/stock/Cost/Discount
    if (existingBatches.length === 0 && editingOriginalProduct) {
      const currentStock = parseFloat(editingOriginalProduct.stock) || 0;
      if (currentStock > 0) {
        existingBatches = [{
          batchId: `B-old-${editingOriginalProduct._id}`,
          label: "Old Price",
          price: parseFloat(editingOriginalProduct.price) || 0,
          costPrice: parseFloat(editingOriginalProduct.costPrice) || 0,
          marketPrice: parseFloat(editingOriginalProduct.marketPrice) || 0,
          discount: parseFloat(editingOriginalProduct.discount) || 0, // 🆕 Retains the old Discount of the old Batch itself too
          stock: currentStock
        }];
      }
    }

    const newBatch = {
      batchId: `B-new-${Date.now()}`,
      label: "New Price",
      price: parseFloat(newPriceEntry.price),
      costPrice: parseFloat(newPriceEntry.costPrice) || 0, // 🆕 The Cost Price specific to this Batch - so profit is calculated accurately
      marketPrice: parseFloat(productForm.marketPrice) || 0,
      discount: parseFloat(newPriceEntry.discount) || 0, // 🆕 The discount % specific to this Batch
      stock: parseFloat(newPriceEntry.qty)
    };

    const updatedBatches = [...existingBatches, newBatch];
    const newTotalStock = updatedBatches.reduce((sum, b) => sum + (parseFloat(b.stock) || 0), 0);

    setProductForm({
      ...productForm,
      batches: updatedBatches,
      price: parseFloat(newPriceEntry.price), // 🆕 The latest price itself is updated as the main "Our Price"
      costPrice: parseFloat(newPriceEntry.costPrice) || productForm.costPrice, // 🆕 Also shows the latest Cost Price in the Main field
      discountPercent: newPriceEntry.discount || productForm.discountPercent, // 🆕 Also shows the latest Discount in the Main field
      stock: String(newTotalStock) // 🆕 Auto-Syncs to the combined total of old + new
    });
    setNewPriceEntry({ price: "", qty: "", costPrice: "", discount: "" });
    setShowNewPriceEntry(false);
    showToast("✅ New price added! Click 'Add to Database' below and Save.", "success");
  };

  // 🆕 MULTI-PRICE: To correct a Batch that is wrong or not needed
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
      title: "Delete Item",
      message: "Are you sure you want to delete this item?",
      tone: "danger",
      confirmLabel: "Delete",
    });
    if (!confirmed) return;
    try {
      await axios.delete(`${API_BASE_URL}/products/delete/${id}`);
      showToast("Item deleted successfully.");
      fetchProducts();
    } catch (error) { showToast("Failed to delete!", "error"); }
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

      // Those starting with the search text itself come first
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;

      // If both start with it or neither does, in alphabetical order
      return aName.localeCompare(bName);
    });

  // 🛠️ NEW: Counting how many products each Category tab has (for the badge count)
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
  const billDiscount = billSubtotal - calculateSubtotal(); // 🛠️ FIX: calculateSubtotal (item-level only) - because calculateTotal now also deducts the Bill-level Promo

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
      showToast(`⚠️ "${q}" is not in the system! Enter it temporarily.`, "warning");
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
      } else if (e.key === "F6") {
        e.preventDefault();
        setShowHeldBillsPanel(true);
      } else if (e.key === "F7") {
        e.preventDefault();
        handleHoldBill();
      } else if (e.key === "F8") {
        e.preventDefault();
        setCatalogOpen(o => !o);
      } else if (e.key === "F12") {
        e.preventDefault();
        if (showTender) handleCheckoutAndPrint();
        else if (cart.length > 0 && ensureShiftOpen()) setShowTender(true);
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

  // 🛠️ NEW (Step 3 - Low Stock Reorder Alert): List of Products below the minimum stock level
  const lowStockProducts = products.filter(p => getTotalStock(p) <= (p.minStockLevel ?? 5));
  const activeCustomerDetails = viewCustomerDetails ? customers.find(c => c._id === viewCustomerDetails) : null;

  // 🆕 DASHBOARD: When an Admin logs in and there are Low Stock Products (since a checkout
  // refreshes Products every time) a Toast is shown only once - it does not
  // repeat every time Products refresh after login (the ref flag is once per login session).
  useEffect(() => {
    if (!user) {
      lowStockAlertShownRef.current = false; // reset on logout so it shows again on the next login
      return;
    }
    if (user.role === "admin" && products.length > 0 && !lowStockAlertShownRef.current) {
      lowStockAlertShownRef.current = true;
      if (lowStockProducts.length > 0) {
        showToast(`⚠️ ${lowStockProducts.length} Product(s) are low on stock! Check the Dashboard/Reorder List.`, "warning");
      }
    }
  }, [user, products]);

  // 🛠️ NEW: Group low stock products by Preferred Supplier (for Purchase Order Suggestion)
  const lowStockGroupedBySupplier = lowStockProducts.reduce((groups, p) => {
    const key = p.preferredSupplierId || "unassigned";
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
    return groups;
  }, {});

  // 🛠️ NEW: Calculate the Suggested Reorder Quantity for a Product (the quantity needed to reach double the minimum level)
  const getSuggestedReorderQty = (p) => {
    const min = p.minStockLevel ?? 5;
    const suggestion = (min * 2) - getTotalStock(p);
    return suggestion > 0 ? suggestion : min;
  };

  // 🆕 UNREGISTERED ITEMS: Items sold via Emergency Add without being registered in the Database,
  // grouped by name from Sale History (items without a productId); only those not already in the Catalog are shown
  const unregisteredItemGroups = (() => {
    const groups = {};
    (salesSummary.sales || []).forEach((sale) => {
      if (sale.status === "Voided") return;
      (sale.items || []).forEach((item) => {
        if (item.productId) return; // already linked to a Real Product
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
      // 🛠️ If an Owner has already registered this as a Product, it is auto-removed from the list
      .filter((g) => !products.some((p) => p.name.trim().toLowerCase() === g.name.toLowerCase()))
      // 🆕 Items that were manually "Deleted" are also removed from the list
      .filter((g) => !dismissedUnregisteredItems.includes(g.name.toLowerCase()))
      .sort((a, b) => b.occurrences - a.occurrences);
  })();

  // 🆕 Manually delete an Unregistered Item Group (remove it from the list only, without registering it as a Product)
  const handleDismissUnregisteredItem = (name) => {
    const updated = [...dismissedUnregisteredItems, name.toLowerCase()];
    setDismissedUnregisteredItems(updated);
    localStorage.setItem("smartstore_dismissed_unregistered_items", JSON.stringify(updated));
    showToast(`"${name}" removed from the list 🗑️`);
  };

  // 🆕 Remove all items currently shown in the Unregistered Items list at once
  const handleClearAllUnregisteredItems = async () => {
    if (unregisteredItemGroups.length === 0) return;
    const confirmed = await askConfirm({
      title: "Remove entire list",
      message: `Unregistered Items list: remove all ${unregisteredItemGroups.length} item(s)? (This has no effect on Sale History - they are only removed from this Review List)`,
      tone: "warning",
      confirmLabel: "Remove",
    });
    if (!confirmed) return;
    const namesToAdd = unregisteredItemGroups.map((g) => g.name.toLowerCase());
    const updated = [...new Set([...dismissedUnregisteredItems, ...namesToAdd])];
    setDismissedUnregisteredItems(updated);
    localStorage.setItem("smartstore_dismissed_unregistered_items", JSON.stringify(updated));
    showToast("Unregistered Items list fully cleared! 🧹");
  };

  // 🆕 Pre-fill the Add Product Form from an Unregistered Item Group in order to register it
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
    showToast(`"${group.name}" details filled into the Form - please complete it and Save! ✍️`, "warning");
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
                    To confirm, type "{dialogRequest.requireText}"
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

      {/* ══════════ 🆕 START SHIFT MODAL ══════════ */}
      {showStartShiftModal && (
        <div
          className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm print:hidden"
          onClick={() => setShowStartShiftModal(false)}
        >
          <div
            className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 bg-linear-to-r from-emerald-600 to-emerald-700 flex items-center justify-between">
              <h3 className="text-sm font-black text-white">🟢 Start Shift</h3>
              <button onClick={() => setShowStartShiftModal(false)} className="text-white/80 hover:text-white text-lg leading-none">✕</button>
            </div>
            <form onSubmit={handleStartShift} className="p-5 space-y-3">
              <p className="text-[12px] text-gray-500">Enter the starting amount currently in the Cash Drawer (Opening Float). At the end of the Shift, Expected Cash is calculated as this amount + Cash Sales - Cash Refunds.</p>
              <div>
                <label className="text-[11px] font-bold text-gray-600 block mb-1">Opening Float (Rs.):</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  autoFocus
                  required
                  value={startShiftFloat}
                  onChange={(e) => setStartShiftFloat(e.target.value)}
                  placeholder="0.00"
                  className="w-full p-2.5 border rounded-lg text-sm font-black text-emerald-700 bg-gray-50 focus:bg-white"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowStartShiftModal(false)} className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-lg text-xs font-bold">Do it later</button>
                <button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-lg text-xs font-bold">🟢 Start Shift</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══════════ 🆕 END SHIFT MODAL ══════════ */}
      {showEndShiftModal && activeShift && (
        <div
          className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm print:hidden"
          onClick={() => setShowEndShiftModal(false)}
        >
          <div
            className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 bg-linear-to-r from-rose-600 to-rose-700 flex items-center justify-between">
              <h3 className="text-sm font-black text-white">🔴 End Shift</h3>
              <button onClick={() => setShowEndShiftModal(false)} className="text-white/80 hover:text-white text-lg leading-none">✕</button>
            </div>
            <form onSubmit={async (e) => { await handleCloseShift(e); setShowEndShiftModal(false); }} className="p-5 space-y-3">
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600">
                <div className="flex justify-between"><span>Opening Float:</span><span className="font-bold">Rs. {activeShift.openingFloat?.toFixed(2)}</span></div>
                <div className="flex justify-between"><span>Started:</span><span className="font-bold">{new Date(activeShift.openedAt).toLocaleString()}</span></div>
              </div>
              {myHeldBills.length > 0 && (
                <p className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-2.5 py-2">
                  ⚠️ {myHeldBills.length} held bill(s) still exist! Resume and complete them before ending the Shift, or else remove them.
                </p>
              )}
              <p className="text-[12px] text-gray-500">Physically count the Cash Drawer and enter the actual total Cash amount here. The backend calculates Expected Cash (Opening Float + Cash Sales − Cash Refunds) itself.</p>
              <div>
                <label className="text-[11px] font-bold text-gray-600 block mb-1">Counted Cash amount (Rs.):</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  autoFocus
                  required
                  value={closingCountedCash}
                  onChange={(e) => setClosingCountedCash(e.target.value)}
                  placeholder="0.00"
                  className="w-full p-2.5 border rounded-lg text-sm font-black text-rose-700 bg-gray-50 focus:bg-white"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setShowEndShiftModal(false)} className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-lg text-xs font-bold">Cancel</button>
                <button type="submit" className="flex-1 bg-rose-600 hover:bg-rose-700 text-white py-2.5 rounded-lg text-xs font-bold">🔴 End Shift</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══════════ 🆕 SHIFT CLOSE RESULT MODAL (Over/Short Summary) ══════════ */}
      {shiftCloseResult && (
        <div
          className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm print:hidden"
          onClick={() => setShiftCloseResult(null)}
        >
          <div
            className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`px-5 py-4 flex items-center justify-between ${
              shiftCloseResult.overShort === 0 ? "bg-linear-to-r from-emerald-600 to-emerald-700" :
              shiftCloseResult.overShort > 0 ? "bg-linear-to-r from-blue-600 to-blue-700" :
              "bg-linear-to-r from-red-600 to-red-700"
            }`}>
              <h3 className="text-sm font-black text-white">📋 Shift Summary</h3>
              <button onClick={() => setShiftCloseResult(null)} className="text-white/80 hover:text-white text-lg leading-none">✕</button>
            </div>
            <div className="p-5 space-y-2 text-[12px]">
              <div className="flex justify-between"><span className="text-gray-500">Opening Float:</span><span className="font-bold">Rs. {shiftCloseResult.openingFloat?.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">+ Cash Sales:</span><span className="font-bold text-emerald-700">Rs. {shiftCloseResult.cashSales?.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-amber-700">Given on credit (Net, after Returns · not counted):</span><span className="font-bold text-amber-700">Rs. {(shiftCloseResult.creditGiven || 0).toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">− Cash Refunds:</span><span className="font-bold text-red-600">Rs. {shiftCloseResult.cashRefunds?.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">+ Credit payments (Cash):</span><span className="font-bold text-emerald-700">Rs. {(shiftCloseResult.creditPaymentsCashIn || 0).toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">− Supplier payments (Cash):</span><span className="font-bold text-red-600">Rs. {(shiftCloseResult.supplierPaymentsCashOut || 0).toFixed(2)}</span></div>
              <hr className="my-1.5" />
              <div className="flex justify-between"><span className="text-gray-600 font-bold">Expected Cash:</span><span className="font-black">Rs. {shiftCloseResult.expectedCash?.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-gray-600 font-bold">Counted Cash:</span><span className="font-black">Rs. {shiftCloseResult.closingCountedCash?.toFixed(2)}</span></div>
              <div className={`mt-2 p-3 rounded-lg text-center font-black text-sm ${
                shiftCloseResult.overShort === 0 ? "bg-emerald-50 text-emerald-700" :
                shiftCloseResult.overShort > 0 ? "bg-blue-50 text-blue-700" :
                "bg-red-50 text-red-700"
              }`}>
                {shiftCloseResult.overShort === 0 ? "✅ Exact match!" :
                  shiftCloseResult.overShort > 0 ? `🔵 Over: Rs. ${shiftCloseResult.overShort.toFixed(2)}` :
                  `🔴 Short: Rs. ${Math.abs(shiftCloseResult.overShort).toFixed(2)}`}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ 🆕 HELD BILLS PANEL (Token + Search + Age colors) ══════════ */}
      {showHeldBillsPanel && (() => {
        const q = heldSearch.trim().toLowerCase();
        const qDigits = q.replace(/\D/g, "");
        const totalOf = (h) => h.cart.reduce((sum, item) => {
          const discP = parseFloat(item.discountPercent || item.discount) || 0;
          const p = parseFloat(item.price);
          return sum + ((p - (p * discP) / 100) * (parseFloat(item.qty) || 0));
        }, 0);
        const matches = (h) => {
          if (!q) return true;
          const hay = [
            formatHoldNo(h.holdNo), h.note, h.label, h.selectedCustomer?.name, h.selectedCustomer?.phone,
            ...h.cart.map((i) => i.name),
          ].filter(Boolean).join(" ").toLowerCase();
          if (hay.includes(q)) return true;
          // so typing "7" or "07" matches H-07
          return qDigits !== "" && h.holdNo && Number(qDigits) === h.holdNo;
        };
        // Oldest bills first (the ones most likely to be forgotten)
        const visible = [...myHeldBills].sort((x, y) => new Date(x.heldAt) - new Date(y.heldAt)).filter(matches);
        const ageStyles = {
          normal: "border-indigo-200 bg-indigo-50",
          amber: "border-amber-300 bg-amber-50",
          red: "border-red-300 bg-red-50",
        };
        return (
          <div
            className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm print:hidden"
            onClick={() => { setShowHeldBillsPanel(false); setHeldSearch(""); }}
          >
            <div
              className="w-full max-w-lg max-h-[85vh] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 bg-linear-to-r from-indigo-600 to-indigo-700 flex items-center justify-between">
                <h3 className="text-sm font-black text-white">📋 Held bills ({myHeldBills.length})</h3>
                <button onClick={() => { setShowHeldBillsPanel(false); setHeldSearch(""); }} className="text-white/80 hover:text-white text-lg leading-none">✕</button>
              </div>
              <div className="px-4 pt-3">
                <input
                  autoFocus
                  value={heldSearch}
                  onChange={(e) => setHeldSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && visible.length >= 1 && (visible.length === 1 || q)) { e.preventDefault(); handleResumeHeldBill(visible[0].id); }
                    if (e.key === "Escape") { setShowHeldBillsPanel(false); setHeldSearch(""); }
                  }}
                  placeholder="Number (7), name, phone, item... • Enter = Resume"
                  className="w-full p-2.5 border rounded-lg text-xs font-bold bg-gray-50 focus:bg-white"
                />
                <p className="text-[10px] text-gray-400 mt-1.5">Oldest bills first • 🟧 30+ min • 🟥 2+ hrs</p>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                {myHeldBills.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-8">No held bills</p>
                )}
                {myHeldBills.length > 0 && visible.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-8">"{heldSearch}" no matching bill</p>
                )}
                {visible.map((h) => {
                  const age = holdAgeInfo(h.heldAt, holdNowTick);
                  const title = h.note || h.selectedCustomer?.name || h.label;
                  const preview = itemsPreview(h.cart);
                  return (
                    <div key={h.id} className={`p-3 rounded-lg border flex items-center justify-between gap-2 ${ageStyles[age.level]}`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`shrink-0 text-[13px] font-black px-2 py-1 rounded-md text-white ${age.level === "red" ? "bg-red-600" : age.level === "amber" ? "bg-amber-500" : "bg-indigo-600"}`}>{formatHoldNo(h.holdNo)}</span>
                        <div className="min-w-0">
                          {editingHoldNoteId === h.id ? (
                            <input
                              autoFocus
                              value={holdNoteDraft}
                              maxLength={40}
                              onChange={(e) => setHoldNoteDraft(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") handleSaveHoldNote(h.id); if (e.key === "Escape") setEditingHoldNoteId(null); }}
                              onBlur={() => handleSaveHoldNote(h.id)}
                              placeholder="Note (name / green shirt...)"
                              className="w-full p-1 border rounded text-[12px] font-bold bg-white"
                            />
                          ) : (
                            <p className="text-[13px] font-700 text-slate-900 truncate">
                              {title}
                              <button
                                onClick={() => { setEditingHoldNoteId(h.id); setHoldNoteDraft(h.note || ""); }}
                                title="Add a note"
                                className="ml-1.5 text-[11px] opacity-50 hover:opacity-100"
                              >✏️</button>
                            </p>
                          )}
                          {preview && title !== preview && <p className="text-[11px] text-slate-500 truncate">{preview}</p>}
                          <p className={`text-[11px] font-bold ${age.level === "red" ? "text-red-600" : age.level === "amber" ? "text-amber-700" : "text-indigo-600"}`}>
                            {h.cart.length} Items • Rs. {totalOf(h).toFixed(2)} • {age.text}{user?.role === "admin" && ` • 👤 ${h.cashier || "unknown"}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          onClick={() => handleResumeHeldBill(h.id)}
                          className="px-3 py-1.5 rounded-lg text-[11px] font-700 text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
                        >
                          ▶️ Resume
                        </button>
                        <button
                          onClick={() => handleDeleteHeldBill(h.id)}
                          className="px-2.5 py-1.5 rounded-lg text-[11px] font-700 text-crimson bg-crimson-soft hover:brightness-95 transition-colors"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════ 🆕 RECENT BILLS QUEUE — reprint any bill, printed or not, from this device ══════════ */}
      {showRecentBillsPanel && (
        <div
          className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm print:hidden"
          onClick={() => setShowRecentBillsPanel(false)}
        >
          <div
            className="w-full max-w-md max-h-[80vh] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 bg-linear-to-r from-slate-800 to-slate-900 flex items-center justify-between">
              <h3 className="text-sm font-black text-white">🧾 Bills - Print</h3>
              <button onClick={() => setShowRecentBillsPanel(false)} className="text-white/80 hover:text-white text-lg leading-none">✕</button>
            </div>

            {/* Filter tabs */}
            <div className="flex gap-1.5 p-3 border-b border-slate-100 bg-slate-50">
              <button
                onClick={() => setRecentBillsFilter("unprinted")}
                className={`flex-1 py-1.5 rounded-lg text-[11.5px] font-700 transition-colors ${
                  recentBillsFilter === "unprinted" ? "bg-slate-900 text-white" : "bg-white text-slate-500 border border-slate-200"
                }`}
              >
                🕓 Unprinted ({recentBills.filter((b) => !b.printed).length})
              </button>
              <button
                onClick={() => setRecentBillsFilter("all")}
                className={`flex-1 py-1.5 rounded-lg text-[11.5px] font-700 transition-colors ${
                  recentBillsFilter === "all" ? "bg-slate-900 text-white" : "bg-white text-slate-500 border border-slate-200"
                }`}
              >
                All ({recentBills.length})
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {(() => {
                const list = recentBillsFilter === "unprinted" ? recentBills.filter((b) => !b.printed) : recentBills;
                if (list.length === 0) {
                  return (
                    <p className="text-xs text-gray-400 text-center py-8">
                      {recentBillsFilter === "unprinted" ? "No unprinted bills 🎉" : "No bills recorded yet"}
                    </p>
                  );
                }
                return list.map((b) => (
                  <div key={b.id} className={`p-3 rounded-lg border flex items-center justify-between gap-2 ${
                    b.printed ? "bg-slate-50 border-slate-200" : "bg-amber-50 border-amber-200"
                  }`}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[13px] font-700 text-slate-800 truncate">{b.invoiceNo || "N/A"}</p>
                        {b.isOffline && <span className="text-[9px] px-1 py-0.5 rounded bg-orange-200 text-orange-800 font-bold">OFFLINE</span>}
                        {b.printed ? (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-200 text-emerald-800 font-bold">✅ Printed</span>
                        ) : (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-amber-200 text-amber-800 font-bold">🕓 Not printed</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Rs. {b.total.toFixed(2)} • {b.items.length} Items • {new Date(b.date).toLocaleString()}
                      </p>
                    </div>
                    <button
                      onClick={() => handlePrintRecentBill(b.id)}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-700 text-white bg-slate-900 hover:bg-slate-800 transition-colors shrink-0"
                    >
                      🖨️ Print
                    </button>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ══════════ 🆕 SALE COMPLETE — print only if needed ══════════ */}
      {showSaleCompleteModal && lastCompletedSale && (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm print:hidden">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-[fadeIn_0.15s_ease-out]">
            <div className="px-5 py-5 bg-linear-to-r from-emerald-600 to-emerald-700 text-center">
              <div className="w-12 h-12 mx-auto rounded-full bg-white/15 flex items-center justify-center text-2xl mb-2">✅</div>
              <h3 className="text-base font-black text-white">Bill successful!</h3>
              <p className="text-[12px] text-emerald-50 mt-0.5">{lastCompletedSale.invoiceNo}</p>
              <p className="text-xl font-black text-white mt-1">Rs. {lastCompletedSale.total.toFixed(2)}</p>
            </div>
            <div className="p-4 flex flex-col gap-2">
              <button
                onClick={handlePrintReceipt}
                className="w-full py-3 rounded-xl text-sm font-black text-white bg-slate-900 hover:bg-slate-800 transition-colors flex items-center justify-center gap-2"
              >
                🖨️ Print Receipt
              </button>
              <button
                onClick={() => setShowSaleCompleteModal(false)}
                className="w-full py-2.5 rounded-xl text-sm font-700 text-slate-500 hover:bg-slate-100 transition-colors"
              >
                Don't print, go to next bill ➡️
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
                          <span className="tnum text-[19px] font-800 text-accent">Rs. {parseFloat(batch.price).toFixed(2)}</span>
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
                  placeholder="Item name · Item name"
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

                {/* <label className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-line cursor-pointer hover:bg-sunken transition-colors">
                  <input
                    type="checkbox"
                    checked={registerTempAsProduct}
                    onChange={(e) => setRegisterTempAsProduct(e.target.checked)}
                    className="w-4 h-4 accent-accent"
                  />
                  <span className="text-[12.5px] font-600 text-body">Also save it to the catalog</span>
                </label> */}
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
                    <p className="text-[11.5px] font-600 text-white/45 tracking-wide">AMOUNT DUE · Amount payable</p>
                    <p className="tnum text-[28px] leading-tight font-800">Rs. {total.toFixed(2)}</p>
                  </div>
                  <button onClick={() => setShowTender(false)} className="h-8 px-3 rounded-lg text-[12.5px] font-600 text-white/55 hover:text-white hover:bg-white/10 transition-colors">Esc</button>
                </div>

                <div className="p-4 grid grid-cols-[1fr_300px] gap-4">

                  {/* left: method + entry */}
                  <div className="min-w-0 space-y-3">
                    <div className="grid grid-cols-4 gap-1.5">
                      {[
                        { k: "Cash", si: "Cash" },
                        { k: "Card", si: "Card" },
                        { k: "QR", si: "QR" },
                        { k: "Credit", si: "Credit" },
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
                          <label className="block text-[11.5px] font-700 text-muted mb-1.5">Cash received · Amount received</label>
                          <div className="relative">
                            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] font-600 text-faint">Rs.</span>
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
                      </div>
                    )}

                    {paymentMethod === "Credit" && (
                      <div className="space-y-2.5">
                        <div className="relative">
                          <label className="block text-[11.5px] font-700 text-muted mb-1.5">Customer account · Account</label>
                          <input
                            type="text"
                            autoComplete="off"
                            placeholder="Name or phone number · name or phone number"
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
                            <span className="tnum text-[11.5px] font-700 text-crimson"> Rs. {parseFloat(selectedCustomer.creditBalance || 0).toFixed(2)}</span>
                          </div>
                        )}

                        <div>
                          <label className="block text-[11.5px] font-700 text-muted mb-1.5">Paying now · amount paying now <span className="font-500 text-faint">(optional)</span></label>
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
                          ? (short ? "STILL SHORT" : "CHANGE DUE")
                          : paymentMethod === "Credit" ? "GOES ON ACCOUNT · on credit"
                            : "CHARGE ON TERMINAL"}
                      </p>
                      <p className="mt-1.5 flex items-baseline gap-1.5">
                        <span className="text-[16px] font-600 text-white/55">Rs.</span>
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
                                : `Hand back Rs. ${diff.toFixed(2)}`)
                          : paymentMethod === "Credit"
                            ? (selectedCustomer
                              ? `${selectedCustomer.name} · new balance Rs. ${(parseFloat(selectedCustomer.creditBalance || 0) + onAccount).toFixed(2)}`
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

                    {/* 🆕 SPEED: Auto-print toggle - when on, the receipt
                        is printed instantly as soon as checkout succeeds; no need to click the "Print" button. Persisted in the device's own localStorage
                         */}
                    <label className="mt-2 flex items-center justify-center gap-1.5 text-[11px] font-600 text-ink2/60 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={autoPrintReceipt}
                        onChange={(e) => setAutoPrintReceipt(e.target.checked)}
                        className="w-3.5 h-3.5 accent-accent"
                      />
                      🖨️ Auto-print receipt (print immediately on checkout)
                    </label>
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
            {user.role === "admin" && (
              <button onClick={() => setActiveTab("dashboard")} className={`h-7 px-3 rounded-md text-[13px] transition-colors ${activeTab === "dashboard" ? "bg-ink3 text-white font-600" : "font-500 text-white/55 hover:text-white hover:bg-white/8"}`}>
                Dashboard{lowStockProducts.length + expiringProducts.length > 0 && <span className="ml-1.5 inline-block min-w-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-black leading-4 text-center">{lowStockProducts.length + expiringProducts.length}</span>}
              </button>
            )}
            <button onClick={() => setActiveTab("billing")} className={`h-7 px-3 rounded-md text-[13px] transition-colors ${activeTab === "billing" ? "bg-ink3 text-white font-600" : "font-500 text-white/55 hover:text-white hover:bg-white/8"}`}>Billing</button>
            <button onClick={() => { setActiveTab("returns"); resetReturnUI(); }} className={`h-7 px-3 rounded-md text-[13px] transition-colors ${activeTab === "returns" ? "bg-ink3 text-white font-600" : "font-500 text-white/55 hover:text-white hover:bg-white/8"}`}>Returns</button>
            {user.role === "admin" && (
              <button onClick={() => setActiveTab("admin")} className={`h-7 px-3 rounded-md text-[13px] transition-colors ${activeTab === "admin" ? "bg-ink3 text-white font-600" : "font-500 text-white/55 hover:text-white hover:bg-white/8"}`}>Admin</button>
            )}
          </nav>

          <div className="flex-1"></div>

          <div className="flex items-center gap-3 text-[12px]">
            {/* 🆕 SHIFT STATUS: green pill + "End Shift" if a Shift is open, otherwise the "Start Shift" button */}
            {!isLoadingShift && (
              activeShift ? (
                <button
                  onClick={() => setShowEndShiftModal(true)}
                  className="h-7 px-2.5 rounded-md text-[12px] font-600 bg-accent-soft text-accent-hi hover:brightness-95 transition-colors flex items-center gap-1.5"
                  title={`Shift Open • Float Rs.${activeShift.openingFloat?.toFixed(2)} • since ${new Date(activeShift.openedAt).toLocaleTimeString()}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-hi"></span>
                  Shift Open
                </button>
              ) : (
                <button
                  onClick={() => setShowStartShiftModal(true)}
                  className="h-7 px-2.5 rounded-md text-[12px] font-600 bg-gold-soft text-gold hover:brightness-95 transition-colors flex items-center gap-1.5"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-gold"></span>
                  Start Shift
                </button>
              )
            )}
            <span className="text-white/25">|</span>
            <span className="flex items-center gap-1.5 text-white/60">
              <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-accent-hi" : "bg-gold"}`}></span>
              {isOnline ? "Online" : "Offline"}
            </span>
            <span className="text-white/25">|</span>
            <span className="text-white/80 font-500">{user.username}</span>
            <button
              onClick={() => {
                localStorage.removeItem("pos_user");
                localStorage.removeItem("pos_token"); // 🔐 AUTH: the token must also be cleared, otherwise requests keep going out with the old token even after sign out
                delete axios.defaults.headers.common["Authorization"];
                setUser(null);
              }}
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
                      placeholder="Scan barcode, or type an item name  ·  barcode or name"
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
                            <span className="shrink-0 tnum text-[12px] font-700 text-accent">Rs. {Number(p.price).toFixed(2)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <button onClick={() => setShowTempItemModal(true)} className="h-9.5 px-3 rounded-lg border border-line text-[12.5px] font-600 text-gold bg-gold-soft hover:brightness-97 transition-all flex items-center gap-1.5 shrink-0">
                    Quick item <kbd className="text-[10px] opacity-60 font-700">F4</kbd>
                  </button>

                  {/* 🆕 HOLD BILL: Hold the current cart and start a new empty bill */}
                  <button
                    onClick={handleHoldBill}
                    disabled={cart.length === 0}
                    title="Hold this bill and start a new one"
                    className="h-9.5 px-3 rounded-lg border border-line text-[12.5px] font-600 text-indigo-600 bg-indigo-50 hover:brightness-97 disabled:opacity-35 disabled:pointer-events-none transition-all flex items-center gap-1.5 shrink-0"
                  >
                    📌 Hold <kbd className="text-[10px] opacity-60 font-700">F7</kbd>
                  </button>

                  {/* 🆕 HELD BILLS: Shows the number of held bills; clicking opens a panel to view/recall them */}
                  {myHeldBills.length > 0 && (
                    <button
                      onClick={() => setShowHeldBillsPanel(true)}
                      className="h-9.5 px-3 rounded-lg border border-indigo-300 text-[12.5px] font-700 text-white bg-indigo-600 hover:bg-indigo-700 transition-all flex items-center gap-1.5 shrink-0"
                    >
                      📋 Held ({myHeldBills.length}) <kbd className="text-[10px] opacity-60 font-700">F6</kbd>
                      {(() => {
                        const oldest = Math.max(...myHeldBills.map((h) => holdAgeInfo(h.heldAt, holdNowTick).mins));
                        return oldest >= 30 ? (
                          <span className={`w-2.5 h-2.5 rounded-full ${oldest >= 120 ? "bg-red-400" : "bg-amber-300"} animate-pulse`} title={`Oldest held bill is ${oldest} min old`} />
                        ) : null;
                      })()}
                    </button>
                  )}

                  <button
                    onClick={() => { setCart([]); showToast("Bill cleared"); }}
                    disabled={cart.length === 0}
                    className="h-9.5 px-3 rounded-lg border border-line text-[12.5px] font-600 text-muted hover:text-crimson hover:border-crimson hover:bg-crimson-soft disabled:opacity-35 disabled:pointer-events-none transition-all shrink-0"
                  >
                    Clear
                  </button>

                  {/* 🆕 BILLS QUEUE: All printed/unprinted bills - the unprinted count shows on the badge */}
                  {recentBills.length > 0 && (
                    <button
                      onClick={() => { setRecentBillsFilter("unprinted"); setShowRecentBillsPanel(true); }}
                      title="Bill History - Print"
                      className="relative h-9.5 px-3 rounded-lg border border-line text-[12.5px] font-600 text-muted hover:text-ink hover:bg-sunken transition-all flex items-center gap-1.5 shrink-0"
                    >
                      🧾 Bills
                      {recentBills.some((b) => !b.printed) && (
                        <span className="min-w-4.5 h-4.5 px-1 rounded-full bg-crimson text-white text-[10px] font-black flex items-center justify-center">
                          {recentBills.filter((b) => !b.printed).length}
                        </span>
                      )}
                    </button>
                  )}
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
                      <p className="text-[12px] text-faint">Scan an item to start the bill</p>
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
                            <div className="tnum text-[11px] text-faint truncate">Rs. {finalP.toFixed(2)} / {item.unit ?? "Kg"}</div>
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
                            onClick={() => { setCart(cart.filter(c => c.cartLineId !== item.cartLineId)); showToast("Item removed"); }}
                            className="w-7 h-7 rounded-md text-faint opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-crimson hover:bg-crimson-soft grid place-items-center transition-all"
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 6l12 12M18 6 6 18" /></svg>
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* 🆕 BILL-LEVEL DISCOUNT: Occasion Promotion Banner */}
                {cart.length > 0 && !appliedBillDiscount && activeOccasionPromotion && (
                  <div className="shrink-0 px-3 pt-2">
                    <button
                      onClick={applyBillDiscount}
                      className="w-full bg-linear-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white text-[12.5px] font-700 py-2 px-3 rounded-lg shadow-sm transition-colors"
                    >
                      🎉 {activeOccasionPromotion.name} — {activeOccasionPromotion.discountPercent}% OFF - Apply it
                    </button>
                  </div>
                )}
                {appliedBillDiscount && (
                  <div className="shrink-0 px-3 pt-2">
                    <div className="flex items-center justify-between bg-pink-50 border border-pink-200 rounded-lg px-3 py-1.5">
                      <span className="text-[11.5px] font-600 text-pink-700">🎉 {appliedBillDiscount.name} ({appliedBillDiscount.percent}%) Applied</span>
                      <button onClick={removeBillDiscount} className="text-[10.5px] font-700 text-crimson hover:underline ml-2 shrink-0">✕ Remove</button>
                    </div>
                  </div>
                )}

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
                      {appliedBillDiscount && (
                        <div className="flex items-center justify-between text-[12.5px]">
                          <span className="text-muted">🎉 {appliedBillDiscount.name} ({appliedBillDiscount.percent}%)</span>
                          <span className="tnum font-600 text-crimson">−{calculateBillDiscountAmount().toFixed(2)}</span>
                        </div>
                      )}
                      <div className="h-px bg-line my-1.5"></div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-[12.5px] font-700 text-muted tracking-wide">TOTAL</span>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[14px] font-600 text-muted">Rs.</span>
                          <span className="tnum text-[30px] leading-none font-800 text-accent">{calculateTotal().toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => cart.length && ensureShiftOpen() && setShowTender(true)}
                      disabled={cart.length === 0}
                      className="h-18.5 w-55 shrink-0 rounded-xl bg-accent hover:bg-accent-hi disabled:opacity-35 disabled:cursor-not-allowed text-white flex flex-col items-center justify-center gap-0.5 transition-colors shadow-sm"
                    >
                      <span className="text-[17px] font-800 tracking-tight">Take payment</span>
                      <span className="text-[11.5px] font-600 text-white/70">Cash payment · F12</span>
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
                        <span className="text-[10px] font-600 leading-tight">All</span>
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
                        const totalStock = getTotalStock(product); // 🛠️ FIX: sum of batches when present, not the raw (sometimes stale) product.stock field
                        const isOutOfStock = totalStock <= 0; // 🆕 distinct from "low" — this one blocks the sale
                        const isLowStock = !isOutOfStock && totalStock <= (product.minStockLevel ?? 5);
                        const expStatus = getExpiryStatus(product);
                        const dead = expStatus === "expired";
                        const soon = expStatus === "expiring";
                        const batchCount = getActivePriceBatches(product).length;
                        const blocked = dead || isOutOfStock; // 🆕 can't be sold either way — tile is disabled

                        /* Status rides a 3px left bar, not a pulsing ring */
                        const bar = dead ? "bg-faint" : isOutOfStock ? "bg-crimson" : isLowStock ? "bg-gold" : soon ? "bg-gold" : "bg-transparent";

                        return (
                          <button
                            key={product._id}
                            disabled={blocked}
                            onClick={() => addToCart(product)}
                            className={`relative overflow-hidden text-left p-2 pl-2.5 rounded-lg border bg-card transition-all h-21 flex flex-col justify-between ${blocked ? "border-line opacity-45 cursor-not-allowed" : "border-line hover:border-accent hover:bg-accent-soft active:scale-[.98]"}`}
                          >
                            <span className={`absolute left-0 top-0 bottom-0 w-0.75 ${bar}`}></span>
                            <div className="flex items-start justify-between gap-1">
                              <span className="text-[12px] font-600 text-body leading-tight line-clamp-2">{product.name}</span>
                              {batchCount > 1 && <span className="shrink-0 tnum text-[9px] font-700 text-plum bg-plum-soft px-1 py-px rounded">{batchCount}</span>}
                            </div>
                            <div>
                              <div className="flex items-baseline gap-1">
                                <span className={`tnum text-[14px] font-800 ${blocked ? "text-faint line-through" : "text-accent"}`}>{finalPrice.toFixed(2)}</span>
                                {discP > 0 && <span className="tnum text-[10px] font-600 text-faint line-through">{parseFloat(product.price).toFixed(2)}</span>}
                              </div>
                              <div className={`tnum text-[10px] font-700 mt-0.5 truncate ${isOutOfStock ? "text-crimson" : isLowStock ? "text-gold" : soon ? "text-gold" : "text-faint"}`}>
                                {dead ? "Expired"
                                  : isOutOfStock ? "Out of stock"
                                  : isLowStock ? `Low · ${formatQtyWithUnit(totalStock, product.unit ?? "Kg")}`
                                  : soon ? `Expires ${new Date(product.expiryDate).toLocaleDateString()}`
                                  : `${formatQtyWithUnit(totalStock, product.unit ?? "Kg")} left`}
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
                      placeholder="🧾 Enter bill number..."
                      value={returnInvoiceSearch}
                      onChange={(e) => setReturnInvoiceSearch(e.target.value)}
                      className="flex-1 p-2.5 border rounded-lg text-sm bg-gray-50 focus:bg-white font-mono"
                    />
                    <button type="submit" disabled={returnLoading} className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-bold disabled:opacity-50">
                      {returnLoading ? "Searching..." : "Search 🔍"}
                    </button>
                    {returnSaleData && (
                      <button type="button" onClick={resetReturnUI} className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-bold">Clear ✕</button>
                    )}
                  </form>
                  <p className="text-[10px] text-gray-400 mt-2">💡 Enter the Invoice Number here.</p>
                </div>

                {returnSaleData && (
                  <>
                    {/* Sale Info Card */}
                    <div className="bg-white p-4 rounded-xl border shadow-xs flex flex-wrap justify-between items-center gap-3">
                      <div>
                        <p className="text-[10px] text-gray-400 font-bold">Bill number</p>
                        <p className="font-mono text-xs font-bold text-slate-800">{returnSaleData.invoiceNo || returnSaleData._id}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 font-bold">Date</p>
                        <p className="text-xs font-bold text-slate-800">{new Date(returnSaleData.createdAt).toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 font-bold">Cashier</p>
                        <p className="text-xs font-bold text-slate-800">{returnSaleData.cashier}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 font-bold">Payment method</p>
                        <p className="text-xs font-bold text-slate-800">{returnSaleData.paymentMethod}{returnSaleData.customerId ? ` (${returnSaleData.customerId.name})` : ""}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 font-bold">Total</p>
                        <p className="text-sm font-black text-blue-600">Rs. {returnSaleData.totalAmount.toFixed(2)}</p>
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
                        🚫 This bill has already been voided, so Return/Exchange is not possible.
                      </div>
                    ) : (
                      <>
                        {/* Items table with return qty inputs */}
                        <div className="bg-white rounded-xl border shadow-xs overflow-hidden">
                          <div className="p-3 border-b bg-gray-50">
                            <h3 className="text-xs font-black uppercase text-slate-800">📦 Select items to Return</h3>
                          </div>
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-slate-100 text-slate-700 font-bold border-b">
                                <th className="p-2.5">Item</th>
                                <th className="p-2.5 text-center">Qty purchased</th>
                                <th className="p-2.5 text-center">Already returned</th>
                                <th className="p-2.5 text-center">Return qty</th>
                                <th className="p-2.5">Reason (Optional)</th>
                                <th className="p-2.5 text-right">Refund amount</th>
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
                                    <td className="p-2.5 text-right font-black text-red-600">Rs. {(selQty * item.price).toFixed(2)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Mode + Refund Method */}
                        <div className="bg-white p-4 rounded-xl border shadow-xs flex flex-wrap gap-4 items-end">
                          <div>
                            <p className="text-[11px] font-bold text-gray-600 mb-1">Select action:</p>
                            <div className="flex bg-gray-100 rounded-lg p-1">
                              <button onClick={() => setIsExchangeMode(false)} className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${!isExchangeMode ? "bg-white shadow text-blue-600" : "text-gray-500"}`}>↩️ Return Only</button>
                              <button onClick={() => setIsExchangeMode(true)} className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${isExchangeMode ? "bg-white shadow text-amber-600" : "text-gray-500"}`}>🔁 Exchange</button>
                            </div>
                          </div>
                          <div>
                            <p className="text-[11px] font-bold text-gray-600 mb-1">Refund method:</p>
                            <select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)} className="p-2 border rounded-lg text-xs font-bold bg-gray-50">
                              <option value="Cash">💵 Cash (cash back in hand)</option>
                              <option value="Card">💳 Card refund</option>
                              <option value="StoreCredit">🎟️ Store Credit (to account)</option>
                              {returnSaleData.paymentMethod === "Credit" && <option value="CreditAdjust">📕 Deduct from credit ledger</option>}
                            </select>
                          </div>
                          <div className="ml-auto text-right">
                            <p className="text-[11px] font-bold text-gray-500">Total Refund amount</p>
                            <p className="text-xl font-black text-red-600">Rs. {calculateReturnTotal().toFixed(2)}</p>
                          </div>
                        </div>

                        {/* EXCHANGE: pick replacement items */}
                        {isExchangeMode && (
                          <div className="bg-white p-4 rounded-xl border shadow-xs space-y-3">
                            <h3 className="text-xs font-black uppercase text-slate-800">🆕 Select new items (Exchange)</h3>
                            <input
                              type="text" placeholder="🔍 Search by item name or barcode..."
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
                                  <div className="text-xs font-black text-blue-600">Rs. {p.price.toFixed(2)}</div>
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
                                      <span className="font-black text-slate-800 w-20 text-right">Rs. {(finalP * parseFloat(item.qty || 0)).toFixed(2)}</span>
                                      <button onClick={() => removeFromExchangeCart(item._id)} className="text-red-500 font-bold px-2">✕</button>
                                    </div>
                                  );
                                })}
                                <div className="flex justify-between font-black text-sm pt-1">
                                  <span>New items total:</span>
                                  <span className="text-blue-600">Rs. {calculateExchangeCartTotal().toFixed(2)}</span>
                                </div>
                              </div>
                            )}

                            <div className="flex flex-wrap gap-3 items-end border-t pt-3">
                              <div>
                                <p className="text-[11px] font-bold text-gray-600 mb-1">Difference payment method:</p>
                                <select value={exchangePaymentMethod} onChange={(e) => setExchangePaymentMethod(e.target.value)} className="p-2 border rounded-lg text-xs font-bold bg-gray-50">
                                  <option value="Cash">💵 Cash</option>
                                  <option value="Card">💳 Card</option>
                                  {returnSaleData.customerId && <option value="Credit">📕 Credit</option>}
                                </select>
                              </div>
                              {exchangePaymentMethod === "Cash" && (
                                <div>
                                  <p className="text-[11px] font-bold text-gray-600 mb-1">Amount received (Optional):</p>
                                  <input type="number" value={exchangeCashReceived} onChange={(e) => setExchangeCashReceived(e.target.value)} className="p-2 border rounded-lg text-xs w-32" placeholder="0.00" />
                                </div>
                              )}
                              <div className="ml-auto text-right">
                                <p className="text-[11px] font-bold text-gray-500">Difference (New - Refund)</p>
                                {(() => {
                                  const diff = calculateExchangeCartTotal() - calculateReturnTotal();
                                  return (
                                    <p className={`text-xl font-black ${diff > 0 ? "text-red-600" : diff < 0 ? "text-emerald-600" : "text-slate-800"}`}>
                                      {diff > 0 ? `Pay more: Rs. ${diff.toFixed(2)}` : diff < 0 ? `Give back: Rs. ${Math.abs(diff).toFixed(2)}` : "No difference"}
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
                            {isExchangeMode ? "Select both Return items and new items to complete the Exchange." : "Enter the Return quantity to complete the Return/Refund."}
                          </p>
                          <button
                            onClick={isExchangeMode ? handleProcessExchange : handleProcessReturn}
                            className={`px-6 py-2.5 rounded-lg font-black text-sm shadow-md transition-all ${isExchangeMode ? "bg-amber-500 hover:bg-amber-600" : "bg-red-600 hover:bg-red-700"}`}
                          >
                            {isExchangeMode ? "🔁 Complete Exchange" : "↩️ Complete Return"}
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* 🆕 SMART DASHBOARD (Main menu) */}
          {activeTab === "dashboard" && user.role === "admin" && (
            <div className="w-full h-full overflow-y-auto bg-slate-50">
              <DashboardView
                data={dashboardData}
                days={dashboardDays}
                onChangeDays={(d) => { setDashboardDays(d); try { sessionStorage.setItem("pos_dashboardDays", String(d)); } catch {} }}
                isLoading={isLoadingDashboard}
                onRefresh={() => { fetchDashboard(); fetchExpiringProducts(); }}
                lastUpdated={dashboardUpdatedAt}
                username={user.username}
                lowStock={lowStockProducts
                  .map((p) => ({ _id: p._id, name: p.name, total: getTotalStock(p), min: p.minStockLevel ?? 5, unit: p.unit }))
                  .sort((a, b) => a.total - b.total)}
                expiring={expiringProducts}
                formatQty={formatQtyWithUnit}
                onGo={(sub) => { setAdminSubTab(sub); setActiveTab("admin"); }}
              />
            </div>
          )}

          {/* Admin Panels */}
          {activeTab === "admin" && user.role === "admin" && (
            <div className="flex w-full h-full bg-slate-50 overflow-hidden">
              {/* Sidebar Tabs for Admin */}
              <div className="w-48 bg-slate-800 text-gray-300 flex flex-col font-medium text-sm">
                <button onClick={() => setAdminSubTab("products")} className={`p-3 text-left font-bold ${adminSubTab === "products" ? "bg-blue-600 text-white" : "hover:bg-slate-700"}`}>📦 Stock Management</button>
                <button onClick={() => setAdminSubTab("customers")} className={`p-3 text-left font-bold ${adminSubTab === "customers" ? "bg-blue-600 text-white" : "hover:bg-slate-700"}`}>👥 Customer Records</button>
                <button onClick={() => setAdminSubTab("promotions")} className={`p-3 text-left font-bold ${adminSubTab === "promotions" ? "bg-blue-600 text-white" : "hover:bg-slate-700"}`}>🎉 Special Discounts</button>
                <button onClick={() => setAdminSubTab("suppliers")} className={`p-3 text-left font-bold ${adminSubTab === "suppliers" ? "bg-blue-600 text-white" : "hover:bg-slate-700"}`}>🚚 Suppliers</button>
                <button onClick={() => setAdminSubTab("grnHistory")} className={`p-3 text-left font-bold ${adminSubTab === "grnHistory" ? "bg-blue-600 text-white" : "hover:bg-slate-700"}`}>📋 GRN History</button>
                <button onClick={() => setAdminSubTab("shiftHistory")} className={`p-3 text-left font-bold ${adminSubTab === "shiftHistory" ? "bg-blue-600 text-white" : "hover:bg-slate-700"}`}>🧾 Shift History</button>
                <button onClick={() => setAdminSubTab("outsideShift")} className={`p-3 text-left font-bold ${adminSubTab === "outsideShift" ? "bg-blue-600 text-white" : "hover:bg-slate-700"}`}>🚨 Transactions Outside Shift</button>
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
                <button onClick={() => setAdminSubTab("returns")} className={`p-3 text-left font-bold ${adminSubTab === "returns" ? "bg-blue-600 text-white" : "hover:bg-slate-700"}`}>🔄 Return/Exchange History</button>
                <button onClick={() => setAdminSubTab("sales")} className={`p-3 text-left font-bold ${adminSubTab === "sales" ? "bg-blue-600 text-white" : "hover:bg-slate-700"}`}>📊 Sales Reports</button>
                <button onClick={() => setAdminSubTab("staff")} className={`p-3 text-left font-bold ${adminSubTab === "staff" ? "bg-blue-600 text-white" : "hover:bg-slate-700"}`}>👤 User Accounts</button>
              </div>

              {/* Sub Tab Content Panel */}
              <div className="flex-1 p-6 overflow-y-auto">
                {/* 🆕 DASHBOARD: Today's KPIs, Daily Sales Graph, Cashier Performance, Low Stock summary - Admin's "landing page" */}
                {adminSubTab === "products" && (
                  <div className="space-y-6">
                    {/* Add/Edit Form */}
                    <div ref={productFormRef} className="bg-white p-5 rounded-xl border shadow-xs">
                      <h3 className="text-sm font-black uppercase text-slate-800 mb-4">{isEditing ? "🔄 Edit Item Details" : "➕ Add New Item"}</h3>
                      <form onSubmit={handleFormSubmit} className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">Item name:</label>
                          <input type="text" required value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white" />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">Regular market price (Market Price):</label>
                          <input type="number" required value={productForm.marketPrice} onChange={(e) => setProductForm({ ...productForm, marketPrice: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white" />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">Our selling price (Our Price):</label>
                          <input type="number" required value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white" />
                          {/* 🆕 MULTI-PRICE WARNING: If the Admin changes this field directly - warns upfront that the old price will be lost */}
                          {isEditing && editingOriginalProduct && parseFloat(productForm.price) !== parseFloat(editingOriginalProduct.price) && !showNewPriceEntry && parseFloat(editingOriginalProduct.stock) > 0 && (
                            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-1.5 mt-1 leading-snug">
                              ⚠️ If the price is changed directly like this, the old price (Rs.{parseFloat(editingOriginalProduct.price).toFixed(2)}) will be completely erased and replaced by the new price - no Popup will be shown either.
                              If you want to sell the remaining stock at the old price ({editingOriginalProduct.stock} unit(s)) separately, set this field <b>back to the old value</b> and add the new price only via the <b>🔄 "Received Stock at a new price?"</b> Button below.
                            </p>
                          )}
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">Purchase price (Cost Price):</label>
                          <input type="number" required value={productForm.costPrice} onChange={(e) => setProductForm({ ...productForm, costPrice: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white" />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">
                            Opening stock (Stock Qty):
                            {productForm.batches && productForm.batches.length > 0 && <span className="text-purple-600"> — Auto-Calculated from Batches 🔒</span>}
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
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">Barcode number (Barcode - Optional):</label>
                          <input type="text" value={productForm.barcode} onChange={(e) => setProductForm({ ...productForm, barcode: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white" />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">Unit of measure for the item (Unit):</label>
                          <select value={productForm.unit} onChange={(e) => setProductForm({ ...productForm, unit: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 text-gray-700">
                            <option value="">-- No Unit --</option>
                            <option value="Kg">Kilogram (Kg)</option>
                            <option value="G">Gram (G)</option>
                            <option value="Pieces">Pieces</option>
                            <option value="Packet">Packet</option>
                            <option value="Bottle">Bottle</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">Item category (Category):</label>
                          <select value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 text-gray-700 font-bold">
                            {PRODUCT_CATEGORIES.map((cat) => (
                              <option key={cat.value} value={cat.value}>{cat.icon} {cat.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">Special discount percentage (%):</label>
                          <input type="number" placeholder="0" value={productForm.discountPercent} onChange={(e) => setProductForm({ ...productForm, discountPercent: e.target.value })} className="w-full p-2 border rounded text-xs bg-red-50/50" />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">🔔 Minimum stock level (Reorder Alert Level):</label>
                          <input type="number" placeholder="5" value={productForm.minStockLevel} onChange={(e) => setProductForm({ ...productForm, minStockLevel: e.target.value })} className="w-full p-2 border rounded text-xs bg-purple-50/50 font-bold" />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">🚚 Reorder from this Supplier (Optional):</label>
                          <select value={productForm.preferredSupplierId} onChange={(e) => setProductForm({ ...productForm, preferredSupplierId: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 text-gray-700">
                            <option value="">Not selected</option>
                            {suppliers.map(s => (
                              <option key={s._id} value={s._id}>{s.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">⏳ Expiry date (Expiry Date - Optional):</label>
                          <input type="date" value={productForm.expiryDate} onChange={(e) => setProductForm({ ...productForm, expiryDate: e.target.value })} className="w-full p-2 border rounded text-xs bg-orange-50/50 font-bold" />
                        </div>
                        {/* 🆕 MULTI-PRICE (Simplified): without even the word "Batch", through a single action (only visible when editing) */}
                        {isEditing && (
                          <div className="col-span-2 md:col-span-4 border-t-2 border-purple-200 pt-3 mt-1 bg-purple-50/30 -mx-1 px-2 py-2 rounded-lg">

                            {/* If Multi-Price already exists, shows them simply as Summary chips */}
                            {productForm.batches && productForm.batches.length > 0 && (
                              <div className="mb-2">
                                <p className="text-[10px] font-black text-purple-800 uppercase mb-1">💰 Current prices for this item:</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {productForm.batches.map((batch, index) => (
                                    <span key={index} className="inline-flex items-center gap-1.5 bg-white border border-purple-300 rounded-full pl-3 pr-1 py-1 text-[11px] font-bold text-slate-700">
                                      {batch.label || `Price ${index + 1}`}: Rs.{parseFloat(batch.price || 0).toFixed(2)} ({batch.stock} unit(s))
                                      {parseFloat(batch.costPrice) > 0 && <span className="text-gray-400 font-normal">| Cost: Rs.{parseFloat(batch.costPrice).toFixed(2)}</span>}
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
                                🔄 Received Stock at a new price? (Multi-Price) — Click here
                              </button>
                            ) : (
                              <div className="bg-white border border-purple-300 rounded-lg p-3 space-y-2">
                                <p className="text-[10px] text-gray-500 leading-relaxed">
                                  The old stock ({editingOriginalProduct?.stock ?? 0} unit(s) at Rs.{editingOriginalProduct ? parseFloat(editingOriginalProduct.price || 0).toFixed(2) : "0.00"}) can still be sold as it is.
                                  Only enter the price and quantity of the <b>newly</b> received Stock here:
                                </p>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="text-[10px] font-bold text-gray-500 block mb-1">New selling price (Rs.):</label>
                                    <input type="number" placeholder="e.g. 1050" value={newPriceEntry.price} onChange={(e) => setNewPriceEntry({ ...newPriceEntry, price: e.target.value })} className="w-full p-2 border rounded text-xs font-black text-purple-800 bg-purple-50/30" />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-bold text-gray-500 block mb-1">Newly received quantity:</label>
                                    <input type="number" placeholder="e.g. 20" value={newPriceEntry.qty} onChange={(e) => setNewPriceEntry({ ...newPriceEntry, qty: e.target.value })} className="w-full p-2 border rounded text-xs font-black text-purple-800 bg-purple-50/30" />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-bold text-gray-500 block mb-1">🆕 Cost price of this Stock (Cost Price):</label>
                                    <input type="number" placeholder="e.g. 880" value={newPriceEntry.costPrice} onChange={(e) => setNewPriceEntry({ ...newPriceEntry, costPrice: e.target.value })} className="w-full p-2 border rounded text-xs font-bold text-slate-700 bg-slate-50" />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-bold text-gray-500 block mb-1">🆕 Discount % for this Stock (Optional):</label>
                                    <input type="number" placeholder="e.g. 5" value={newPriceEntry.discount} onChange={(e) => setNewPriceEntry({ ...newPriceEntry, discount: e.target.value })} className="w-full p-2 border rounded text-xs font-bold text-slate-700 bg-slate-50" />
                                  </div>
                                </div>
                                <p className="text-[9px] text-gray-400 leading-snug">💡 The profit from this exact Stock is shown accurately in sales reports only if the Cost Price is entered correctly.</p>
                                <div className="flex gap-2">
                                  <button type="button" onClick={() => { setShowNewPriceEntry(false); setNewPriceEntry({ price: "", qty: "", costPrice: "", discount: "" }); }} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 py-1.5 rounded text-xs font-bold">Cancel</button>
                                  <button type="button" onClick={handleAddNewPricePoint} className="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-1.5 rounded text-xs font-bold">✔️ Add</button>
                                </div>
                              </div>
                            )}

                            {productForm.batches && productForm.batches.length > 1 && (
                              <p className="text-[10px] text-emerald-700 font-semibold mt-2">✅ Since there are 2 or more prices, a Popup to choose the price appears when scanning/searching on the Billing screen.</p>
                            )}
                          </div>
                        )}

                        <div className="col-span-2 md:col-span-4 flex justify-end gap-2 pt-2">
                          {isEditing && <button type="button" onClick={() => { setIsEditing(false); setEditingOriginalProduct(null); setProductForm({ name: "", marketPrice: "", price: "", costPrice: "", stock: "", barcode: "", discountPercent: "", unit: "Kg", category: "Grocery", minStockLevel: "5", preferredSupplierId: "", expiryDate: "", batches: [] }); setShowNewPriceEntry(false); setNewPriceEntry({ price: "", qty: "", costPrice: "", discount: "" }); }} className="bg-gray-500 text-white px-4 py-2 rounded text-xs font-bold">Cancel</button>}
                          <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded text-xs font-bold shadow-md">{isEditing ? "Update" : "Add to Database"}</button>
                        </div>
                      </form>
                    </div>

                    {/* Stock Table List */}
                    <div className="bg-white rounded-xl border shadow-xs overflow-hidden">
                      <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                        <h3 className="text-xs font-black uppercase text-slate-800">📦 Current Inventory Stock List ({products.length} Items)</h3>
                        <input type="text" placeholder="Search by item name or barcode..." value={adminProductSearch} onChange={(e) => setAdminProductSearch(e.target.value)} className="p-1.5 border rounded-lg text-xs w-64 bg-white" />
                      </div>
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-100 text-slate-700 font-bold border-b border-gray-200">
                            <th className="p-3">Item name</th>
                            <th className="p-3">Category</th>
                            <th className="p-3">Barcode</th>
                            <th className="p-3 text-right">Market price</th>
                            <th className="p-3 text-right">Our price</th>
                            <th className="p-3 text-right">Purchase price</th>
                            <th className="p-3 text-center">Current stock</th>
                            <th className="p-3 text-center">Discounts</th>
                            <th className="p-3 text-center">⏳ Expiry</th>
                            <th className="p-3 text-center">Actions</th>
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
                              <td className="p-3 text-right text-gray-500">Rs. {p.marketPrice?.toFixed(2) || p.price?.toFixed(2)}</td>
                              <td className="p-3 text-right font-black text-blue-600">Rs. {p.price.toFixed(2)}</td>
                              <td className="p-3 text-right text-emerald-700">Rs. {p.costPrice?.toFixed(2) || "0.00"}</td>
                              <td className="p-3 text-center font-black"><span className={`px-2 py-0.5 rounded-sm ${getTotalStock(p) > (p.minStockLevel ?? 5) ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-600'}`}>{formatQtyWithUnit(getTotalStock(p), p.unit ?? 'Kg')}</span></td>
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
                                <button onClick={() => handleEditClick(p)} className="bg-amber-500 hover:bg-amber-600 text-white px-2 py-1 m-1 rounded text-[10px] font-bold">Edit</button>
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
                      <p className="text-xs text-gray-500">Items below the minimum stock level, grouped by Supplier</p>
                    </div>

                    {lowStockProducts.length === 0 ? (
                      <div className="bg-white p-10 rounded-xl border shadow-xs flex flex-col items-center justify-center text-center">
                        <span className="text-4xl mb-2">✅</span>
                        <p className="text-sm font-bold text-slate-700">All items have sufficient stock!</p>
                        <p className="text-xs text-gray-400 mt-1">No items need reordering</p>
                      </div>
                    ) : (
                      Object.entries(lowStockGroupedBySupplier).map(([supplierKey, productsGroup]) => {
                        const supplier = supplierKey !== "unassigned" ? suppliers.find(s => s._id === supplierKey) : null;
                        return (
                          <div key={supplierKey} className="bg-white rounded-xl border shadow-xs overflow-hidden">
                            <div className="p-4 border-b bg-gray-50">
                              <h4 className="text-xs font-black uppercase text-slate-800">
                                {supplier ? `🚚 ${supplier.name}` : "❓ Items without a Supplier"}
                              </h4>
                              <p className="text-[10px] text-gray-400 mt-0.5">{productsGroup.length} item(s) need reordering</p>
                            </div>
                            <table className="w-full text-left border-collapse text-xs">
                              <thead>
                                <tr className="bg-slate-100 text-slate-700 font-bold border-b">
                                  <th className="p-3">Item name</th>
                                  <th className="p-3 text-center">Current stock</th>
                                  <th className="p-3 text-center">Minimum level</th>
                                  <th className="p-3 text-center">Suggested Reorder quantity</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 font-medium">
                                {productsGroup.map((p) => (
                                  <tr key={p._id} className="hover:bg-red-50/40">
                                    <td className="p-3 font-bold text-slate-900">{p.name}</td>
                                    <td className="p-3 text-center"><span className="bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-black">{formatQtyWithUnit(getTotalStock(p), p.unit ?? "Kg")}</span></td>
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
                      <p className="text-xs text-gray-500">List of items expiring within the next 7 days and items that have already expired</p>
                    </div>

                    {expiringProducts.length === 0 ? (
                      <div className="bg-white p-10 rounded-xl border shadow-xs flex flex-col items-center justify-center text-center">
                        <span className="text-4xl mb-2">✅</span>
                        <p className="text-sm font-bold text-slate-700">No items expiring soon!</p>
                      </div>
                    ) : (
                      <div className="bg-white rounded-xl border shadow-xs overflow-hidden">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-100 text-slate-700 font-bold border-b">
                              <th className="p-3">Item name</th>
                              <th className="p-3 text-center">Current stock</th>
                              <th className="p-3 text-center">Expiry Date</th>
                              <th className="p-3 text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 font-medium">
                            {expiringProducts.map((p) => (
                              <tr key={p._id} className={p.expiryStatus === "expired" ? "bg-red-50/60" : "bg-amber-50/40"}>
                                <td className="p-3 font-bold text-slate-900">{p.name}</td>
                                <td className="p-3 text-center">{formatQtyWithUnit(getTotalStock(p), p.unit ?? "Kg")}</td>
                                <td className="p-3 text-center font-bold">{new Date(p.expiryDate).toLocaleDateString()}</td>
                                <td className="p-3 text-center">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${p.expiryStatus === "expired" ? "bg-red-600 text-white" : "bg-amber-400 text-amber-950"}`}>
                                    {p.expiryStatus === "expired" ? "⛔ Expired" : "⚠️ Expiring soon"}
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
                        <p className="text-xs text-gray-500">List of items sold via "Emergency" without being registered in the Database - Review them and register the ones you need in the Catalog.</p>
                      </div>
                      {unregisteredItemGroups.length > 0 && (
                        <button onClick={handleClearAllUnregisteredItems} className="bg-red-50 hover:bg-red-600 text-red-600 hover:text-white border border-red-200 px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all">🧹 Remove All</button>
                      )}
                    </div>

                    {unregisteredItemGroups.length === 0 ? (
                      <div className="bg-white p-10 rounded-xl border shadow-xs flex flex-col items-center justify-center text-center">
                        <span className="text-4xl mb-2">✅</span>
                        <p className="text-sm font-bold text-slate-700">No Items need registering!</p>
                        <p className="text-xs text-gray-400 mt-1">No items have been sold as Unregistered yet</p>
                      </div>
                    ) : (
                      <div className="bg-white rounded-xl border shadow-xs overflow-hidden">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-100 text-slate-700 font-bold border-b">
                              <th className="p-3">Item name</th>
                              <th className="p-3 text-center">Total quantity sold</th>
                              <th className="p-3 text-center">Times sold</th>
                              <th className="p-3 text-right">Average price</th>
                              <th className="p-3 text-center">Last sold date</th>
                              <th className="p-3 text-center">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 font-medium">
                            {unregisteredItemGroups.map((g) => (
                              <tr key={g.name} className="hover:bg-amber-50/40">
                                <td className="p-3 font-bold text-slate-900">{g.name}</td>
                                <td className="p-3 text-center">{g.totalQty}</td>
                                <td className="p-3 text-center"><span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-black">{g.occurrences}×</span></td>
                                <td className="p-3 text-right text-gray-600">Rs. {g.avgPrice.toFixed(2)}</td>
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
                        <p className="text-xs text-gray-500">All Return, Refund and Exchange transactions made</p>
                      </div>
                      {returnHistory.length > 0 && (
                        <button onClick={handleClearAllReturns} className="bg-red-50 hover:bg-red-600 text-red-600 hover:text-white border border-red-200 px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all">🧹 Remove All</button>
                      )}
                    </div>

                    {returnHistory.length === 0 ? (
                      <div className="bg-white p-10 rounded-xl border shadow-xs flex flex-col items-center justify-center text-center">
                        <span className="text-4xl mb-2">📭</span>
                        <p className="text-sm font-bold text-slate-700">No Return/Exchange has occurred yet</p>
                      </div>
                    ) : (
                      <div className="bg-white rounded-xl border shadow-xs overflow-hidden">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-100 text-slate-700 font-bold border-b">
                              <th className="p-3">Date</th>
                              <th className="p-3">Original bill number</th>
                              <th className="p-3">Type</th>
                              <th className="p-3">Cashier</th>
                              <th className="p-3">Items</th>
                              <th className="p-3">Refund Method</th>
                              <th className="p-3 text-right">Refund Amount</th>
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
                                <td className="p-3 text-right font-black text-red-600">Rs. {r.totalRefundAmount.toFixed(2)}</td>
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
                      <h3 className="text-xs font-black uppercase text-slate-800 mb-4">{isEditingCustomer ? "🔄 Edit Customer Account" : "➕ Register New Customer"}</h3>
                      <form onSubmit={handleCustomerSubmit} className="space-y-4">
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">Customer Name:</label>
                          <input type="text" required value={customerForm.name} onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white" />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">Phone Number:</label>
                          <input
                            type="tel"
                            inputMode="tel"
                            required
                            value={customerForm.phone}
                            onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                            placeholder="0771234567"
                            className={`w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white ${customerForm.phone && !isValidPhone(customerForm.phone) ? "border-red-400 focus:border-red-500" : ""}`}
                          />
                          {customerForm.phone !== "" && !isValidPhone(customerForm.phone) && (
                            <p className="text-[10px] text-red-600 font-bold mt-1">Invalid phone number (e.g. 0771234567)</p>
                          )}
                        </div>
                        <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded text-xs font-bold shadow-md">{isEditingCustomer ? "Update" : "Create Account"}</button>
                      </form>

                      {/* Manual Settle Credit Payment Section */}
                      <div className="border-t pt-4 mt-6">
                        <h3 className="text-xs font-black uppercase text-red-700 mb-3">💵 Record Credit Payment</h3>
                        <form onSubmit={handleSettleCredit} className="space-y-3">
                          <select required value={creditPayment.customerId} onChange={(e) => setCreditPayment({ ...creditPayment, customerId: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 text-gray-700 font-bold">
                            <option value="">Select Customer...</option>
                            {customers.map(c => (
                              <option key={c._id} value={c._id}>{c.name} (Credit: Rs.{c.creditBalance?.toFixed(2)})</option>
                            ))}
                          </select>
                          <input type="number" required placeholder="Amount Paid (Rs.)" value={creditPayment.amount} onChange={(e) => setCreditPayment({ ...creditPayment, amount: e.target.value })} className="w-full p-2 border rounded text-xs font-black text-emerald-700" />
                          {/* 🆕 SHIFT RECONCILIATION: Payment Method selection - only "Cash" payments are counted in the Cashier's
                              Shift Close Cash Drawer calculation (Expected Cash) */}
                          <select value={creditPayment.paymentMethod} onChange={(e) => setCreditPayment({ ...creditPayment, paymentMethod: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 text-gray-700 font-bold">
                            <option value="Cash">💵 Cash</option>
                            <option value="Card">💳 Card</option>
                            <option value="Bank Transfer">🏦 Bank transfer (Bank Transfer)</option>
                            <option value="Other">🔁 Other</option>
                          </select>
                          {(creditPayment.paymentMethod || "Cash") === "Cash" && !activeShift && user?.role !== "admin" && (
                            <p className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">⛔ No Shift is Open - Start a Shift before recording a Cash payment</p>
                          )}
                          {/* 🆕 FIX: If the selected customer has no credit due, disable the submit button and
                              show a clear message - no need to wait for the backend to fail */}
                          {(() => {
                            const selectedForPayment = customers.find((c) => c._id === creditPayment.customerId);
                            const hasNoDue = selectedForPayment && (selectedForPayment.creditBalance || 0) <= 0;
                            return (
                              <>
                                {hasNoDue && (
                                  <p className="text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">⚠️ This customer has no credit due - no payment required</p>
                                )}
                                <button type="submit" disabled={hasNoDue} className="w-full bg-emerald-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-2 rounded text-xs font-bold">Settle Credit Amount 🎉</button>
                              </>
                            );
                          })()}
                        </form>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border shadow-xs overflow-hidden lg:col-span-2">
                      <div className="p-4 border-b bg-gray-50">
                        <h3 className="text-xs font-black uppercase text-slate-800">👥 Registered Customer Directory ({customers.length} Customers)</h3>
                      </div>
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-100 text-slate-700 font-bold border-b">
                            <th className="p-3">Customer Name</th>
                            <th className="p-3">Phone Number</th>
                            <th className="p-3 text-right">Total Outstanding Credit</th>
                            <th className="p-3 text-center">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 font-medium">
                          {customers.map((c) => (
                              <tr key={c._id} onClick={() => setViewCustomerDetails(c._id)} className="hover:bg-blue-50/60 cursor-pointer transition-colors">
                                <td className="p-3 font-bold text-slate-900 hover:text-blue-600 hover:underline">{c.name}</td>
                                <td className="p-3 text-gray-500">{c.phone}</td>
                                <td className="p-3 text-right font-black text-red-600">Rs. {c.creditBalance?.toFixed(2) || "0.00"}</td>
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

                {/* 🆕 BILL-LEVEL DISCOUNT: Special Occasions Sub-tab (Occasion-only, no Loyalty) */}
                {adminSubTab === "promotions" && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Add Promotion Form */}
                    <div className="bg-white p-5 rounded-xl border shadow-xs h-fit">
                      <h3 className="text-xs font-black uppercase text-slate-800 mb-4">➕ Add Special Discount</h3>
                      <form onSubmit={handlePromotionSubmit} className="space-y-4">
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">Discount Name:</label>
                          <input
                            type="text"
                            required
                            value={promotionForm.name}
                            onChange={(e) => setPromotionForm({ ...promotionForm, name: e.target.value })}
                            className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white"
                            placeholder="e.g. New Year festival"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">Discount Percentage (%):</label>
                          <input
                            type="number"
                            required
                            min="0"
                            max="100"
                            step="0.1"
                            value={promotionForm.discountPercent}
                            onChange={(e) => setPromotionForm({ ...promotionForm, discountPercent: e.target.value })}
                            className="w-full p-2 border rounded text-xs font-black text-emerald-700"
                            placeholder="10"
                          />
                        </div>
                        <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded text-xs font-bold shadow-md">Set Discount</button>
                      </form>
                    </div>

                    {/* Promotions List */}
                    <div className="lg:col-span-2 bg-white rounded-xl border shadow-xs overflow-hidden h-fit">
                      <div className="p-4 border-b bg-gray-50">
                        <h3 className="text-xs font-black uppercase text-slate-800">🎉 Special Discounts</h3>
                        <p className="text-[10px] text-gray-400 mt-0.5">Only one can be Active at a time - the Cashier can Apply it on the Billing Screen</p>
                      </div>
                      {promotions.filter((p) => p.type === "occasion").length === 0 ? (
                        <div className="p-6 text-center text-gray-400 text-xs">No Occasion Promotions yet</div>
                      ) : (
                        <div className="divide-y divide-gray-100">
                          {promotions.filter((p) => p.type === "occasion").map((p) => (
                            <div key={p._id} className={`flex justify-between items-center px-4 py-3 ${p.isActive ? "bg-pink-50" : ""}`}>
                              <div>
                                <p className="text-xs font-bold text-slate-800">
                                  {p.name}
                                  {p.isActive && <span className="ml-1.5 text-[9px] bg-pink-600 text-white px-1.5 py-0.5 rounded-full font-black align-middle">ACTIVE</span>}
                                </p>
                                <p className="text-[10px] text-gray-500">{p.discountPercent}% OFF</p>
                              </div>
                              <div className="space-x-1.5 shrink-0">
                                {p.isActive ? (
                                  <button onClick={() => handleDeactivatePromotion(p._id)} className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-2 py-1 rounded text-[10px] font-bold">Deactivate</button>
                                ) : (
                                  <button onClick={() => handleActivatePromotion(p._id)} className="bg-pink-600 hover:bg-pink-700 text-white px-2 py-1 rounded text-[10px] font-bold">Activate</button>
                                )}
                                <button onClick={() => handleDeletePromotion(p._id)} className="bg-red-100 hover:bg-red-600 text-red-600 hover:text-white px-2 py-1 rounded text-[10px] font-bold">🗑️</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 🛠️ NEW: Suppliers Sub-tab with Balance Due Ledger */}
                {adminSubTab === "suppliers" && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="space-y-6">
                      {/* Add/Edit Supplier Form */}
                      <div className="bg-white p-5 rounded-xl border shadow-xs h-fit">
                        <h3 className="text-xs font-black uppercase text-slate-800 mb-4">{isEditingSupplier ? "🔄 Edit supplier details" : "➕ Register a new supplier"}</h3>
                        <form onSubmit={handleSupplierSubmit} className="space-y-4">
                          <div>
                            <label className="text-[11px] font-bold text-gray-600 block mb-1">Supplier name:</label>
                            <input type="text" required value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white" />
                          </div>
                          <div>
                            <label className="text-[11px] font-bold text-gray-600 block mb-1">Phone Number:</label>
                            <input
                              type="tel"
                              inputMode="tel"
                              required
                              value={supplierForm.phone}
                              onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                              placeholder="0771234567"
                              className={`w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white ${supplierForm.phone && !isValidPhone(supplierForm.phone) ? "border-red-400 focus:border-red-500" : ""}`}
                            />
                            {supplierForm.phone !== "" && !isValidPhone(supplierForm.phone) && (
                              <p className="text-[10px] text-red-600 font-bold mt-1">Invalid phone number (e.g. 0771234567)</p>
                            )}
                          </div>
                          <div>
                            <label className="text-[11px] font-bold text-gray-600 block mb-1">Address (Optional):</label>
                            <input type="text" value={supplierForm.address} onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white" />
                          </div>
                          <div className="flex gap-2">
                            {isEditingSupplier && <button type="button" onClick={() => { setIsEditingSupplier(false); setEditSupplierId(null); setSupplierForm({ name: "", phone: "", address: "" }); }} className="flex-1 bg-gray-500 text-white py-2 rounded text-xs font-bold">Cancel</button>}
                            <button type="submit" className="flex-1 bg-blue-600 text-white py-2 rounded text-xs font-bold shadow-md">{isEditingSupplier ? "Update" : "Create Account"}</button>
                          </div>
                        </form>
                      </div>

                      {/* 🆕 PROFESSIONAL GRN REBUILD: Modernized Cart-style Stock Receipt Recording */}
                      <div className="bg-white p-5 rounded-xl border shadow-xs h-fit">
                        <h3 className="text-xs font-black uppercase text-amber-700 mb-3">📦 Record New GRN</h3>
                        <p className="text-[10px] text-gray-500 mb-3">Add all items received on the same Invoice here — when you Submit at the end, a Document with a GRN number is created automatically.</p>

                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-2">
                            <select value={grnSupplierId} onChange={(e) => setGrnSupplierId(e.target.value)} className="w-full p-2 border rounded text-xs bg-gray-50 text-gray-700 font-bold">
                              <option value="">Select supplier...</option>
                              {suppliers.map(s => (
                                <option key={s._id} value={s._id}>{s.name} (Payable: Rs.{s.balanceDue?.toFixed(2)})</option>
                              ))}
                            </select>
                            <input
                              type="text"
                              placeholder="Supplier invoice number"
                              value={grnSupplierInvoiceRef}
                              onChange={(e) => setGrnSupplierInvoiceRef(e.target.value)}
                              className="w-full p-2 border rounded text-xs bg-gray-50"
                            />
                          </div>

                          {/* Add Item Row */}
                          <div className="bg-amber-50/60 border border-amber-200 rounded-lg p-3 space-y-2">
                            <select
                              value={grnCurrentItem.productId}
                              onChange={(e) => {
                                const selectedProduct = products.find(p => p._id === e.target.value);
                                setGrnCurrentItem({
                                  ...grnCurrentItem,
                                  productId: e.target.value,
                                  // 🛠️ Once an item is selected, the existing Cost Price is auto-filled
                                  costPrice: selectedProduct ? String(selectedProduct.costPrice || "") : ""
                                });
                              }}
                              className="w-full p-2 border rounded text-xs bg-white text-gray-700 font-bold"
                            >
                              <option value="">Select Item...</option>
                              {products.map(p => (
                                <option key={p._id} value={p._id}>{p.name} (Current Stock: {formatQtyWithUnit(getTotalStock(p), p.unit ?? "Kg")})</option>
                              ))}
                            </select>

                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] font-bold text-gray-500 block mb-1">Ordered Quantity (Optional):</label>
                                <input type="number" step="0.001" placeholder="Ordered Qty" value={grnCurrentItem.orderedQty} onChange={(e) => setGrnCurrentItem({ ...grnCurrentItem, orderedQty: e.target.value })} className="w-full p-2 border rounded text-xs font-black text-slate-500 bg-white" />
                              </div>
                              <div>
                                <label className="text-[10px] font-bold text-gray-500 block mb-1">Received Quantity: <span className="text-red-500">*</span></label>
                                <input type="number" step="0.001" placeholder="Received Qty" value={grnCurrentItem.quantity} onChange={(e) => setGrnCurrentItem({ ...grnCurrentItem, quantity: e.target.value })} className="w-full p-2 border rounded text-xs font-black text-slate-800 bg-white" />
                              </div>
                            </div>

                            {grnCurrentItem.orderedQty && grnCurrentItem.quantity && parseFloat(grnCurrentItem.orderedQty) !== parseFloat(grnCurrentItem.quantity) && (
                              <p className="text-[10px] text-red-600 font-bold bg-red-50 border border-red-200 rounded px-2 py-1">
                                ⚠️ Discrepancy: Ordered {grnCurrentItem.orderedQty}, received {grnCurrentItem.quantity}
                              </p>
                            )}

                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] font-bold text-gray-500 block mb-1">Purchase Price (Rs./unit):</label>
                                <input type="number" step="0.01" placeholder="Cost Price" value={grnCurrentItem.costPrice} onChange={(e) => setGrnCurrentItem({ ...grnCurrentItem, costPrice: e.target.value })} className="w-full p-2 border rounded text-xs font-black text-amber-700 bg-white" />
                              </div>
                              <div>
                                <label className="text-[10px] font-bold text-gray-500 block mb-1">Expiry Date (Optional):</label>
                                <input type="date" value={grnCurrentItem.expiryDate} onChange={(e) => setGrnCurrentItem({ ...grnCurrentItem, expiryDate: e.target.value })} className="w-full p-2 border rounded text-xs font-bold text-slate-700 bg-white" />
                              </div>
                            </div>

                            {/* 🛠️ Stock Mode Toggle - Add (creates a new Batch) vs Set (set as / Overwrite) */}
                            <div>
                              <label className="text-[10px] font-bold text-gray-500 block mb-1">Action on current stock:</label>
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
                                  ➕ Add More (New Batch)
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
                                  🔄 Replace
                                </button>
                              </div>
                              {grnCurrentItem.stockMode === "set" && (
                                <p className="text-[9px] text-purple-600 font-bold mt-1">⚠️ Current stock will be fully replaced with this quantity (Opening Stock / Correction only — not allowed for Products with multiple Batches)</p>
                              )}
                            </div>

                            <button type="button" onClick={handleAddGrnItem} className="w-full bg-amber-600 hover:bg-amber-700 text-white py-1.5 rounded text-xs font-bold transition-all">➕ Add to List</button>
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
                                        {item.hasDiscrepancy && (
                                          <span className="ml-1.5 text-[8px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-black align-middle">⚠️ DISCREPANCY</span>
                                        )}
                                      </p>
                                      <p className="text-[10px] text-gray-500">
                                        {item.orderedQty > 0 ? `${formatQtyWithUnit(item.orderedQty, item.unit)} Ordered → ` : ""}
                                        {formatQtyWithUnit(item.quantity, item.unit)} Received × Rs.{item.costPrice.toFixed(2)}
                                        {item.expiryDate ? ` • Exp: ${item.expiryDate}` : ""}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="font-black text-amber-700">Rs.{(item.quantity * item.costPrice).toFixed(2)}</span>
                                      <button type="button" onClick={() => handleRemoveGrnItem(index)} className="text-red-400 hover:text-red-600 font-bold px-1">✕</button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <div className="bg-amber-50 border-t border-amber-200 px-3 py-2 flex justify-between items-center">
                                <span className="text-[11px] font-bold text-amber-800">Grand Total:</span>
                                <span className="text-sm font-black text-amber-900">Rs. {grnItems.reduce((sum, item) => sum + (item.quantity * item.costPrice), 0).toFixed(2)}</span>
                              </div>
                            </div>
                          )}

                          <input type="text" placeholder="Note (Optional)" value={grnDescription} onChange={(e) => setGrnDescription(e.target.value)} className="w-full p-2 border rounded text-xs" />

                          <button type="button" onClick={handleSubmitGrn} disabled={grnItems.length === 0 || !grnSupplierId || isSubmittingGrn} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-2 rounded text-xs font-bold transition-all">
                            {isSubmittingGrn ? "⏳ Recording..." : "✅ Submit Complete GRN"}
                          </button>
                        </div>
                      </div>

                      {/* Settle Supplier Payment (reduces Balance Due) */}
                      <div className="bg-white p-5 rounded-xl border shadow-xs h-fit">
                        <h3 className="text-xs font-black uppercase text-emerald-700 mb-3">💵 Pay supplier</h3>
                        <form onSubmit={handleSettleSupplierPayment} className="space-y-3">
                          <select required value={supplierPayment.supplierId} onChange={(e) => setSupplierPayment({ ...supplierPayment, supplierId: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 text-gray-700 font-bold">
                            <option value="">Select supplier...</option>
                            {suppliers.map(s => (
                              <option key={s._id} value={s._id}>{s.name} (Payable: Rs.{s.balanceDue?.toFixed(2)})</option>
                            ))}
                          </select>
                          <input type="number" required placeholder="Amount Paid (Rs.)" value={supplierPayment.amount} onChange={(e) => setSupplierPayment({ ...supplierPayment, amount: e.target.value })} className="w-full p-2 border rounded text-xs font-black text-emerald-700" />
                          {/* 🆕 SHIFT RECONCILIATION: Payment Method selection - only "Cash" payments are deducted from the Cashier's
                              Shift Close Cash Drawer calculation (Expected Cash) */}
                          <select value={supplierPayment.paymentMethod} onChange={(e) => setSupplierPayment({ ...supplierPayment, paymentMethod: e.target.value })} className="w-full p-2 border rounded text-xs bg-gray-50 text-gray-700 font-bold">
                            <option value="Cash">💵 Cash</option>
                            <option value="Card">💳 Card</option>
                            <option value="Bank Transfer">🏦 Bank transfer (Bank Transfer)</option>
                            <option value="Other">🔁 Other</option>
                          </select>
                          {(supplierPayment.paymentMethod || "Cash") === "Cash" && !activeShift && user?.role !== "admin" && (
                            <p className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">⛔ No Shift is Open - Start a Shift before recording a Cash payment</p>
                          )}
                          {/* 🆕 FIX: If the selected supplier has no amount payable, the submit button is disabled */}
                          {(() => {
                            const selectedSupplierForPayment = suppliers.find((s) => s._id === supplierPayment.supplierId);
                            const hasNoDue = selectedSupplierForPayment && (selectedSupplierForPayment.balanceDue || 0) <= 0;
                            return (
                              <>
                                {hasNoDue && (
                                  <p className="text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">⚠️ There is no balance payable to this supplier - no payment needed</p>
                                )}
                                <button type="submit" disabled={hasNoDue} className="w-full bg-emerald-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-2 rounded text-xs font-bold">Record Payment 🎉</button>
                              </>
                            );
                          })()}
                        </form>
                      </div>
                    </div>

                    {/* Suppliers Table */}
                    <div className="bg-white rounded-xl border shadow-xs overflow-hidden lg:col-span-2 h-fit">
                      <div className="p-4 border-b bg-gray-50">
                        <h3 className="text-xs font-black uppercase text-slate-800">🚚 Registered suppliers ({suppliers.length} Suppliers)</h3>
                        <p className="text-[10px] text-gray-400 mt-0.5">💡 To view the full transaction history, click a Supplier</p>
                      </div>
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-100 text-slate-700 font-bold border-b">
                            <th className="p-3">Supplier name</th>
                            <th className="p-3">Phone Number</th>
                            <th className="p-3">Address</th>
                            <th className="p-3 text-right">Amount We Owe</th>
                            <th className="p-3 text-center">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 font-medium">
                          {suppliers.length === 0 && (
                            <tr><td colSpan="5" className="p-6 text-center text-gray-400">No suppliers registered yet</td></tr>
                          )}
                          {suppliers.map((s) => (
                            <tr key={s._id} onClick={() => setViewSupplierDetails(s)} className="hover:bg-blue-50/60 cursor-pointer transition-colors">
                              <td className="p-3 font-bold text-slate-900 hover:text-blue-600 hover:underline">{s.name}</td>
                              <td className="p-3 text-gray-500">{s.phone}</td>
                              <td className="p-3 text-gray-500">{s.address || "-"}</td>
                              <td className="p-3 text-right font-black text-red-600">Rs. {s.balanceDue?.toFixed(2) || "0.00"}</td>
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

                {/* 🆕 PROFESSIONAL GRN REBUILD: GRN History Tab - Filter/Search + Print */}
                {adminSubTab === "grnHistory" && (
                  <div className="p-6 space-y-4">
                    <div className="bg-white p-4 rounded-xl border shadow-xs">
                      <h3 className="text-xs font-black uppercase text-slate-800 mb-3">📋 GRN History (Goods Received Notes)</h3>
                      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                        <select
                          value={grnHistoryFilters.supplierId}
                          onChange={(e) => setGrnHistoryFilters({ ...grnHistoryFilters, supplierId: e.target.value })}
                          className="p-2 border rounded text-xs bg-gray-50 font-bold text-gray-700"
                        >
                          <option value="">All suppliers</option>
                          {suppliers.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
                        </select>
                        <input type="date" value={grnHistoryFilters.from} onChange={(e) => setGrnHistoryFilters({ ...grnHistoryFilters, from: e.target.value })} className="p-2 border rounded text-xs" />
                        <input type="date" value={grnHistoryFilters.to} onChange={(e) => setGrnHistoryFilters({ ...grnHistoryFilters, to: e.target.value })} className="p-2 border rounded text-xs" />
                        <input
                          type="text"
                          placeholder="Search GRN Number / Invoice Ref..."
                          value={grnHistoryFilters.q}
                          onChange={(e) => setGrnHistoryFilters({ ...grnHistoryFilters, q: e.target.value })}
                          className="p-2 border rounded text-xs"
                        />
                        <button onClick={fetchGrnHistory} className="bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold py-2">🔍 Filter</button>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border shadow-xs overflow-hidden">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-100 text-slate-700 font-bold border-b">
                            <th className="p-3">GRN Number</th>
                            <th className="p-3">Date</th>
                            <th className="p-3">Supplier</th>
                            <th className="p-3">Invoice Ref</th>
                            <th className="p-3 text-center">Status</th>
                            <th className="p-3 text-right">Total</th>
                            <th className="p-3 text-center">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 font-medium">
                          {isLoadingGrnHistory && (
                            <tr><td colSpan="7" className="p-6 text-center text-gray-400">Loading...</td></tr>
                          )}
                          {!isLoadingGrnHistory && grnHistory.length === 0 && (
                            <tr><td colSpan="7" className="p-6 text-center text-gray-400">No GRN records found</td></tr>
                          )}
                          {!isLoadingGrnHistory && grnHistory.map((g) => (
                            <tr key={g._id} onClick={() => setViewGrnDetails(g)} className="hover:bg-blue-50/60 cursor-pointer transition-colors">
                              <td className="p-3 font-black text-slate-900">{g.grnNo}</td>
                              <td className="p-3 text-gray-500">{new Date(g.date).toLocaleDateString()}</td>
                              <td className="p-3 text-gray-700 font-bold">{g.supplierName}</td>
                              <td className="p-3 text-gray-500">{g.supplierInvoiceRef || "-"}</td>
                              <td className="p-3 text-center">
                                <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                                  g.status === "Received" ? "bg-emerald-100 text-emerald-700" :
                                  g.status === "Partially Received" ? "bg-amber-100 text-amber-700" :
                                  "bg-red-100 text-red-700"
                                }`}>{g.status}</span>
                              </td>
                              <td className="p-3 text-right font-black text-amber-700">Rs. {g.grandTotal?.toFixed(2)}</td>
                              <td className="p-3 text-center">
                                <button onClick={(e) => { e.stopPropagation(); handlePrintGrn(g); }} className="bg-slate-700 hover:bg-slate-800 text-white px-2 py-1 rounded text-[10px] font-bold">🖨️ Print</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 🆕 SHIFT HISTORY: Cash Drawer Reconciliation records - Over/Short at a glance */}
                {adminSubTab === "outsideShift" && (
                  <div className="p-6 space-y-4">
                    <div className="bg-white p-4 rounded-xl border shadow-xs">
                      <h3 className="text-xs font-black uppercase text-slate-800 mb-1">🚨 Transactions Without a Shift</h3>
                      <p className="text-[11px] text-gray-500 mb-3">Transactions (bills, Returns, credit payments and supplier payments) that occurred while the Cashier had no Open Shift (before Shift Start or after Close) appear here. Since these are not included in any Shift's Expected Cash, the cash in the Drawer cannot be accounted for. (Default: last 7 days)</p>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <select
                          value={outsideFilters.cashier}
                          onChange={(e) => setOutsideFilters({ ...outsideFilters, cashier: e.target.value })}
                          className="p-2 border rounded text-xs bg-gray-50 font-bold text-gray-700"
                        >
                          <option value="">All Cashiers</option>
                          {staffUsers.map(u => <option key={u._id} value={u.username}>{u.username}</option>)}
                        </select>
                        <input type="date" value={outsideFilters.from} onChange={(e) => setOutsideFilters({ ...outsideFilters, from: e.target.value })} className="p-2 border rounded text-xs" />
                        <input type="date" value={outsideFilters.to} onChange={(e) => setOutsideFilters({ ...outsideFilters, to: e.target.value })} className="p-2 border rounded text-xs" />
                        <button onClick={fetchOutsideActivity} className="bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold py-2">🔍 Filter</button>
                      </div>
                      <label className="mt-3 flex items-center gap-2 text-[11px] font-bold text-slate-600 cursor-pointer">
                        <input type="checkbox" checked={outsideFilters.includeAdmin} onChange={(e) => setOutsideFilters({ ...outsideFilters, includeAdmin: e.target.checked })} />
                        👑 Also show Admin's transactions (Admin may bill without a Shift)
                      </label>
                    </div>

                    {outsideActivity.totals && (
                      <div className="grid grid-cols-3 gap-4">
                        <div className="bg-white p-4 rounded-xl border shadow-xs"><p className="text-[10px] font-bold text-gray-400 uppercase">Transaction Count</p><p className={`text-xl font-black ${outsideActivity.totals.count > 0 ? "text-red-600" : "text-emerald-600"}`}>{outsideActivity.totals.count}</p></div>
                        <div className="bg-white p-4 rounded-xl border shadow-xs"><p className="text-[10px] font-bold text-gray-400 uppercase">Cash In to Drawer (Uncounted)</p><p className="text-xl font-black text-emerald-700">Rs. {outsideActivity.totals.cashIn.toFixed(2)}</p></div>
                        <div className="bg-white p-4 rounded-xl border shadow-xs"><p className="text-[10px] font-bold text-gray-400 uppercase">Cash Out of Drawer (Uncounted)</p><p className="text-xl font-black text-red-600">Rs. {outsideActivity.totals.cashOut.toFixed(2)}</p></div>
                      </div>
                    )}

                    <div className="bg-white rounded-xl border shadow-xs overflow-hidden">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-100 text-slate-700 font-bold border-b">
                            <th className="p-3">Time</th>
                            <th className="p-3">Cashier</th>
                            <th className="p-3">Type</th>
                            <th className="p-3">Reference</th>
                            <th className="p-3">Payment Method</th>
                            <th className="p-3 text-right">Amount</th>
                            <th className="p-3 text-right">Cash Impact</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 font-medium">
                          {isLoadingOutside && (
                            <tr><td colSpan="7" className="p-6 text-center text-gray-400">Loading...</td></tr>
                          )}
                          {!isLoadingOutside && outsideActivity.items.length === 0 && (
                            <tr><td colSpan="7" className="p-6 text-center text-emerald-600 font-bold">✅ No transactions without a Shift found</td></tr>
                          )}
                          {!isLoadingOutside && outsideActivity.items.map((r, i) => (
                            <tr key={`${r.type}-${r.ref}-${r.at}-${i}`} className="hover:bg-red-50/40">
                              <td className="p-3 text-gray-500">{new Date(r.at).toLocaleString()}</td>
                              <td className="p-3 font-bold text-slate-900">{r.cashier}{r.isAdmin && <span className="ml-1.5 text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-800 text-white">👑 ADMIN</span>}</td>
                              <td className="p-3">
                                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${r.type === "Sale" ? "bg-blue-100 text-blue-700" : r.type === "Return" ? "bg-amber-100 text-amber-700" : r.type === "CreditPayment" ? "bg-emerald-100 text-emerald-700" : "bg-purple-100 text-purple-700"}`}>{r.typeLabel}</span>
                                {r.status === "Voided" && <span className="ml-1 text-[10px] font-black text-gray-500">VOIDED</span>}
                              </td>
                              <td className="p-3 font-mono text-slate-700">{r.ref}</td>
                              <td className="p-3">{r.method}</td>
                              <td className="p-3 text-right font-bold">Rs. {r.amount.toFixed(2)}</td>
                              <td className={`p-3 text-right font-black ${r.cashImpact > 0 ? "text-emerald-700" : r.cashImpact < 0 ? "text-red-600" : "text-gray-300"}`}>
                                {r.cashImpact > 0 ? `+ Rs. ${r.cashImpact.toFixed(2)}` : r.cashImpact < 0 ? `− Rs. ${Math.abs(r.cashImpact).toFixed(2)}` : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {outsideActivity.truncated && <p className="p-3 text-[11px] text-amber-700 bg-amber-50 border-t">⚠️ Showing only 500 transactions - narrow the time range with the Filter.</p>}
                    </div>
                  </div>
                )}

                {adminSubTab === "shiftHistory" && (
                  <div className="p-6 space-y-4">
                    <div className="bg-white p-4 rounded-xl border shadow-xs">
                      <h3 className="text-xs font-black uppercase text-slate-800 mb-3">🧾 Shift History (Cash Drawer Reconciliation)</h3>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                        <select
                          value={shiftHistoryFilters.cashier}
                          onChange={(e) => setShiftHistoryFilters({ ...shiftHistoryFilters, cashier: e.target.value })}
                          className="p-2 border rounded text-xs bg-gray-50 font-bold text-gray-700"
                        >
                          <option value="">All Cashiers</option>
                          {staffUsers.map(u => <option key={u._id} value={u.username}>{u.username}</option>)}
                        </select>
                        <input type="date" value={shiftHistoryFilters.from} onChange={(e) => setShiftHistoryFilters({ ...shiftHistoryFilters, from: e.target.value })} className="p-2 border rounded text-xs" />
                        <input type="date" value={shiftHistoryFilters.to} onChange={(e) => setShiftHistoryFilters({ ...shiftHistoryFilters, to: e.target.value })} className="p-2 border rounded text-xs" />
                        <button onClick={fetchShiftHistory} className="bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold py-2">🔍 Filter</button>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border shadow-xs overflow-hidden">
                      <p className="px-4 py-2 text-[11px] font-bold text-slate-600 bg-slate-50 border-b">
                        Expected = Opening Float + Cash Sales (including the paid portion of credit bills) − Cash Refunds + Credit Payments (Cash) − Supplier Payments (Cash). "Credit Given" is not included in the calculation.
                      </p>
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-100 text-slate-700 font-bold border-b">
                            <th className="p-3">Cashier</th>
                            <th className="p-3">Opened</th>
                            <th className="p-3">Closed</th>
                            <th className="p-3 text-right">Opening Float</th>
                            <th className="p-3 text-right" title="Cash bills + paid portion of credit bills">+ Cash Sales</th>
                            <th className="p-3 text-right">− Cash Refunds</th>
                            <th className="p-3 text-right">+ Credit Payments (Cash)</th>
                            <th className="p-3 text-right">− Supplier Payments (Cash)</th>
                            <th className="p-3 text-right text-amber-700" title="Amount given on credit (net of credit Returns) - not part of Expected Cash (Info)">Credit Given (Net, Info)</th>
                            <th className="p-3 text-right">= Expected</th>
                            <th className="p-3 text-right">Counted</th>
                            <th className="p-3 text-center">Over/Short</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 font-medium">
                          {isLoadingShiftHistory && (
                            <tr><td colSpan="12" className="p-6 text-center text-gray-400">Loading...</td></tr>
                          )}
                          {!isLoadingShiftHistory && shiftHistory.length === 0 && (
                            <tr><td colSpan="12" className="p-6 text-center text-gray-400">No Shift records found</td></tr>
                          )}
                          {!isLoadingShiftHistory && shiftHistory.map((s) => (
                            <tr key={s._id} className="hover:bg-blue-50/40">
                              <td className="p-3 font-bold text-slate-900">{s.cashier}</td>
                              <td className="p-3 text-gray-500">{new Date(s.openedAt).toLocaleString()}</td>
                              <td className="p-3 text-gray-500">
                                {s.status === "open" ? (
                                  <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">🟢 Open</span>
                                ) : new Date(s.closedAt).toLocaleString()}
                              </td>
                              <td className="p-3 text-right">Rs. {s.openingFloat?.toFixed(2)}</td>
                              <td className="p-3 text-right text-emerald-700 font-bold">+ Rs. {(s.cashSales || 0).toFixed(2)}</td>
                              <td className="p-3 text-right text-red-600 font-bold">− Rs. {(s.cashRefunds || 0).toFixed(2)}</td>
                              <td className="p-3 text-right text-emerald-700 font-bold">{`+ Rs. ${(s.creditPaymentsCashIn || 0).toFixed(2)}`}</td>
                              <td className="p-3 text-right text-red-600 font-bold">{`− Rs. ${(s.supplierPaymentsCashOut || 0).toFixed(2)}`}</td>
                              <td className="p-3 text-right text-amber-700 font-bold">{`Rs. ${(s.creditGiven || 0).toFixed(2)}`}{(s.creditBillCount > 0 || s.creditReturned > 0) && <span className="block text-[9px] font-medium text-amber-600">Bills {s.creditBillCount || 0}: Rs.{(s.creditGivenGross || 0).toFixed(2)}{s.creditReturned > 0 ? ` − Return Rs.${s.creditReturned.toFixed(2)}` : ""}</span>}</td>
                              <td className="p-3 text-right font-bold">{`Rs. ${(s.expectedCash || 0).toFixed(2)}`}{s.isLive && <span className="ml-1 text-[9px] font-black text-emerald-600">LIVE</span>}</td>
                              <td className="p-3 text-right font-bold">{s.status === "closed" ? `Rs. ${s.closingCountedCash?.toFixed(2)}` : "-"}</td>
                              <td className="p-3 text-center">
                                {s.status === "closed" ? (
                                  <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                                    s.overShort === 0 ? "bg-emerald-100 text-emerald-700" :
                                    s.overShort > 0 ? "bg-blue-100 text-blue-700" :
                                    "bg-red-100 text-red-700"
                                  }`}>
                                    {s.overShort === 0 ? "Exact" : s.overShort > 0 ? `+Rs.${s.overShort.toFixed(2)}` : `-Rs.${Math.abs(s.overShort).toFixed(2)}`}
                                  </span>
                                ) : "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 🆕 GRN Detail Modal (click a row in GRN History) */}
                {viewGrnDetails && (
                  <div
                    className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
                    onClick={() => setViewGrnDetails(null)}
                  >
                    <div
                      className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col relative"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="p-4 border-b bg-slate-900 text-white rounded-t-xl flex justify-between items-start">
                        <div>
                          <h3 className="text-sm font-black flex items-center gap-1.5">📦 {viewGrnDetails.grnNo}</h3>
                          <p className="text-[11px] text-gray-300 mt-0.5">{viewGrnDetails.supplierName} • {new Date(viewGrnDetails.date).toLocaleString()}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => handlePrintGrn(viewGrnDetails)} className="bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded text-[10px] font-bold">🖨️ Print</button>
                          <button onClick={() => setViewGrnDetails(null)} className="text-gray-300 hover:text-white font-black text-lg leading-none">✕</button>
                        </div>
                      </div>

                      {viewGrnDetails.hasDiscrepancy && (
                        <div className="p-3 bg-red-50 border-b border-red-100 text-[11px] font-bold text-red-700">
                          ⚠️ There is a difference (Discrepancy) between Ordered Qty and Received Qty in this GRN — see the highlighted items in the list below.
                        </div>
                      )}
                      {viewGrnDetails.supplierInvoiceRef && (
                        <div className="px-4 pt-3 text-[11px] text-gray-600"><b>Supplier Invoice Ref:</b> {viewGrnDetails.supplierInvoiceRef}</div>
                      )}
                      {viewGrnDetails.receivedBy && (
                        <div className="px-4 pt-1 text-[11px] text-gray-600"><b>Received By:</b> {viewGrnDetails.receivedBy}</div>
                      )}

                      <div className="flex-1 overflow-y-auto p-4 space-y-2">
                        {viewGrnDetails.items.map((item, index) => (
                          <div key={index} className={`p-2.5 rounded-lg border text-xs ${item.hasDiscrepancy ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200"}`}>
                            <div className="flex justify-between items-start">
                              <p className="font-bold text-slate-800">{item.productName}</p>
                              <span className="font-black text-amber-700">Rs. {item.subtotal?.toFixed(2)}</span>
                            </div>
                            <p className="text-[10px] text-gray-500 mt-0.5">
                              {item.orderedQty > 0 ? `${formatQtyWithUnit(item.orderedQty, item.unit)} Ordered → ` : ""}
                              {formatQtyWithUnit(item.receivedQty, item.unit)} Received × Rs.{item.costPrice?.toFixed(2)}
                              {item.expiryDate ? ` • Exp: ${new Date(item.expiryDate).toLocaleDateString()}` : ""}
                            </p>
                          </div>
                        ))}
                      </div>

                      <div className="p-4 border-t bg-amber-50 flex justify-between items-center rounded-b-xl">
                        <span className="text-xs font-bold text-amber-800">Grand Total:</span>
                        <span className="text-base font-black text-amber-900">Rs. {viewGrnDetails.grandTotal?.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* 🛠️ NEW: Supplier Details Modal - Full Purchase/Payment Ledger History */}
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
                        <span className="text-xs font-bold text-red-700">Current Amount We Owe (Balance Due):</span>
                        <span className="text-lg font-black text-red-700">Rs. {viewSupplierDetails.balanceDue?.toFixed(2) || "0.00"}</span>
                      </div>

                      {/* Ledger History (newest first) */}
                      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                        <h4 className="text-[10px] font-black uppercase text-gray-400 mb-1">Transaction History</h4>

                        {/* 🆕 CASHBACK SUMMARY: show at a glance, at the very top, how much cashback (overpaid by us, then refunded
                            back to us) we currently have from this supplier */}
                        {(() => {
                          const totalCashback = (viewSupplierDetails.ledger || []).reduce((sum, e) => sum + (e.changeGiven || 0), 0);
                          if (totalCashback <= 0) return null;
                          return (
                            <div className="p-2.5 rounded-lg bg-orange-50 border border-orange-200 flex justify-between items-center mb-2">
                              <span className="text-[11px] font-bold text-orange-700">🔄 Total Cashback (overpaid amount returned to us):</span>
                              <span className="text-sm font-black text-orange-700">Rs. {totalCashback.toFixed(2)}</span>
                            </div>
                          );
                        })()}

                        {(!viewSupplierDetails.ledger || viewSupplierDetails.ledger.length === 0) && (
                          <p className="text-xs text-gray-400 text-center py-8">No transactions recorded yet</p>
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
                                    {entry.type === "purchase" ? "📦 Stock Received" : "💵 Payment"}
                                  </span>
                                  <p className="text-[10px] text-gray-500 mt-1">{new Date(entry.date).toLocaleString()}</p>
                                </div>
                                <span className={`text-sm font-black ${entry.type === "purchase" ? "text-amber-800" : "text-emerald-700"}`}>
                                  {entry.type === "purchase" ? "+" : "-"} Rs. {entry.amount?.toFixed(2)}
                                </span>
                              </div>

                              {entry.description && (
                                <p className="text-[11px] text-gray-600 mt-1.5 italic">{entry.description}</p>
                              )}

                              {/* 🆕 CASHBACK BADGE */}
                              {entry.changeGiven > 0 && (
                                <div className="mt-2 px-2 py-1.5 rounded bg-orange-100 border border-orange-300 flex justify-between items-center">
                                  <span className="text-[10px] font-bold text-orange-800">🔄 Amount Returned (Cashback)</span>
                                  <span className="text-[12px] font-black text-orange-800">Rs. {entry.changeGiven.toFixed(2)}</span>
                                </div>
                              )}

                              {/* Purchase items breakdown */}
                              {entry.items && entry.items.length > 0 && (
                                <div className="mt-2 bg-white/70 rounded border border-amber-100 divide-y divide-amber-100">
                                  {entry.items.map((it, i) => (
                                    <div key={i} className="flex justify-between px-2 py-1 text-[10px]">
                                      <span className="text-gray-700 font-medium">
                                        {it.productName} <span className="text-gray-400">({it.quantity} × Rs.{it.costPrice?.toFixed(2)})</span>
                                        {it.stockMode === "set" && <span className="ml-1 text-[8px] bg-purple-100 text-purple-700 px-1 rounded-full font-black">SET</span>}
                                      </span>
                                      <span className="font-bold text-gray-800">Rs.{it.subtotal?.toFixed(2)}</span>
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
        <span className="text-xs font-bold text-red-700">Total Outstanding Credit:</span>
        <span className="text-lg font-black text-red-700">Rs. {activeCustomerDetails.creditBalance?.toFixed(2) || "0.00"}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        <h4 className="text-[10px] font-black uppercase text-gray-400 mb-1">Credit History</h4>

        {/* 🆕 CASHBACK SUMMARY: show how much cashback (overpayment) has been returned to this customer so far,
            right at the top - no need to dig through the description text */}
        {(() => {
          const totalCashback = (activeCustomerDetails.creditHistory || []).reduce((sum, e) => sum + (e.changeGiven || 0), 0);
          if (totalCashback <= 0) return null;
          return (
            <div className="p-2.5 rounded-lg bg-orange-50 border border-orange-200 flex justify-between items-center mb-2">
              <span className="text-[11px] font-bold text-orange-700">🔄 Total Cashback (overpaid beyond credit, amount returned):</span>
              <span className="text-sm font-black text-orange-700">Rs. {totalCashback.toFixed(2)}</span>
            </div>
          );
        })()}

        {(!activeCustomerDetails.creditHistory || activeCustomerDetails.creditHistory.length === 0) && (
          <p className="text-xs text-gray-400 text-center py-8">No credit transactions recorded yet</p>
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
                      {isCreditGiven ? "📕 Credit Taken" : "💵 Payment / Adjustment"}
                    </span>
                    <p className="text-[10px] text-gray-500 mt-1">{new Date(entry.date).toLocaleString()}</p>
                  </div>
                  <span className={`text-sm font-black ${isCreditGiven ? "text-red-700" : "text-emerald-700"}`}>
                    {isCreditGiven ? "+" : "-"} Rs. {Math.abs(entry.amount).toFixed(2)}
                  </span>
                </div>
                {entry.description && <p className="text-[11px] text-gray-600 mt-1.5 italic">{entry.description}</p>}

                {/* 🆕 CASHBACK BADGE: shows the cashback amount not just as small italic text in the description,
                    but as a clearly highlighted badge */}
                {entry.changeGiven > 0 && (
                  <div className="mt-2 px-2 py-1.5 rounded bg-orange-100 border border-orange-300 flex justify-between items-center">
                    <span className="text-[10px] font-bold text-orange-800">🔄 Amount Returned (Cashback)</span>
                    <span className="text-[12px] font-black text-orange-800">Rs. {entry.changeGiven.toFixed(2)}</span>
                  </div>
                )}
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
                      <div className="bg-white p-4 rounded-xl border shadow-xs"><p className="text-[10px] font-bold text-gray-400 uppercase">Total Bill Count</p><p className="text-xl font-black text-slate-900">{salesSummary.totalSalesCount}</p></div>
                      <div className="bg-white p-4 rounded-xl border shadow-xs"><p className="text-[10px] font-bold text-gray-400 uppercase">Total Gross Revenue</p><p className="text-xl font-black text-blue-600">Rs. {salesSummary.totalRevenue?.toFixed(2)}</p></div>
                      <div className="bg-white p-4 rounded-xl border shadow-xs"><p className="text-[10px] font-bold text-gray-400 uppercase">Total Net Profit</p><p className="text-xl font-black text-emerald-600">Rs. {salesSummary.totalProfit?.toFixed(2)}</p></div>
                      <div className="bg-white p-4 rounded-xl border shadow-xs"><p className="text-[10px] font-bold text-gray-400 uppercase">Total Credit in Ledger</p><p className="text-xl font-black text-red-600">Rs. {salesSummary.breakdown?.creditSales?.toFixed(2)}</p></div>
                    </div>

                    {/* Sales History Log Table */}
                    <div className="bg-white rounded-xl border shadow-xs overflow-hidden">
                      <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
                        <h3 className="text-xs font-black uppercase text-slate-800">📊 Daily Sales History (Sales Logs)</h3>
                        <div className="flex items-center gap-3">
                          {/* 🆕 Voided sales stay chronological (not moved to the bottom) — this toggle
                              hides them by default so they don't clutter day-to-day scanning, but keeps
                              them one click away, in their correct time order, for the audit trail. */}
                          <label className="flex items-center gap-1.5 text-[11px] font-bold text-gray-600 cursor-pointer select-none">
                            <input type="checkbox" checked={showVoidedSales} onChange={(e) => setShowVoidedSales(e.target.checked)} className="accent-blue-600" />
                            Show Voided bills
                          </label>
                          {salesSummary.sales?.length > 0 && (
                            <button onClick={handleClearAllSales} className="bg-red-50 hover:bg-red-600 text-red-600 hover:text-white border border-red-200 px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all">🧹 Clear All</button>
                          )}
                        </div>
                      </div>
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-100 text-slate-700 font-bold border-b">
                            <th className="p-3">Invoice No</th>
                            <th className="p-3">Date and Time</th>
                            <th className="p-3">Cashier</th>
                            <th className="p-3">Payment Method</th>
                            <th className="p-3 text-right">Bill Amount</th>
                            <th className="p-3 text-right">Profit Earned</th>
                            <th className="p-3 text-center">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 font-medium">
                          {salesSummary.sales?.filter((sale) => showVoidedSales || sale.status !== "Voided").map((sale) => {
                            const isVoided = sale.status === "Voided"; // 🛠️ FIX: was rendered identically to a normal sale before
                            return (
                            <tr key={sale._id} className={`hover:bg-slate-50/80 ${isVoided ? "bg-gray-50 opacity-60" : ""}`}>
                              <td className="p-3 font-mono font-bold text-slate-700">{sale.invoiceNo || `#${sale._id.slice(-8).toUpperCase()}`}</td>
                              <td className="p-3 text-gray-500">{new Date(sale.createdAt).toLocaleString()}</td>
                              <td className="p-3 font-bold">{sale.cashier || "Cashier"}</td>
                              <td className="p-3">
                                {isVoided ? (
                                  <span className="px-2 py-0.5 rounded-sm font-bold text-[10px] bg-gray-200 text-gray-600">🚫 VOIDED</span>
                                ) : (
                                  <span className={`px-2 py-0.5 rounded-sm font-bold text-[10px] ${sale.paymentMethod === 'Cash' ? 'bg-emerald-100 text-emerald-700' : sale.paymentMethod === 'Credit' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{sale.paymentMethod}</span>
                                )}
                              </td>
                              <td className={`p-3 text-right font-black ${isVoided ? "text-gray-400 line-through" : "text-slate-900"}`}>Rs. {sale.totalAmount.toFixed(2)}</td>
                              <td className={`p-3 text-right ${isVoided ? "text-gray-400 line-through" : "text-emerald-600"}`}>Rs. {sale.totalProfit.toFixed(2)}</td>
                              <td className="p-3 text-center">
                                {isVoided ? (
                                  <span className="text-[10px] text-gray-400 font-bold">— No actions —</span>
                                ) : (
                                  <>
                                    <button onClick={() => { const ref = sale.invoiceNo || sale._id; setReturnInvoiceSearch(ref); setActiveTab("returns"); handleSearchInvoiceForReturn(null, ref); }} className="bg-amber-100 hover:bg-amber-600 text-amber-700 hover:text-white px-2 py-1 rounded text-[10px] font-bold transition-all mr-1">🔄 Return</button>
                                    <button onClick={() => handleVoidSale(sale._id)} className="bg-red-100 hover:bg-red-600 text-red-600 hover:text-white px-2 py-1 rounded text-[10px] font-bold transition-all">VOID ✕</button>
                                  </>
                                )}
                              </td>
                            </tr>
                          );})}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 🆕 ADMIN: Cashier/Staff Account Management - create accounts without needing Postman/curl */}
                {adminSubTab === "staff" && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Create Account Form */}
                    <div className="bg-white p-5 rounded-xl border shadow-xs h-fit">
                      <h3 className="text-xs font-black uppercase text-slate-800 mb-4">➕ Create Account</h3>
                      <form onSubmit={handleCreateUserSubmit} className="space-y-4">
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">Username:</label>
                          <input
                            type="text"
                            required
                            autoComplete="off"
                            value={newUserForm.username}
                            onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                            className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white"
                            
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">Password: <span className="text-gray-400 font-normal">(Min 8 characters)</span></label>
                          <input
                            type="password"
                            required
                            minLength={8}
                            autoComplete="new-password"
                            value={newUserForm.password}
                            onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                            className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white"
                            
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-gray-600 block mb-1">Role:</label>
                          <select
                            value={newUserForm.role}
                            onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value })}
                            className="w-full p-2 border rounded text-xs bg-gray-50 focus:bg-white font-bold"
                          >
                            <option value="cashier">Cashier</option>
                            <option value="admin">Admin</option>
                          </select>
                        </div>
                        <button type="submit" disabled={isCreatingUser} className="w-full bg-blue-600 disabled:opacity-50 text-white py-2 rounded text-xs font-bold shadow-md">
                          {isCreatingUser ? "Creating..." : "Create Account"}
                        </button>
                      </form>
                    </div>

                    {/* Staff Accounts List */}
                    <div className="lg:col-span-2 bg-white rounded-xl border shadow-xs overflow-hidden h-fit">
                      <div className="p-4 border-b bg-gray-50">
                        <h3 className="text-xs font-black uppercase text-slate-800">👤 Active Accounts</h3>
                      </div>
                      {staffUsers.length === 0 ? (
                        <div className="p-6 text-center text-gray-400 text-xs">Account not connected yet</div>
                      ) : (
                        <div className="divide-y divide-gray-100">
                          {staffUsers.map((u) => (
                            <div key={u._id} className="flex justify-between items-center px-4 py-3">
                              <div>
                                <p className="text-xs font-bold text-slate-800">
                                  {u.username}
                                  {u.username === user.username && <span className="ml-1.5 text-[9px] text-gray-400 font-normal">(you)</span>}
                                </p>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-black ${u.role === "admin" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>{u.role === "admin" ? "ADMIN" : "CASHIER"}</span>
                              </div>
                              {u.username !== user.username && (
                                <button onClick={() => handleDeleteUser(u._id, u.username)} className="bg-red-100 hover:bg-red-600 text-red-600 hover:text-white px-2 py-1 rounded text-[10px] font-bold shrink-0">🗑️ Delete</button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 🖨️ INVOICE PRINT LAYOUT */}
      {/* 🆕 ON-DEMAND PRINTING: instead of reading the cart live at checkout time, lastCompletedSale
          snapshot is rendered as-is - so when the cashier clicks "Print", even if the cart has already
          been reset (even if a new bill has been started), the receipt still shows correctly. */}
      {lastCompletedSale && (
      <div className="hidden print:block p-4 w-[80mm] text-black font-mono text-xs bg-white">
        {/* 🆕 SPEED/ACCURACY FIX: There was no @page rule before - so although the content was designed for 80mm width,
            the browser print dialog treated the paper size as the default A4/Letter
            anyway. When printing on a real 80mm thermal roll printer, a lot of blank
            paper is fed after each receipt (and the auto-cutter also cuts in the wrong place). This @page rule
            tells the printer driver "page size is 80mm wide, height auto (to fit the content)" -
            This applies if you select "80mm Roll" / "Custom" in the Paper Size dropdown of the Print Preview in Chrome/Edge.
            margin: 0 is set because the thermal printer driver itself handles the constraints (print head reach) - CSS
            adding an extra margin only wastes more paper. */}
        <style>{`@page { size: 80mm auto; margin: 0; }`}</style>
        <div className="text-center font-bold text-sm">--- SmartStore ---</div>
        <div className="text-center text-[9px] text-gray-700">No. 123/A, Kandy Road, Kadawatha</div>
        <div className="text-center text-[9px] text-gray-700">071-2683025 / 078-1533835</div>
        <hr className="border-dotted border-black my-2" />
        <div className="text-[9px] space-y-0.5">
          
          <div className="grid grid-cols-[65px_1fr]">
            <span className="font-bold">බිල්ප​ත් අංකය</span>
            <span>: {lastCompletedSale.invoiceNo || "N/A"}</span>
          </div>

          <div className="grid grid-cols-[65px_1fr]">
            <span className="font-bold">අයකැමි</span>
            <span>: {lastCompletedSale.cashierName}</span>
          </div>

          <div className="grid grid-cols-[65px_1fr]">
            <span className="font-bold">දිනය</span>
            <span>
              : {new Date(lastCompletedSale.date).toLocaleDateString()} {new Date(lastCompletedSale.date).toLocaleTimeString()}
            </span>
          </div>

          {/* 🆕 If a Credit customer, the name; otherwise "Cash Customer" - fallback, in the Bills Queue
              old entries saved in localStorage before this update have no customerLabel */}
          <div className="grid grid-cols-[65px_1fr]">
            <span className="font-bold">පාරිභෝගිකයා</span>
            <span>: {lastCompletedSale.customerLabel || "Cash Customer"}</span>
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
          {lastCompletedSale.items.map((item, index) => {
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
          {lastCompletedSale.appliedBillDiscount && (
            <>
              <div className="flex justify-between text-gray-600">
                <span>උප එකතුව (Subtotal)</span>
                <span>රු. {lastCompletedSale.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>{lastCompletedSale.appliedBillDiscount.name} ({lastCompletedSale.appliedBillDiscount.percent}%)</span>
                <span>- රු. {lastCompletedSale.billDiscountAmount.toFixed(2)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between font-bold text-sm">
            <span>මුළු එකතුව</span>
            <span className="border-b-4 border-double border-t pt-1 pb-1">රු. {lastCompletedSale.total.toFixed(2)}</span>
          </div>
         
          
          {lastCompletedSale.paymentMethod === "Credit" && (
            <div className="text-gray-700 flex justify-between border-b border-dotted pb-1 pt-1">
            <span>ගෙවූ මුදල (Amount Paid)</span>
            <span className="font-bold">
              රු. {lastCompletedSale.amountPaid.toFixed(2)}
            </span>
          </div>
          )}
          
          
          {lastCompletedSale.paymentMethod === "Credit" && (
            <div className="flex justify-between  font-bold border-b border-dotted pt-1 pb-1">
              <span className="text-red-600">ගෙවීමට ඇති මුද​ල (Credit Amount)</span>
              <span className="text-red-600">රු. {(lastCompletedSale.total - lastCompletedSale.amountPaid).toFixed(2)}</span>
            </div>
          )}

          {lastCompletedSale.paymentMethod === "Cash" && (
            <>
              <div className="flex justify-between border-b border-dotted pb-1 pt-1 font-bold text-gray-700"><span>ලැබුණු මුදල (Cash):</span><span>රු. {lastCompletedSale.cashReceived.toFixed(2)}</span></div>
              <div className="flex justify-between border-b border-dotted pb-1 font-bold text-slate-900"><span>ඉතිරි මුදල (Balance):</span><span>රු. {lastCompletedSale.balanceAmount.toFixed(2)}</span></div>
            </>
          )}

          <div className="text-gray-700 text-[9px] flex justify-between border-b border-dotted pb-1 pt-1">
            <span>මුළු භාණ්ඩ ගණ​න (No. of Items)</span>
            <span>
              {lastCompletedSale.items.length}
            </span>
          </div>

        </div>

        {/* TOTAL SAVINGS BOX */}
        {/* 🔐 FIX: the calculated value is rounded to cents and then checked against 0 - floating-point
            arithmetic (many subtract/multiply steps like 19.99 - 19.99), a value that should really be 0
            might remain as an "almost zero" value like 0.00000000003, and "Savings Rs.0.00" could
            be printed by mistake - rounding correctly brings that noise to 0. */}
        {(() => {
          const rawSavings = lastCompletedSale.items.reduce((sum, item) => {
            const discP = parseFloat(item.discountPercent || item.discount) || 0;
            const marketP = parseFloat(item.marketPrice || item.price);
            const priceP = parseFloat(item.price);
            const totalSavedPerItem = (marketP - priceP) + ((priceP * discP) / 100);
            return sum + (totalSavedPerItem * parseFloat(item.qty || 0));
          }, 0);
          const totalSavings = Math.round(rawSavings * 100) / 100;

          if (totalSavings <= 0) return null; // the whole section is not printed if the value is 0 or less

          return (
            <div className="mt-3 p-1.5 border border-black border-dashed text-center bg-slate-50">
              <div className="font-bold text-[10px]">ඔබට ලැබුණු මුළු ලාභය</div>
              <div className="font-black text-xs mt-0.5">Rs.{totalSavings.toFixed(2)}</div>
            </div>
          );
        })()}

        
        <div className="text-center font-bold text-[10px] mt-2 uppercase tracking-wider">ස්තූතියි, නැවත එන්​න!!!</div>
      </div>
      )}
    </div>
  );
}

export default App;