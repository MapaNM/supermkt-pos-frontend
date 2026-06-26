import Dexie from 'dexie';

// 🛠️ බ්‍රවුසර් එක ඇතුලේ "PosOfflineDB" නමින් Local DB එකක් හදනවා
export const db = new Dexie('PosOfflineDB');

// Tables දෙක සහ ඒවායේ Primary Keys/Indexes සකසනවා
db.version(1).stores({
  products: '_id, name, barcode, price', 
  offlineSales: '++id, cartItems, totalAmount, createdAt, status' 
});