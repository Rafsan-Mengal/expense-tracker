// ========== IndexedDB Wrapper ==========
const DB_NAME = 'ExpenseTrackerDB';
const DB_VERSION = 2;
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('transactions')) {
        const store = db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('type', 'type', { unique: false });
        store.createIndex('mode', 'mode', { unique: false });
        store.createIndex('category', 'category', { unique: false });
        store.createIndex('isSynced', 'isSynced', { unique: false });
      }
    };
    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };
    request.onerror = (event) => reject(event.target.error);
  });
}

function addTransaction(transaction) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('transactions', 'readwrite');
    const store = tx.objectStore('transactions');
    const req = store.add({ ...transaction, isSynced: transaction.isSynced || false });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllTransactions() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('transactions', 'readonly');
    const store = tx.objectStore('transactions');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getUnsyncedTransactions() {
  return getAllTransactions().then(all => all.filter(t => !t.isSynced));
}

function markTransactionSynced(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('transactions', 'readwrite');
    const store = tx.objectStore('transactions');
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const data = getReq.result;
      if (data) {
        data.isSynced = true;
        store.put(data).onsuccess = resolve;
      } else resolve();
    };
    getReq.onerror = reject;
  });
}

function deleteTransaction(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('transactions', 'readwrite');
    const store = tx.objectStore('transactions');
    store.delete(id).onsuccess = resolve;
  });
}

// ========== Helpers ==========
function parseItemsInput(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l !== '');
  const items = [];
  for (const line of lines) {
    const parts = line.split('=').map(p => p.trim());
    if (parts.length >= 2) {
      const name = parts.slice(0, -1).join(' ').trim();
      const priceStr = parts[parts.length - 1];
      const price = parseFloat(priceStr);
      if (!isNaN(price) && price >= 0 && name) {
        items.push({ name, price });
      }
    }
  }
  return items;
}

function formatCurrency(cents) {
  return (cents / 100).toFixed(2);
}

// ========== UI ==========
const itemsInput = document.getElementById('items-input');
const liveTotalSpan = document.getElementById('live-total');
const saveBtn = document.getElementById('save-btn');
const searchInput = document.getElementById('search-input');
const filterType = document.getElementById('filter-type');
const filterMode = document.getElementById('filter-mode');
const filterCategory = document.getElementById('filter-category');
const filterDate = document.getElementById('filter-date');
const entriesContainer = document.getElementById('entries-container');

// Tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(tab.dataset.tab + '-tab').classList.add('active');
    if (tab.dataset.tab === 'preview') loadEntries();
  });
});

// Set today's date
document.getElementById('date').valueAsDate = new Date();

// Live total
itemsInput.addEventListener('input', () => {
  const total = parseItemsInput(itemsInput.value).reduce((sum, it) => sum + it.price, 0);
  liveTotalSpan.textContent = total.toFixed(2);
});

// Quick add item
document.getElementById('quick-add-btn').addEventListener('click', () => {
  const name = document.getElementById('quick-name').value.trim();
  const price = parseFloat(document.getElementById('quick-price').value);
  if (!name || isNaN(price) || price < 0) {
    alert('Enter a valid item name and price.');
    return;
  }
  const newLine = `${name} = ${price}`;
  itemsInput.value = itemsInput.value.trim() ? itemsInput.value + '\n' + newLine : newLine;
  itemsInput.dispatchEvent(new Event('input'));
  document.getElementById('quick-name').value = '';
  document.getElementById('quick-price').value = '';
});

// Save entry
saveBtn.addEventListener('click', async () => {
  const date = document.getElementById('date').value;
  const type = document.getElementById('type').value;
  const mode = document.getElementById('mode').value;
  const category = document.getElementById('category').value;
  const items = parseItemsInput(itemsInput.value);

  if (!date || items.length === 0) {
    alert('Please enter a date and at least one valid item (format: item = price)');
    return;
  }

  const totalCents = Math.round(items.reduce((sum, it) => sum + it.price, 0) * 100);
  const transaction = {
    date,
    type,
    mode,
    category,
    items: items.map(it => ({ name: it.name, price: Math.round(it.price * 100) })),
    totalAmount: totalCents,
    createdAt: Date.now(),
    isSynced: false
  };

  try {
    await addTransaction(transaction);
    alert('Saved!');
    itemsInput.value = '';
    liveTotalSpan.textContent = '0.00';
    document.getElementById('date').valueAsDate = new Date();
  } catch (err) {
    alert('Error saving: ' + err);
  }
});

// Load & filter entries
async function loadEntries() {
  const transactions = await getAllTransactions();
  const searchTerm = searchInput.value.toLowerCase();
  const fType = filterType.value;
  const fMode = filterMode.value;
  const fCategory = filterCategory.value;
  const fDate = filterDate.value;

  const filtered = transactions
    .filter(tx => {
      if (fType && tx.type !== fType) return false;
      if (fMode && tx.mode !== fMode) return false;
      if (fCategory && tx.category !== fCategory) return false;
      if (fDate && tx.date !== fDate) return false;
      if (searchTerm) {
        const itemsText = tx.items.map(it => it.name).join(' ').toLowerCase();
        if (!tx.date.includes(searchTerm) &&
            !tx.type.includes(searchTerm) &&
            !tx.mode.includes(searchTerm) &&
            !tx.category.includes(searchTerm) &&
            !itemsText.includes(searchTerm) &&
            !tx.totalAmount.toString().includes(searchTerm)) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  renderEntries(filtered);
}

function renderEntries(entries) {
  if (entries.length === 0) {
    entriesContainer.innerHTML = '<div class="no-entries">No entries found</div>';
    return;
  }
  entriesContainer.innerHTML = entries.map(tx => {
    const sign = tx.type === 'income' ? '+' : '-';
    const totalDisplay = formatCurrency(tx.totalAmount);
    const itemsDisplay = tx.items.map(it => `${it.name} ${formatCurrency(it.price)}`).join(', ');
    const syncedBadge = tx.isSynced ? ' (synced)' : '';
    return `
      <div class="entry-card">
        <div class="entry-row">
          <div>
            <strong>${tx.date}</strong> - ${tx.category} (${tx.mode})${syncedBadge}<br>
            <small>${itemsDisplay}</small>
            <div class="entry-details">Total: ${sign}${totalDisplay}</div>
          </div>
          <button class="delete-btn" data-id="${tx.id}">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = parseInt(e.target.dataset.id);
      if (confirm('Delete this entry?')) {
        await deleteTransaction(id);
        loadEntries();
      }
    });
  });
}

// Export JSON
document.getElementById('export-json-btn').addEventListener('click', async () => {
  const all = await getAllTransactions();
  const jsonStr = JSON.stringify(all, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `expenses-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// Google Sheets Sync
const SYNC_URL_KEY = 'sheets_sync_url';
function getSyncUrl() {
  let url = localStorage.getItem(SYNC_URL_KEY);
  if (!url) {
    url = prompt('Enter your Google Apps Script web app URL:');
    if (url) localStorage.setItem(SYNC_URL_KEY, url);
  }
  return url;
}

document.getElementById('sync-btn').addEventListener('click', async () => {
  const syncUrl = getSyncUrl();
  if (!syncUrl) return;
  const unsynced = await getUnsyncedTransactions();
  if (!unsynced.length) {
    document.getElementById('sync-status').textContent = 'All entries already synced.';
    return;
  }
  const payload = unsynced.map(tx => ({
    date: tx.date,
    type: tx.type,
    mode: tx.mode,
    category: tx.category,
    items: tx.items,
    totalAmount: tx.totalAmount,
    createdAt: tx.createdAt
  }));
  try {
    const res = await fetch(syncUrl, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' }
    });
    const result = await res.json();
    if (result.status === 'success') {
      for (const tx of unsynced) await markTransactionSynced(tx.id);
      document.getElementById('sync-status').textContent = `Synced ${unsynced.length} entries!`;
      loadEntries();
    } else throw new Error(result.message || 'Unknown error');
  } catch (err) {
    document.getElementById('sync-status').textContent = `Sync failed: ${err.message}`;
  }
});

// Filter listeners
[searchInput, filterType, filterMode, filterCategory, filterDate].forEach(el => {
  el.addEventListener('input', loadEntries);
  el.addEventListener('change', loadEntries);
});

// Init DB and register service worker
openDB().then(() => {
  console.log('Database ready');
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(console.error);
  }
});