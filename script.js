// ========== IndexedDB ==========
const DB_NAME = 'ExpenseTrackerDB';
const DB_VERSION = 3; // bump for party field
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('transactions')) {
        const store = db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
        store.createIndex('date', 'date');
        store.createIndex('type', 'type');
        store.createIndex('mode', 'mode');
        store.createIndex('category', 'category');
        store.createIndex('party', 'party');
        store.createIndex('isSynced', 'isSynced');
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function addTransaction(tx) {
  return new Promise((resolve, reject) => {
    const t = db.transaction('transactions', 'readwrite');
    const store = t.objectStore('transactions');
    const req = store.add({ ...tx, isSynced: false });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllTransactions() {
  return new Promise((resolve, reject) => {
    const t = db.transaction('transactions', 'readonly');
    const store = t.objectStore('transactions');
    store.getAll().onsuccess = (e) => resolve(e.target.result);
  });
}

function getUnsynced() {
  return getAllTransactions().then(all => all.filter(x => !x.isSynced));
}

function markSynced(id) {
  return new Promise((resolve, reject) => {
    const t = db.transaction('transactions', 'readwrite');
    const store = t.objectStore('transactions');
    const get = store.get(id);
    get.onsuccess = () => {
      const data = get.result;
      if (data) { data.isSynced = true; store.put(data).onsuccess = resolve; }
      else resolve();
    };
    get.onerror = reject;
  });
}

function deleteTransaction(id) {
  return new Promise((resolve, reject) => {
    const t = db.transaction('transactions', 'readwrite');
    t.objectStore('transactions').delete(id).onsuccess = resolve;
  });
}

// ========== Helpers ==========
function parseItems(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  return lines.map(line => {
    const parts = line.split('=').map(p => p.trim());
    if (parts.length < 2) return null;
    const price = parseFloat(parts[parts.length-1]);
    if (isNaN(price) || price < 0) return null;
    const name = parts.slice(0, -1).join(' ').trim();
    if (!name) return null;
    return { name, price: Math.round(price*100) };
  }).filter(x => x);
}

function formatCents(c) { return (c/100).toFixed(2); }

// ========== UI Elements ==========
const itemsInput = document.getElementById('items-input');
const liveTotal = document.getElementById('live-total');
const saveBtn = document.getElementById('save-btn');
const searchInput = document.getElementById('search-input');
const filterType = document.getElementById('filter-type');
const filterMode = document.getElementById('filter-mode');
const filterCategory = document.getElementById('filter-category');
const filterParty = document.getElementById('filter-party');
const filterDate = document.getElementById('filter-date');
const entriesContainer = document.getElementById('entries-container');
const syncStatus = document.getElementById('sync-status');
const partyInput = document.getElementById('party');
const partySuggestions = document.getElementById('party-suggestions');
const cashNotes = document.getElementById('cash-notes');
const generalNote = document.getElementById('general-note');

// Tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(tab.dataset.tab+'-tab').classList.add('active');
    if (tab.dataset.tab === 'preview') loadEntries();
  });
});

// Set today
document.getElementById('date').valueAsDate = new Date();

// Live total
itemsInput.addEventListener('input', () => {
  const items = parseItems(itemsInput.value);
  const total = items.reduce((sum, it) => sum + it.price, 0);
  liveTotal.textContent = formatCents(total);
});

// Quick add
document.getElementById('quick-add-btn').addEventListener('click', () => {
  const name = document.getElementById('quick-name').value.trim();
  const price = parseFloat(document.getElementById('quick-price').value);
  if (!name || isNaN(price) || price < 0) { alert('Invalid item'); return; }
  const line = `${name} = ${price}`;
  itemsInput.value = itemsInput.value.trim() ? itemsInput.value + '\n' + line : line;
  itemsInput.dispatchEvent(new Event('input'));
  document.getElementById('quick-name').value = '';
  document.getElementById('quick-price').value = '';
});

// Save entry
saveBtn.addEventListener('click', async () => {
  const date = document.getElementById('date').value;
  const type = document.getElementById('type').value;
  const party = partyInput.value.trim();
  const mode = document.getElementById('mode').value;
  const category = document.getElementById('category').value;
  const items = parseItems(itemsInput.value);
  if (!date || items.length === 0) { alert('Date and at least one item required'); return; }

  const total = items.reduce((s, i) => s + i.price, 0);
  const notes = cashNotes.value.trim().split('\n').map(s => s.trim()).filter(s => s);
  const tx = {
    date, type, party, mode, category,
    items,
    totalAmount: total,
    cashNotes: notes,
    note: generalNote.value.trim(),
    createdAt: Date.now()
  };
  try {
    await addTransaction(tx);
    alert('Saved!');
    itemsInput.value = '';
    cashNotes.value = '';
    generalNote.value = '';
    liveTotal.textContent = '0.00';
    partyInput.value = '';
    document.getElementById('date').valueAsDate = new Date();
  } catch(e) { alert('Error: '+e); }
});

// Load & filter
async function loadEntries() {
  const all = await getAllTransactions();
  const q = searchInput.value.toLowerCase();
  const fType = filterType.value, fMode = filterMode.value, fCat = filterCategory.value;
  const fParty = filterParty.value.trim().toLowerCase();
  const fDate = filterDate.value;

  const filtered = all.filter(tx => {
    if (fType && tx.type !== fType) return false;
    if (fMode && tx.mode !== fMode) return false;
    if (fCat && tx.category !== fCat) return false;
    if (fParty && (!tx.party || !tx.party.toLowerCase().includes(fParty))) return false;
    if (fDate && tx.date !== fDate) return false;
    if (q) {
      const itemsText = tx.items.map(i => i.name+' '+formatCents(i.price)).join(' ');
      const searchStr = `${tx.date} ${tx.type} ${tx.mode} ${tx.category} ${tx.party||''} ${itemsText} ${tx.totalAmount} ${tx.note||''} ${(tx.cashNotes||[]).join(' ')}`.toLowerCase();
      if (!searchStr.includes(q)) return false;
    }
    return true;
  }).sort((a,b) => a.date < b.date ? 1 : -1);

  renderEntries(filtered);
}

function renderEntries(entries) {
  if (!entries.length) {
    entriesContainer.innerHTML = '<div class="no-entries">No entries found</div>';
    return;
  }
  entriesContainer.innerHTML = entries.map(tx => {
    const sign = tx.type === 'income' ? '+' : tx.type === 'adjustment' ? '±' : '-';
    const total = formatCents(tx.totalAmount);
    const itemsStr = tx.items.map(i => `${i.name} ${formatCents(i.price)}`).join(', ');
    const partyStr = tx.party ? ` | Party: ${tx.party}` : '';
    const notesStr = tx.cashNotes?.length ? ' | Notes: '+tx.cashNotes.join(', ') : '';
    const synced = tx.isSynced ? ' (synced)' : '';
    return `
      <div class="entry-card">
        <div class="entry-row">
          <div>
            <strong>${tx.date}</strong> - ${tx.category} (${tx.mode})${partyStr}${synced}<br>
            <small>${itemsStr}</small><br>
            <small>${tx.note||''} ${notesStr}</small>
            <div class="entry-details">Total: ${sign}${total}</div>
          </div>
          <button class="delete-btn" data-id="${tx.id}">Delete</button>
        </div>
      </div>`;
  }).join('');

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      if (confirm('Delete?')) {
        await deleteTransaction(Number(e.target.dataset.id));
        loadEntries();
      }
    });
  });
}

// Populate party suggestions
async function updatePartySuggestions() {
  const all = await getAllTransactions();
  const parties = [...new Set(all.map(tx => tx.party).filter(Boolean))];
  partySuggestions.innerHTML = parties.map(p => `<option value="${p}">`).join('');
  document.querySelectorAll('[list="party-suggestions"]').forEach(inp => {
    // already set
  });
}

// Event listeners
[searchInput, filterType, filterMode, filterCategory, filterParty, filterDate].forEach(el => {
  el.addEventListener('input', loadEntries);
  el.addEventListener('change', loadEntries);
});

// Export JSON
document.getElementById('export-json-btn').addEventListener('click', async () => {
  const all = await getAllTransactions();
  const blob = new Blob([JSON.stringify(all, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `expenses-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
});

// Import JSON
document.getElementById('import-json-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error('JSON must be an array');
    let imported = 0;
    for (const tx of data) {
      // minimal validation
      if (!tx.date || !tx.type) continue;
      await addTransaction({
        date: tx.date,
        type: tx.type,
        party: tx.party || '',
        mode: tx.mode || 'cash',
        category: tx.category || 'other',
        items: tx.items || [],
        totalAmount: tx.totalAmount || 0,
        cashNotes: tx.cashNotes || [],
        note: tx.note || '',
        createdAt: tx.createdAt || Date.now()
      });
      imported++;
    }
    alert(`Imported ${imported} entries.`);
    loadEntries();
    updatePartySuggestions();
  } catch(err) { alert('Import failed: '+err.message); }
  e.target.value = ''; // reset file input
});

// Sync
const SYNC_URL_KEY = 'sheets_sync_url';
function getSyncUrl() {
  let url = localStorage.getItem(SYNC_URL_KEY);
  if (!url) {
    url = prompt('Enter Google Apps Script web app URL:');
    if (url) localStorage.setItem(SYNC_URL_KEY, url);
  }
  return url;
}

document.getElementById('sync-btn').addEventListener('click', async () => {
  const url = getSyncUrl();
  if (!url) return;

  if (!navigator.onLine) {
    syncStatus.textContent = 'Offline – will sync later.';
    syncStatus.style.color = 'orange';
    return;
  }

  const unsynced = await getUnsynced();
  if (!unsynced.length) {
    syncStatus.textContent = 'All synced!';
    syncStatus.style.color = 'green';
    return;
  }

  const payload = unsynced.map(tx => ({
    date: tx.date,
    type: tx.type,
    mode: tx.mode,
    category: tx.category,
    party: tx.party,
    items: tx.items,
    totalAmount: tx.totalAmount,
    cashNotes: tx.cashNotes,
    note: tx.note,
    createdAt: tx.createdAt
  }));

  try {
    syncStatus.textContent = 'Syncing...';
    syncStatus.style.color = 'blue';
    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {'Content-Type':'application/json'}
    });
    const result = await res.json();
    if (result.status === 'success') {
      for (const tx of unsynced) await markSynced(tx.id);
      syncStatus.textContent = `Synced ${unsynced.length} entries.`;
      syncStatus.style.color = 'green';
      loadEntries();
    } else throw new Error(result.message || 'Unknown');
  } catch(err) {
    syncStatus.textContent = `Failed: ${err.message}`;
    syncStatus.style.color = 'red';
  }
});

// Reset Google Sheets URL
document.getElementById('reset-sync-btn').addEventListener('click', () => {
  if (confirm('Clear stored Google Sheets URL?')) {
    localStorage.removeItem(SYNC_URL_KEY);
    alert('URL cleared. Next sync will ask again.');
  }
});

// Init
openDB().then(() => {
  updatePartySuggestions();
  loadEntries();
}).catch(console.error);

// Update party suggestions when entering data (optional)
partyInput.addEventListener('input', async () => {
  // could filter suggestions, but just using datalist
});
