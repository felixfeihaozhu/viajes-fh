import { db, auth, ref, set, onValue, get, onAuthStateChanged } from "./core/firebase-config.js";
import { t, setLanguage, getCurrentLanguage } from "./core/i18n.js";

// --- 1. 加载配置数据 ---
let CONFIG_DATA = null;
const CONFIG_CACHE = {}; // 缓存每个模式的配置数据

// 从 Firebase 加载配置（每个模式独立配置）
async function loadConfig(mode = 'bill') {
    console.log(`📡 Loading config from Firebase for mode: ${mode}`);
    
    // 如果已经缓存，直接返回
    if (CONFIG_CACHE[mode]) {
        CONFIG_DATA = CONFIG_CACHE[mode];
        console.log(`✅ 从缓存加载配置: ${mode}`);
        return CONFIG_DATA;
    }
    
    try {
        const settingsPath = `modes/${mode}/settings`;
        const settingsRef = ref(db, settingsPath);
        const snapshot = await get(settingsRef);
        
        if (snapshot.exists()) {
            CONFIG_DATA = snapshot.val();
            console.log(`✅ 从Firebase加载配置成功: ${mode}`, CONFIG_DATA);
        } else {
            // 如果Firebase没有数据，使用默认配置
            console.log(`📝 Firebase无配置，使用默认值: ${mode}`);
            CONFIG_DATA = {
                clients: [],
                ships: [],
                routes: [],
                cabinTypes: [],
                experienceTypes: [],
                priceTypes: [],
                addonProducts: [],
                defaults: { 
                    payment: 'Bank: CAIXABANK\nName: FH GLOBAL, S.L.\nSWIFT: CAIXESBBXXX\nAccount: ES4521003304042200150167', 
                    remarks: '', 
                    adminPassword: '0901' 
                }
            };
            
            // 自动初始化Firebase配置
            await set(settingsRef, CONFIG_DATA);
            console.log(`✅ 已初始化Firebase配置: ${mode}`);
        }
        
        // 缓存配置
        CONFIG_CACHE[mode] = CONFIG_DATA;
        return CONFIG_DATA;
        
    } catch (error) {
        console.error(`❌ 加载配置失败: ${mode}`, error);
        // 返回默认配置
        CONFIG_DATA = {
            clients: [],
            ships: [],
            routes: [],
            cabinTypes: [],
            experienceTypes: [],
            priceTypes: [],
            addonProducts: [],
            defaults: { payment: '', remarks: '', adminPassword: '0901' }
        };
        return CONFIG_DATA;
    }
}

// Status Indicator
const syncDot = document.querySelector('.dot');
const syncText = document.getElementById('sync-text');

function setStatus(status, text) {
    if (syncDot) {
        syncDot.className = 'dot ' + status;
    }
    if (syncText) {
        // 使用多语言文本
        if (status === 'connected') syncText.textContent = t('syncConnected');
        else if (status === 'connecting') syncText.textContent = t('syncConnecting');
        else if (status === 'offline') syncText.textContent = t('syncOffline');
        else syncText.textContent = text;
    }
}

// --- 语言切换功能 ---
window.switchLanguage = function(lang) {
    setLanguage(lang);
    updateUILanguage();
    window.updateState(); // 重新渲染以应用语言
}

// --- 模式切换功能 ---
let currentMode = localStorage.getItem('viewMode') || 'bill'; // 'bill', 'quote', 'ticket', 或 'compare'
const MODE_MODULES = {}; // 存储模式模块实例
let draftUnsubscribe = null; // 存储当前的draft监听取消函数

// 获取当前模式的Firebase路径
function getModePath(subPath = '') {
    // 安全检查：确保 currentMode 有效
    if (!currentMode || currentMode === 'undefined' || currentMode === 'null') {
        console.error('⚠️ getModePath called with invalid currentMode:', currentMode);
        currentMode = 'bill'; // 回退到默认值
    }
    const basePath = `modes/${currentMode}`;
    const fullPath = subPath ? `${basePath}/${subPath}` : basePath;
    console.log(`🔗 getModePath: subPath=${subPath}, currentMode=${currentMode}, fullPath=${fullPath}`);
    return fullPath;
}

window.switchMode = async function(mode) {
    // 停用当前模式
    if (MODE_MODULES[currentMode]?.deactivate) {
        MODE_MODULES[currentMode].deactivate();
    }
    
    currentMode = mode;
    
    // 从Firebase加载当前模式的配置（包括所有settings数据）
    await loadConfig(mode);
    
    // 更新settings数据到window对象
    window.clients = CONFIG_DATA.clients || [];
    window.ships = CONFIG_DATA.ships || [];
    window.routes = CONFIG_DATA.routes || [];
    window.dbTypes = CONFIG_DATA.cabinTypes || [];
    window.dbExps = CONFIG_DATA.experienceTypes || [];
    window.dbPrices = CONFIG_DATA.priceTypes || [];
    window.dbAddons = CONFIG_DATA.addonProducts || [];
    
    // 重新渲染所有下拉列表
    renderClientSelect();
    renderAllDatalists();
    
    // 激活新模式
    if (MODE_MODULES[mode]?.activate) {
        MODE_MODULES[mode].activate();
    }
    
    // 更新body的模式类
    document.body.className = mode + '-mode';
    
    // 更新按钮状态
    document.getElementById('btn-mode-bill').classList.toggle('active', mode === 'bill');
    document.getElementById('btn-mode-quote').classList.toggle('active', mode === 'quote');
    document.getElementById('btn-mode-ticket').classList.toggle('active', mode === 'ticket');
    const btnCompare = document.getElementById('btn-mode-compare'); if(btnCompare) btnCompare.classList.toggle('active', mode === 'compare');
    
    // 更新页面模式类
    const paper = document.getElementById('invoice-paper');
    paper.classList.remove('quote-mode', 'ticket-mode', 'compare-mode');
    if (mode === 'quote') {
        paper.classList.add('quote-mode');
    } else if (mode === 'ticket') {
        paper.classList.add('ticket-mode');
    } else if (mode === 'compare') {
        paper.classList.add('compare-mode');
    }
    // 同步在表单侧添加模式类，便于控制显示
    const formPane = document.querySelector('.pane-form');
    if (formPane) {
        formPane.classList.remove('compare-mode');
        if (mode === 'compare') formPane.classList.add('compare-mode');
    }
    
    // 更新顶部标题
    const appTitle = document.getElementById('app-title');
    if (appTitle) {
        if (mode === 'quote') {
            appTitle.setAttribute('data-i18n', 'appTitleQuote');
            appTitle.textContent = t('appTitleQuote');
        } else if (mode === 'ticket') {
            appTitle.setAttribute('data-i18n', 'appTitleTicket');
            appTitle.textContent = t('appTitleTicket');
        } else if (mode === 'compare') {
            appTitle.setAttribute('data-i18n', 'appTitleCompare');
            appTitle.textContent = t('appTitleCompare');
        } else {
            appTitle.setAttribute('data-i18n', 'appTitle');
            appTitle.textContent = t('appTitle');
        }
    }
    
    // 更新预览区标题（账单/报价/票据/对比）
    const invoiceTitle = document.getElementById('invoice-title');
    
    if (mode === 'quote') {
        invoiceTitle.setAttribute('data-i18n', 'invoiceTitleQuote');
        invoiceTitle.textContent = t('invoiceTitleQuote');
    } else if (mode === 'ticket') {
        invoiceTitle.setAttribute('data-i18n', 'invoiceTitleTicket');
        invoiceTitle.textContent = t('invoiceTitleTicket');
    } else if (mode === 'compare') {
        invoiceTitle.setAttribute('data-i18n', 'invoiceTitleCompare');
        invoiceTitle.textContent = t('invoiceTitleCompare');
    } else {
        invoiceTitle.setAttribute('data-i18n', 'invoiceTitle');
        invoiceTitle.textContent = t('invoiceTitle');
    }
    
    // 更新浏览器标签页标题
    updateDocumentTitle();
    
    // 保存模式选择到 localStorage
    localStorage.setItem('viewMode', mode);
    
    // 重新订阅当前模式的数据
    subscribeToDraft();
    
    // 重新渲染表格
    window.updateState();
}

// 获取当前模式
window.getCurrentMode = function() {
    return currentMode;
}

// 更新浏览器标签页标题
function updateDocumentTitle() {
    const mode = currentMode;
    
    let newTitle = '';
    if (mode === 'quote') {
        newTitle = t('appTitleQuote');
    } else if (mode === 'ticket') {
        newTitle = t('appTitleTicket');
    } else if (mode === 'compare') {
        newTitle = t('appTitleCompare');
    } else {
        newTitle = t('appTitle');
    }
    
    document.title = newTitle;
}

// 初始化模式（从 localStorage 读取）
function initMode() {
    const savedMode = localStorage.getItem('viewMode') || 'bill';
    window.switchMode(savedMode);
}

function updateUILanguage() {
    // 更新body的lang属性
    const currentLang = getCurrentLanguage();
    document.body.setAttribute('lang', currentLang);
    
    // 更新所有带 data-i18n 属性的元素
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            if (el.placeholder !== undefined) el.placeholder = t(key);
        } else if (el.tagName === 'OPTION') {
            el.textContent = t(key);
        } else {
            el.textContent = t(key);
        }
    });
    
    // 更新带 data-i18n-title 的元素
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    
    // 更新浏览器标签页标题
    updateDocumentTitle();
    
    // 重新渲染项目输入框（包含多语言文本）
    if (window.items && window.items.length > 0) {
        window.renderItemInputs();
    }
}

// --- Data Variables ---
window.items = []; window.clients = []; window.ships = []; window.routes = [];
window.dbTypes = []; window.dbExps = []; window.dbPrices = []; window.dbAddons = [];

// 从配置文件获取默认值
function getDefaultPayment() {
    return CONFIG_DATA?.defaults?.payment || "Bank: CAIXABANK\nName: FH GLOBAL, S.L.\nSWIFT: CAIXESBBXXX\nAccount: ES4521003304042200150167";
}

function getDefaultRemarks() {
    return CONFIG_DATA?.defaults?.remarks || "请在账单生成后24个小时内付款。\nPlease settle the payment within 24 hours";
}

function getAdminPassword() {
    return CONFIG_DATA?.defaults?.adminPassword || "fh2025";
}

const defaultItem = { name: "", ref: "", type: "", exp: "", price: "", qty: "", base: "", tax: "", hsc: "", rate: "", extra: "", addons: [] };

// --- Helpers ---
// 扩展 utils.js 中的 clearField，添加特定字段的自动保存逻辑
const originalClearField = window.clearField;
window.clearField = function(span) {
    const box = span.closest('.input-box');
    const input = box.querySelector('input, textarea');
    input.value = '';
    box.classList.remove('has-val');
    input.focus();
    const evt = new Event('input', { bubbles: true });
    input.dispatchEvent(evt);
    // 特定字段的额外处理
    if(input.id === 'ship') window.autoSaveShip(input);
    if(input.id === 'route') window.autoSaveRoute(input);
    if(input.id === 'sailingStart' || input.id === 'sailingEnd') window.updateState();
}

// 扩展 utils.js 中的 checkClear，添加特定字段的逻辑
window.checkClear = function(input) {
    const box = input.closest('.input-box');
    if (!box) return;
    if (input.value && input.value.trim() !== '') box.classList.add('has-val');
    else box.classList.remove('has-val');
    // ship 和 route 字段不触发 updateState（由 blur 事件处理）
    if(input.id !== 'ship' && input.id !== 'route') {
        window.updateState();
    }
}

window.toggleClientDetails = function() {
  const wrapper = document.getElementById('client-details-wrapper');
  wrapper.style.display = (wrapper.style.display === 'none' || wrapper.style.display === '') ? 'block' : 'none';
}

window.togglePayment = function() {
  const wrapper = document.getElementById('payment-wrapper');
  wrapper.style.display = (wrapper.style.display === 'none' || wrapper.style.display === '') ? 'block' : 'none';
}

window.openPicker = function(pickerId) { try { document.getElementById(pickerId).showPicker(); } catch(e) { document.getElementById(pickerId).focus(); } }
window.pickDate = function(picker, textId) {
  const val = picker.value; 
  if(val) {
      const [y, m, d] = val.split('-');
      const textInput = document.getElementById(textId);
      textInput.value = `${d}/${m}/${y}`;
      window.updateState();
      window.checkClear(textInput);
  }
}

// --- DB Operations ---
window.editShip = function() { editDatabaseItem('ship', 'ships', 'shipList'); }
window.editRoute = function() { editDatabaseItem('route', 'routes', 'routeList'); }

function editDatabaseItem(inputId, configKey, listId) {
    const input = document.getElementById(inputId);
    const oldVal = input.value;
    if (!oldVal) return;
    
    const dbArray = CONFIG_DATA[configKey] || [];
    const idx = dbArray.findIndex(item => item.toLowerCase() === oldVal.toLowerCase());
    if (idx === -1) { alert("未找到该项 (Entry not found in DB)"); return; }
    
    const newVal = prompt("编辑名称 Edit Name:", dbArray[idx]);
    if (newVal && newVal.trim() !== "" && newVal !== dbArray[idx]) {
        dbArray[idx] = newVal.trim();
        CONFIG_DATA[configKey] = dbArray;
        
        // 保存到Firebase
        const settingsPath = `modes/${currentMode}/settings`;
        set(ref(db, settingsPath), CONFIG_DATA).then(() => {
            // 更新缓存和本地数据
            CONFIG_CACHE[currentMode] = CONFIG_DATA;
            if (configKey === 'ships') window.ships = dbArray;
            if (configKey === 'routes') window.routes = dbArray;
            
            input.value = newVal.trim();
            const msgId = inputId === 'ship' ? 'msg-ship' : 'msg-route';
            const msgEl = document.getElementById(msgId);
            if(msgEl) { msgEl.textContent = "✅ 已更新 Updated"; msgEl.className = "status-msg status-saved"; }
            window.updateState();
        }).catch(err => {
            console.error('❌ Failed to save:', err);
            alert('保存失败！');
        });
    }
}

window.autoSaveShip = function(input) { handleAutoSave(input, 'ships', 'shipList', 'msg-ship'); }
window.autoSaveRoute = function(input) { handleAutoSave(input, 'routes', 'routeList', 'msg-route'); }

function handleAutoSave(input, configKey, listId, msgId) {
    const val = input.value.trim();
    const msgEl = document.getElementById(msgId);
    if (!val) { msgEl.textContent = ''; return; }
    
    const dbArray = CONFIG_DATA[configKey] || [];
    const exists = dbArray.some(item => item.toLowerCase() === val.toLowerCase());
    
    if (exists) {
        msgEl.textContent = `✅ ${t('msgExisting')}`; msgEl.className = "status-msg status-exist";
    } else {
        dbArray.push(val);
        CONFIG_DATA[configKey] = dbArray;
        
        // 保存到Firebase
        const settingsPath = `modes/${currentMode}/settings`;
        set(ref(db, settingsPath), CONFIG_DATA).then(() => {
            // 更新缓存和本地数据
            CONFIG_CACHE[currentMode] = CONFIG_DATA;
            if (configKey === 'ships') window.ships = dbArray;
            if (configKey === 'routes') window.routes = dbArray;
            
            msgEl.textContent = `💾 ${t('msgSaved')}`; 
            msgEl.className = "status-msg status-saved";
        }).catch(err => {
            console.error('❌ Failed to save:', err);
            msgEl.textContent = '❌ 保存失败';
            msgEl.className = "status-msg status-error";
        });
    }
    window.updateState();
}

window.handleSmartKey = function(e, input) { if(e.key === 'Enter') input.blur(); }
window.smartComplete = function(input, db, index, key) {
  const val = input.value.trim().toLowerCase(); if(!val) { window.updateItem(index, key, ""); return; }
  const match = db.find(item => { const lower = item.toLowerCase(); return lower.startsWith(val) || lower.includes(" " + val) || lower.includes("(" + val); });
  if(match) { input.value = match; window.updateItem(index, key, match); } else window.updateItem(index, key, input.value);
  window.checkClear(input);
}

window.autoSaveItemDB = function(input, configKey, listId) {
  const val = input.value.trim();
  if(!val) return;
  
  const dbArray = CONFIG_DATA[configKey] || [];
  const exists = dbArray.some(item => item.toLowerCase() === val.toLowerCase());
  
  if(!exists) {
      dbArray.push(val);
      CONFIG_DATA[configKey] = dbArray;
      
      // 保存到Firebase
      const settingsPath = `modes/${currentMode}/settings`;
      set(ref(db, settingsPath), CONFIG_DATA).then(() => {
          CONFIG_CACHE[currentMode] = CONFIG_DATA;
          // 更新对应的window数据
          if (configKey === 'cabinTypes') window.dbTypes = dbArray;
          if (configKey === 'experienceTypes') window.dbExps = dbArray;
          if (configKey === 'priceTypes') window.dbPrices = dbArray;
          if (configKey === 'addonProducts') window.dbAddons = dbArray;
          renderAllDatalists();
      });
  }
}

window.editItemDb = function(index, field, configKey, listId) {
    const oldVal = window.items[index][field];
    if(!oldVal) return;
    
    const dbArray = CONFIG_DATA[configKey] || [];
    const dbIdx = dbArray.findIndex(item => item.toLowerCase() === oldVal.toLowerCase());
    const newVal = prompt("编辑/修改 Edit " + field + ":", oldVal);
    
    if(newVal && newVal.trim() !== "") {
        if(dbIdx !== -1) {
            dbArray[dbIdx] = newVal.trim();
            CONFIG_DATA[configKey] = dbArray;
            
            // 保存到Firebase
            const settingsPath = `modes/${currentMode}/settings`;
            set(ref(db, settingsPath), CONFIG_DATA).then(() => {
                CONFIG_CACHE[currentMode] = CONFIG_DATA;
                if (configKey === 'cabinTypes') window.dbTypes = dbArray;
                if (configKey === 'experienceTypes') window.dbExps = dbArray;
                if (configKey === 'priceTypes') window.dbPrices = dbArray;
                renderAllDatalists();
            });
        }
        window.items[index][field] = newVal.trim();
        window.renderItemInputs(); 
        window.updateState();
    }
}

window.editAddonDb = function(itemIndex, addonIndex, configKey, listId) {
    const oldVal = window.items[itemIndex].addons[addonIndex].desc;
    if(!oldVal) return;
    
    const dbArray = CONFIG_DATA[configKey] || [];
    const dbIdx = dbArray.findIndex(item => item.toLowerCase() === oldVal.toLowerCase());
    const newVal = prompt("编辑/修改 Edit Add-on Name:", oldVal);
    
    if(newVal && newVal.trim() !== "") {
        if(dbIdx !== -1) {
            dbArray[dbIdx] = newVal.trim();
            CONFIG_DATA[configKey] = dbArray;
            
            // 保存到Firebase
            const settingsPath = `modes/${currentMode}/settings`;
            set(ref(db, settingsPath), CONFIG_DATA).then(() => {
                CONFIG_CACHE[currentMode] = CONFIG_DATA;
                if (configKey === 'addonProducts') window.dbAddons = dbArray;
                renderAllDatalists();
            });
        }
        window.items[itemIndex].addons[addonIndex].desc = newVal.trim();
        window.renderItemInputs(); 
        window.updateState();
    }
}

window.smartCompleteAddon = function(input, rowIndex, addonIndex) {
  const val = input.value.trim().toLowerCase(); const dbList = window.dbAddons;
  if(!val) { window.items[rowIndex].addons[addonIndex].desc = ""; window.updateState(); return; }
  const match = dbList.find(item => { const lower = item.toLowerCase(); return lower.startsWith(val) || lower.includes(" " + val) || lower.includes("(" + val); });
  if(match) input.value = match; window.items[rowIndex].addons[addonIndex].desc = input.value; window.updateState();
  window.checkClear(input);
}

window.handleDateKey = function(e, input) { if(e.key === 'Enter') input.blur(); }
window.smartDateInput = function(input) {
  const val = input.value.trim(); if(!val) { window.updateState(); return; }
  const now = new Date(); let d, m, y;
  const parts = val.replace(/[.-]/g, '/').split('/');
  if(parts.length === 1) { d=parseInt(parts[0]); m=now.getMonth()+1; y=now.getFullYear(); }
  else if(parts.length === 2) { d=parseInt(parts[0]); m=parseInt(parts[1]); y=now.getFullYear(); }
  else if(parts.length === 3) { d=parseInt(parts[0]); m=parseInt(parts[1]); y=parseInt(parts[2]); if(y<100) y+=2000; }
  else return;
  if(isNaN(d)||isNaN(m)||isNaN(y)) return;
  input.value = `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;
  window.checkClear(input);
  window.updateState();
}
window.parseDateStr = function(str) { if(!str) return null; const parts = str.split('/'); if(parts.length !== 3) return null; return new Date(parts[2], parts[1]-1, parts[0]); }

window.printBill = function() {
    const invNo = document.getElementById('invNo').value.trim();
    const oldTitle = document.title;
    if (invNo) { document.title = `邮轮账单 ${invNo}`; } else { document.title = `邮轮账单`; }
    window.print();
    setTimeout(() => { document.title = oldTitle; }, 500);
}

window.importData = function(input) {
  const file = input.files[0]; if(!file) return;
  const reader = new FileReader(); reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if(confirm(t('confirmRestore'))) {
          // 更新CONFIG_DATA
          if(data.clients) CONFIG_DATA.clients = data.clients;
          if(data.ships) CONFIG_DATA.ships = data.ships;
          if(data.routes) CONFIG_DATA.routes = data.routes;
          if(data.dbTypes) CONFIG_DATA.cabinTypes = data.dbTypes;
          if(data.dbExps) CONFIG_DATA.experienceTypes = data.dbExps;
          if(data.dbPrices) CONFIG_DATA.priceTypes = data.dbPrices;
          if(data.dbAddons) CONFIG_DATA.addonProducts = data.dbAddons;
          
          // 保存到Firebase
          const settingsPath = `modes/${currentMode}/settings`;
          set(ref(db, settingsPath), CONFIG_DATA).then(() => {
              CONFIG_CACHE[currentMode] = CONFIG_DATA;
              // 更新本地数据
              window.clients = CONFIG_DATA.clients || [];
              window.ships = CONFIG_DATA.ships || [];
              window.routes = CONFIG_DATA.routes || [];
              window.dbTypes = CONFIG_DATA.cabinTypes || [];
              window.dbExps = CONFIG_DATA.experienceTypes || [];
              window.dbPrices = CONFIG_DATA.priceTypes || [];
              window.dbAddons = CONFIG_DATA.addonProducts || [];
              renderClientSelect();
              renderAllDatalists();
          });
          
          // 保存当前表单数据
          if(data.currentBill) {
              const draftPath = getModePath('draft');
              set(ref(db, draftPath), data.currentBill);
          }
          
          alert(t('alertRestoreSuccess'));
      }
    } catch(err) { alert(t('alertRestoreError')); }
  }; reader.readAsText(file); input.value='';
}

// --- Rendering ---
function renderAllDatalists() {
  renderDatalist('shipList', window.ships); renderDatalist('routeList', window.routes);
  renderDatalist('dl-types', window.dbTypes); renderDatalist('dl-exps', window.dbExps); 
  renderDatalist('dl-prices', window.dbPrices); renderDatalist('dl-addons', window.dbAddons);
}
function renderDatalist(id, arr) { 
    const dl = document.getElementById(id); dl.innerHTML=''; 
    (arr||[]).forEach(val => { const opt=document.createElement('option'); opt.value=val; dl.appendChild(opt); }); 
}

function renderClientSelect() {
  const sel=document.getElementById('clientSelect'); 
  sel.innerHTML=`<option value="" data-i18n="selectClient">${t('selectClient')}</option>`;
  (window.clients||[]).forEach((c,i)=>{ const label=c.tradeName?`${c.tradeName} (${c.company})`:c.company; const opt=document.createElement('option'); opt.value=i; opt.text=label; sel.appendChild(opt); });
}
window.saveClient = function() {
  console.log('💾 Saving client...');
  const company=document.getElementById('billCompany').value.trim(); 
  if(!company) return alert(t('alertMissingCompany'));
  
  const newClient={ 
    tradeName:document.getElementById('billTradeName').value, 
    company, 
    address:document.getElementById('billAddress').value, 
    rate:document.getElementById('billDefaultRate').value||0, 
    addonRate:document.getElementById('billAddonRate').value||0, 
    taxId:document.getElementById('billTaxId').value || '' 
  };
  
  const idx=window.clients.findIndex(c=>c.company===company); 
  let newClientsArr = [...window.clients];
  
  if(idx>=0){ 
    if(confirm(t('confirmUpdate'))) newClientsArr[idx]=newClient; 
    else return; 
  } else newClientsArr.push(newClient);
  
  // 保存到Firebase（更新整个settings对象）
  const settingsPath = `modes/${currentMode}/settings`;
  const settingsRef = ref(db, settingsPath);
  console.log('💾 Saving clients to:', settingsPath);
  
  // 更新CONFIG_DATA
  CONFIG_DATA.clients = newClientsArr;
  
  // 保存到Firebase
  set(settingsRef, CONFIG_DATA).then(() => {
    console.log('✅ Clients saved successfully');
    // 更新本地数据和缓存
    window.clients = newClientsArr;
    CONFIG_CACHE[currentMode] = CONFIG_DATA;
    renderClientSelect();
    alert(t('alertSaved'));
  }).catch(err => {
    console.error('❌ Failed to save clients:', err);
    alert('保存失败！');
  });
}

window.deleteClient = function() {
  const idx=document.getElementById('clientSelect').value; 
  if(idx==="") return alert(t('alertSelectClient'));
  
  const client = window.clients[idx];
  const clientName = client.tradeName || client.company;
  
  if(!confirm(`${t('alertDeleteConfirm')} "${clientName}" ?`)) return;
  
  // 密码验证
  const password = prompt(t('alertEnterPassword'));
  if(password !== getAdminPassword()) {
    alert(t('alertWrongPassword'));
    return;
  }
  
  console.log('🗑️ Deleting client:', clientName);
  
  // 删除客户
  let newClientsArr = [...window.clients];
  newClientsArr.splice(idx, 1);
  
  // 保存到Firebase（更新整个settings对象）
  const settingsPath = `modes/${currentMode}/settings`;
  const settingsRef = ref(db, settingsPath);
  console.log('💾 Saving updated clients to:', settingsPath);
  
  // 更新CONFIG_DATA
  CONFIG_DATA.clients = newClientsArr;
  
  set(settingsRef, CONFIG_DATA).then(() => {
    console.log('✅ Client deleted successfully');
    // 更新本地数据和缓存
    window.clients = newClientsArr;
    CONFIG_CACHE[currentMode] = CONFIG_DATA;
    renderClientSelect();
    document.getElementById('clientSelect').value = '';
    toggleClientDetails(); // 展开表单以便新增
    alert(t('alertDeleted'));
  }).catch(err => {
    console.error('❌ Failed to delete client:', err);
    alert('删除失败！');
  });
}

window.selectClient = function() {
  const idx=document.getElementById('clientSelect').value; if(idx==="") return;
  const c=window.clients[idx]; 
  document.getElementById('billTradeName').value=c.tradeName||''; document.getElementById('billCompany').value=c.company; document.getElementById('billAddress').value=c.address; document.getElementById('billDefaultRate').value=c.rate||0; document.getElementById('billAddonRate').value=c.addonRate||0; document.getElementById('billTaxId').value=c.taxId||'';
  ['billTradeName','billCompany','billAddress','billDefaultRate','billTaxId','billAddonRate'].forEach(id => window.checkClear(document.getElementById(id)));
  const newRate=Number(c.rate)||0; const newAddonRate=Number(c.addonRate)||0;
  if(window.items.length>0){ window.items.forEach(i=> { i.rate=newRate; if(i.addons) i.addons.forEach(a=>a.rate=newAddonRate); }); window.renderItemInputs(); }
  defaultItem.rate=newRate; window.updateState();
}

window.renderItemInputs = function() {
  const container = document.getElementById('items-container'); container.innerHTML = '';
  window.items.forEach((item, index) => {
    let addonsHtml = '';
    if(item.addons && item.addons.length > 0) {
        item.addons.forEach((ad, aIdx) => {
            addonsHtml += `
              <div class="addon-item">
                 <span style="font-size:10px; color:#0ea5e9;">↳</span>
                 <div class="addon-desc-wrapper">
                    <div class="merged-group">
                      <div class="input-box">
                          <input type="text" list="dl-addons" placeholder="${t('placeholderAddonName')}" value="${ad.desc}" onblur="smartCompleteAddon(this, ${index}, ${aIdx}); autoSaveItemDB(this, 'addonProducts', 'dl-addons')" onkeypress="handleSmartKey(event, this)" oninput="checkClear(this)">
                          <span class="clear-x" onclick="clearField(this)"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></span>
                      </div>
                      <div class="merged-trigger" onclick="editAddonDb(${index}, ${aIdx}, 'addonProducts', 'dl-addons')"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></div>
                    </div>
                 </div>
                 <div class="addon-num-wrapper"><input type="number" placeholder="${t('labelQty')}" value="${ad.qty}" oninput="updateAddon(${index}, ${aIdx}, 'qty', this.value)"></div>
                 <div class="addon-num-wrapper wide"><input type="number" placeholder="${t('labelUnit')}" value="${ad.amount}" oninput="updateAddon(${index}, ${aIdx}, 'amount', this.value)"></div>
                 <div class="addon-num-wrapper"><input type="number" placeholder="${t('labelComm')}" value="${ad.rate}" oninput="updateAddon(${index}, ${aIdx}, 'rate', this.value)" title="${t('labelComm')}"></div>
                 <div class="addon-col-del"><span style="color:#ef4444; cursor:pointer; font-size:12px;" onclick="removeAddon(${index}, ${aIdx})"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></span></div>
              </div>`;
        });
    }
    const div = document.createElement('div');
    div.style.cssText = "background:white; border:1px solid #e5e7eb; border-radius:4px; padding:10px; margin-bottom:10px;";
    div.innerHTML = `
      <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
         <span style="font-weight:700; color:#b91c1c; font-size:11px;">#${index + 1}</span>
         <div>
            <button class="btn btn-icon" onclick="copyItem(${index})"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button><button class="btn btn-icon" style="color:#dc2626" onclick="deleteItem(${index})"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button></div>
      </div>
      <div style="display:flex; gap:10px; margin-bottom:6px;">
         <div class="input-box" style="flex:1">
           <input type="text" placeholder="${t('labelPassengerName')}" value="${item.name||''}" oninput="updateItem(${index}, 'name', this.value);checkClear(this)" style="font-weight:bold;">
           <span class="clear-x" onclick="clearField(this)"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></span>
         </div>
         <div class="input-box" style="flex:1">
           <input type="text" placeholder="${t('labelLocator')}" value="${item.ref||''}" oninput="updateItem(${index}, 'ref', this.value);checkClear(this)">
           <span class="clear-x" onclick="clearField(this)"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></span>
         </div>
      </div>
      <div class="item-grid-top">
         <div class="merged-group">
            <div class="input-box"><input type="text" list="dl-types" placeholder="${t('labelCabinType')}" value="${item.type||''}" onblur="smartComplete(this, window.dbTypes, ${index}, 'type'); autoSaveItemDB(this, 'cabinTypes', 'dl-types')" onkeypress="handleSmartKey(event, this)" oninput="checkClear(this)"><span class="clear-x" onclick="clearField(this)"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></span></div>
            <div class="merged-trigger" onclick="editItemDb(${index}, 'type', 'cabinTypes', 'dl-types')"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></div>
         </div>
         <div class="merged-group">
            <div class="input-box"><input type="text" list="dl-exps" placeholder="${t('labelExpType')}" value="${item.exp||''}" onblur="smartComplete(this, window.dbExps, ${index}, 'exp'); autoSaveItemDB(this, 'experienceTypes', 'dl-exps')" onkeypress="handleSmartKey(event, this)" oninput="checkClear(this)"><span class="clear-x" onclick="clearField(this)"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></span></div>
            <div class="merged-trigger" onclick="editItemDb(${index}, 'exp', 'experienceTypes', 'dl-exps')"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></div>
         </div>
         <div class="merged-group">
            <div class="input-box"><input type="text" list="dl-prices" placeholder="${t('labelPriceType')}" value="${item.price||''}" onblur="smartComplete(this, window.dbPrices, ${index}, 'price'); autoSaveItemDB(this, 'priceTypes', 'dl-prices')" onkeypress="handleSmartKey(event, this)" oninput="checkClear(this)"><span class="clear-x" onclick="clearField(this)"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></span></div>
            <div class="merged-trigger" onclick="editItemDb(${index}, 'price', 'priceTypes', 'dl-prices')"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></div>
         </div>
      </div>
      <div class="item-grid-btm">
         <div><label>${t('labelPax')}</label><div class="input-box"><input type="number" value="${item.qty}" oninput="updateItem(${index}, 'qty', this.value)"></div></div>
         <div><label>${t('labelGross')}</label><div class="input-box"><input type="number" value="${item.base}" oninput="updateItem(${index}, 'base', this.value)"></div></div>
         <div><label>${t('labelTax')}</label><div class="input-box"><input type="number" value="${item.tax}" oninput="updateItem(${index}, 'tax', this.value)"></div></div>
         <div><label>${t('labelHsc')}</label><div class="input-box"><input type="number" value="${item.hsc}" oninput="updateItem(${index}, 'hsc', this.value)"></div></div>
         <div><label>${t('labelRate')}</label><div class="input-box"><input type="number" value="${item.rate}" oninput="updateItem(${index}, 'rate', this.value)" placeholder="比例"></div></div>
         <div><label>${t('labelExtra')}</label><div class="input-box"><input type="number" value="${item.extra}" oninput="updateItem(${index}, 'extra', this.value)" placeholder="金额"></div></div>
      </div>
      <div class="addon-row-wrap">${addonsHtml}<button class="btn btn-addon" onclick="addAddon(${index})">➡️ ${t('btnAddAddon')}</button></div>
    `;
    container.appendChild(div);
    div.querySelectorAll('.input-box input, .input-box textarea').forEach(inp => window.checkClear(inp));
  });
}

window.updateItem = function(index, key, val) { window.items[index][key] = val; window.updateState(); }
window.addAddon = function(idx) { const rate = document.getElementById('billAddonRate').value || 0; if(!window.items[idx].addons) window.items[idx].addons = []; window.items[idx].addons.push({ desc: "", amount: 0, rate: rate, qty: 1 }); window.renderItemInputs(); window.updateState(); }
window.removeAddon = function(idx, aIdx) { window.items[idx].addons.splice(aIdx, 1); window.renderItemInputs(); window.updateState(); }
window.updateAddon = function(idx, aIdx, key, val) { window.items[idx].addons[aIdx][key] = val; window.updateState(); }
window.addItem = function() { const rate = document.getElementById('billDefaultRate').value || 0; window.items.push({ ...defaultItem, rate, addons: [] }); window.renderItemInputs(); window.updateState(); }
window.deleteItem = function(i) { if(confirm(t('confirmDelete'))) { window.items.splice(i, 1); window.renderItemInputs(); window.updateState(); } }
window.copyItem = function(i) { window.items.splice(i+1, 0, JSON.parse(JSON.stringify(window.items[i]))); window.renderItemInputs(); window.updateState(); }

window.updateState = function() {
  console.log('🔄 updateState called');
  updateStateInternal();
  saveDraftDebounced();
}

// 不触发保存的版本（仅更新预览区）
window.updateStateWithoutSave = function() {
  updateStateInternal();
}

// 内部函数：更新预览区的核心逻辑
function updateStateInternal() {
  // 对比模式：只更新对比预览区，跳过账单预览区的更新
  if (currentMode === 'compare') {
    updateComparePreview();
    return;
  }
  
  // 账单/报价/票据模式：更新完整预览区
  document.querySelectorAll('[id]').forEach(el => {
    if(el.closest('.pane-form') && !el.closest('#items-container') && !['clientSelect','sailingStart','sailingEnd'].includes(el.id)) {
      const target = document.querySelector(`[data-bind="${el.id}"]`);
      if(el.id === 'billCompany') {
           const tradeNameVal = document.getElementById('billTradeName').value;
           const elPv = document.getElementById('pv-billCompany');
           if(elPv) { elPv.textContent = el.value; if(tradeNameVal && tradeNameVal.trim() !== '') elPv.classList.add('is-sub'); else elPv.classList.remove('is-sub'); }
      } else if(el.id === 'billTaxId') {
           const elPv = document.getElementById('pv-billTaxId');
           if(elPv) elPv.textContent = el.value ? `CIF/VAT: ${el.value}` : '';
      } else if(el.id === 'invDate') {
           const val = el.value; if(val) { const [y, m, d] = val.split('-'); document.getElementById('pv-invDate-formatted').textContent = `${d}/${m}/${y}`; }
      } else if(el.id === 'invNo') {
           // 编号为空时隐藏，不为空时显示
           const metaInvNo = document.getElementById('meta-invno');
           if(el.value && el.value.trim() !== '') {
               metaInvNo.style.display = '';
               if(target) target.textContent = el.value;
           } else {
               metaInvNo.style.display = 'none';
           }
      } else if (target) {
        if (target.dataset.format === 'multiline') target.innerHTML = (el.value || '').replace(/\n/g, '<br>');
        else target.textContent = el.value;
      }
    }
  });

  const sStart = document.getElementById('sailingStart').value;
  const sEnd = document.getElementById('sailingEnd').value;
  const start = window.parseDateStr(sStart), end = window.parseDateStr(sEnd);
  if(start&&end&&!isNaN(start)&&!isNaN(end)) {
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    const nights = diffDays;      // e.g. 8th - 1st = 7 nights
    const days = diffDays + 1;    // e.g. 7 nights = 8 days
    document.getElementById('pv-sailing-combined').textContent = `${sStart} ~ ${sEnd} (${days}${t('days')} ${nights}${t('nights')})`;
  } else {
    document.getElementById('pv-sailing-combined').textContent = [sStart, sEnd].filter(Boolean).join(' ~ ');
  }

  const tbody = document.getElementById('preview-items-body');
  tbody.innerHTML = '';
  let tBase=0, tTax=0, tHSC=0, tComm=0, totalGrossPrice = 0, tAddonTotal = 0;

  window.items.forEach(item => {
    const qty = Number(item.qty)||0;
    const grossPrice = Number(item.base)||0; 
    const tax = Number(item.tax)||0;
    const hsc = Number(item.hsc)||0;
    const rate = Number(item.rate)||0;
    const extra = Number(item.extra)||0; 
    
    const commBase = grossPrice - tax - hsc - extra;
    const comm = (commBase * (rate/100)) + extra;
    const net = grossPrice - comm; 
    
    tBase += commBase; tTax += tax; tHSC += hsc; tComm += comm; totalGrossPrice += grossPrice;

    const cabinDesc = [item.type, item.exp, item.price].filter(Boolean).join(' / ');
    const descParts = [item.name, item.ref, cabinDesc].filter(Boolean);
    const fullNameDesc = descParts.join(' - ');
    
    let addonsRows = '';
    if(item.addons && item.addons.length > 0) {
        item.addons.forEach(ad => {
            const aQty = Number(ad.qty) || 1;
            const unit = Number(ad.amount)||0;
            const adGross = aQty * unit; 
            const r = Number(ad.rate)||0;
            const adComm = adGross * (r/100);
            const adNet = adGross - adComm;
            
            tAddonTotal += adGross; totalGrossPrice += adGross; tComm += adComm;
            
            addonsRows += `
              <tr class="row-addon">
                  <td class="addon-desc"><div>${ad.desc || t('addonDefault')}</div></td>
                  <td class="num">${aQty}</td>
                  <td class="num">${window.formatMoney(adGross)}</td>
                  <td class="num bill-only">-</td>
                  <td class="num bill-only text-red"><div>- ${window.formatMoney(adComm)}</div></td>
                  <td class="num">-</td>
                  <td class="num">-</td>
                  <td class="num bill-only text-bold">${window.formatMoney(adNet)}</td>
              </tr>`;
        });
    }

    let commHtml = `<div class="text-red">- ${window.formatMoney(comm)}</div>`;
    if (rate > 0 || extra > 0) {
        let detailStr = `(${rate}%`; if(extra > 0) detailStr += ` + ${extra}`; detailStr += `)`;
        commHtml += `<div class="comm-detail">${detailStr}</div>`;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><div style="font-weight:600; color:#1f2937">${fullNameDesc || '-'}</div></td>
      <td class="num">${qty}</td>
      <td class="num">${window.formatMoney(grossPrice)}</td>
      <td class="num bill-only">${window.formatMoney(commBase)}</td>
      <td class="num bill-only">${commHtml}</td>
      <td class="num">${window.formatMoney(tax)}</td>
      <td class="num">${window.formatMoney(hsc)}</td>
      <td class="num bill-only text-bold">${window.formatMoney(net)}</td>
    `;
    tbody.appendChild(tr);
    if(addonsRows) tbody.insertAdjacentHTML('beforeend', addonsRows);
  });

  if(window.items.length===0) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#ccc;padding:20px;">${t('noItems')}</td></tr>`;

  const gross = totalGrossPrice; 
  const net = gross - tComm; 
  
  document.getElementById('display-total-base').textContent = window.formatMoney(tBase);
  document.getElementById('display-total-tax-hsc').textContent = window.formatMoney(tTax + tHSC);
  
  // 附加产品总价（如有才显示）
  const addonRow = document.getElementById('total-row-addon');
  if (addonRow) {
    if (tAddonTotal > 0) {
      addonRow.classList.remove('addon-hidden');
      document.getElementById('display-total-addon').textContent = window.formatMoney(tAddonTotal);
    } else {
      addonRow.classList.add('addon-hidden');
    }
  }
  
  document.getElementById('display-gross').textContent = 'EUR ' + window.formatMoney(gross); 
  document.getElementById('display-commission').textContent = '- EUR ' + window.formatMoney(tComm);
  document.getElementById('display-net').textContent = window.formatMoney(net);
  
  // 报价模式总价（直客价）
  document.getElementById('display-quote-total').textContent = window.formatMoney(gross);
  
  // 票据模式总价（支付金额和待支付金额）
  const paidAmount = 0; // 可在未来从输入框获取
  const pendingAmount = gross - paidAmount;
  document.getElementById('display-ticket-paid').textContent = window.formatMoney(paidAmount);
  document.getElementById('display-ticket-pending').textContent = window.formatMoney(pendingAmount);
}

// 对比模式专用：仅更新对比预览区
function updateComparePreview() {
  if (MODE_MODULES['compare']) {
    const compareResult = MODE_MODULES['compare'].calculate();
    if (compareResult && MODE_MODULES['compare'].updatePreview) {
      MODE_MODULES['compare'].updatePreview(compareResult);
    }
  }
}

function getFieldsData() {
  const data = {};
  document.querySelectorAll('.pane-form input:not([type=file]), .pane-form textarea').forEach(el => {
    if(el.id && !el.closest('#items-container') && !el.list && el.id!=='clientSelect') data[el.id] = el.value;
  });
  data['ship'] = document.getElementById('ship').value;
  data['route'] = document.getElementById('route').value;
  data['sailingStart'] = document.getElementById('sailingStart').value;
  data['sailingEnd'] = document.getElementById('sailingEnd').value;
  return data;
}

let saveTimeout;
let isSaving = false;
let isLoadingFromFirebase = false;
function saveDraftDebounced() {
    console.log('saveDraftDebounced called', {
        hasUser: !!auth.currentUser,
        isLoadingFromFirebase,
        currentMode
    });
    
    if(!auth.currentUser) {
        console.warn('❗ No user authenticated');
        return;
    }
    if(isLoadingFromFirebase) {
        console.log('🔄 Skipping save - loading from Firebase');
        return; // 防止在加载远程数据时触发保存
    }
    
    setStatus('connecting', '更新中...');
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        isSaving = true;
        const draftData = { items: window.items, fields: getFieldsData(), _updated: Date.now() };
        const path = getModePath('draft');
        console.log('💾 Saving to Firebase:', path, draftData);
        
        // 使用模式特定的路径
        set(ref(db, path), draftData).then(() => {
            isSaving = false;
            console.log('✅ Save successful');
            setStatus('connected', '已同步');
        }).catch(err => {
            isSaving = false;
            console.error('❌ Save failed:', err);
            setStatus('offline', 'Error');
        });
    }, 500); 
}

// --- 初始化监听器 ---
function initListeners() {
    // 初始时加载当前模式的配置（从Firebase）
    loadConfig(currentMode).then(() => {
        // 初始化settings数据到window对象
        window.clients = CONFIG_DATA.clients || [];
        window.ships = CONFIG_DATA.ships || [];
        window.routes = CONFIG_DATA.routes || [];
        window.dbTypes = CONFIG_DATA.cabinTypes || [];
        window.dbExps = CONFIG_DATA.experienceTypes || [];
        window.dbPrices = CONFIG_DATA.priceTypes || [];
        window.dbAddons = CONFIG_DATA.addonProducts || [];
        
        // 渲染下拉列表
        renderClientSelect();
        renderAllDatalists();
    });

    // 初始订阅draft数据
    subscribeToDraft();
}

// 订阅当前模式的draft数据
function subscribeToDraft() {
    console.log('🔔 subscribeToDraft called for mode:', currentMode);
    
    // 取消之前的监听
    if (draftUnsubscribe) {
        console.log('🚫 Unsubscribing from previous draft');
        draftUnsubscribe();
        draftUnsubscribe = null;
    }
    
    // 订阅当前模式的draft
    const draftPath = getModePath('draft');
    console.log('📡 Subscribing to:', draftPath);
    const draftRef = ref(db, draftPath);
    draftUnsubscribe = onValue(draftRef, (snapshot) => {
        console.log('📥 Draft data received:', snapshot.exists(), snapshot.val());
        
        // 跳过正在保存的更新，避免状态跳闪
        if (isSaving) {
            console.log('⏭️ Skipping - currently saving');
            return;
        }
        
        isLoadingFromFirebase = true; // 标记开始加载远程数据
        const data = snapshot.val();
        console.log('📂 Loading draft data into form...');
        
        // 1. PREPARE DEFAULTS
        const defaults = {
            payment: getDefaultPayment(),
            remarks: getDefaultRemarks(),
            invDate: new Date().toISOString().split('T')[0]
        };

        if (data) {
            // 2. MERGE FIELDS WITH DEFAULTS (Force default if empty)
            const remoteFields = data.fields || {};
            
            // Apply Date
            const dateEl = document.getElementById('invDate');
            dateEl.value = (remoteFields.invDate && remoteFields.invDate.trim()) ? remoteFields.invDate : defaults.invDate;
            // 直接设置样式，不调用checkClear（避免触发updateState）
            const dateBox = dateEl.closest('.input-box');
            if (dateEl.value && dateEl.value.trim() !== '') dateBox.classList.add('has-val');
            else dateBox.classList.remove('has-val');

            // Apply Payment
            const payEl = document.getElementById('payment');
            payEl.value = (remoteFields.payment && remoteFields.payment.trim()) ? remoteFields.payment : defaults.payment;
            const payBox = payEl.closest('.input-box');
            if (payEl.value && payEl.value.trim() !== '') payBox.classList.add('has-val');
            else payBox.classList.remove('has-val');

            // Apply Remarks
            const remEl = document.getElementById('remarks');
            remEl.value = (remoteFields.remarks && remoteFields.remarks.trim()) ? remoteFields.remarks : defaults.remarks;
            const remBox = remEl.closest('.input-box');
            if (remEl.value && remEl.value.trim() !== '') remBox.classList.add('has-val');
            else remBox.classList.remove('has-val');

            // Apply other fields
            Object.entries(remoteFields).forEach(([k, v]) => {
                if (['invDate', 'payment', 'remarks'].includes(k)) return; // Handled above
                const el = document.getElementById(k);
                if (el && document.activeElement !== el) {
                    el.value = v;
                    // 直接设置样式，不调用checkClear
                    const box = el.closest('.input-box');
                    if (box) {
                        if (el.value && el.value.trim() !== '') box.classList.add('has-val');
                        else box.classList.remove('has-val');
                    }
                }
            });

            if(JSON.stringify(window.items) !== JSON.stringify(data.items || [])) {
               window.items = (data.items || []).map(i => ({ ...defaultItem, ...i, addons: i.addons || [] }));
               if(window.items.length === 0) window.items = [{ ...defaultItem, addons:[] }];
               window.renderItemInputs();
            }
            
            // 更新预览区，但不触发保存（因为 isLoadingFromFirebase = true）
            window.updateStateWithoutSave();
            
            setStatus('connected', '已同步');
        } else {
            // Fresh start logic
            document.getElementById('invDate').value = defaults.invDate;
            document.getElementById('payment').value = defaults.payment;
            document.getElementById('remarks').value = defaults.remarks;
            window.items = [{ ...defaultItem, addons:[] }];
            window.renderItemInputs();
            
            // 更新预览区，但不触发保存
            window.updateStateWithoutSave();
        }
        
        // 立即重置加载标志，允许用户编辑
        isLoadingFromFirebase = false;
        console.log('✅ Finished loading from Firebase');
    });
}

window.resetForm = function() { 
  if(confirm(t('confirmReset'))) { 
      // 使用模式特定的路径
      set(ref(db, getModePath('draft')), null); 
      document.getElementById('invDate').value = new Date().toISOString().split('T')[0];
      document.getElementById('payment').value = getDefaultPayment();
      document.getElementById('remarks').value = getDefaultRemarks();
      document.getElementById('invNo').value = "";
      document.getElementById('clientSelect').value = "";
      document.getElementById('billTradeName').value = "";
      document.getElementById('billCompany').value = "";
      document.getElementById('billTaxId').value = "";
      document.getElementById('billAddress').value = "";
      document.getElementById('billDefaultRate').value = 0;
      document.getElementById('billAddonRate').value = 0;
      document.getElementById('ship').value = "";
      document.getElementById('route').value = "";
      document.getElementById('sailingStart').value = "";
      document.getElementById('sailingEnd').value = "";
      // Removed global Ref reset
      window.items = [{ ...defaultItem, addons:[] }];
      window.renderItemInputs(); 
      window.updateState();
  } 
}



// 注册模式模块（不需要等待配置加载）
if (window.BillMode) MODE_MODULES['bill'] = window.BillMode;
if (window.QuoteMode) MODE_MODULES['quote'] = window.QuoteMode;
if (window.TicketMode) MODE_MODULES['ticket'] = window.TicketMode;
if (window.CompareMode) MODE_MODULES['compare'] = window.CompareMode;

// 初始化所有模式
Object.values(MODE_MODULES).forEach(module => {
    if (module.init) module.init();
});

console.log('📋 模式模块已初始化，等待用户登录...');

onAuthStateChanged(auth, async (user) => {
    console.log('🔑 Auth state changed:', user ? `User ID: ${user.uid}` : 'No user');
    
    if (user) {
        console.log('✅ User authenticated, initializing...');
        setStatus('connecting', '加载中...');
        
        // 用户登录后再加载配置
        try {
            await loadConfig(currentMode);
            console.log('✅ 配置加载成功');
        } catch (err) {
            console.error('❌ 配置加载失败:', err);
        }
        
        setStatus('connected', '已连接');
        initListeners();
        updateUILanguage(); // 初始化语言
        initMode(); // 初始化模式
        
        console.log('🎯 Adding input listeners to form elements...');
        document.querySelectorAll('.pane-form input, .pane-form textarea').forEach(el => {
          if(!el.closest('#items-container') && el.id!=='sailingStart' && el.id!=='sailingEnd') {
              el.addEventListener('input', window.updateState);
          }
        });
        console.log('✅ Input listeners added');
        
        // 🧹 强力清理：删除所有废弃路径并持续监控
        const DEPRECATED_PATHS = ['draft', 'draft_compare', 'draft_quote', 'settings', 'settings_bill', 'settings_quote', 'database'];
        
        // 清理函数
        async function cleanDeprecatedPath(path) {
            try {
                const pathRef = ref(db, path);
                const snapshot = await get(pathRef);
                if (snapshot.exists()) {
                    console.warn(`🧹 检测到废弃节点 /${path}，正在清理...`);
                    await set(pathRef, null);
                    console.log(`✅ 废弃节点 /${path} 已清理`);
                    return true;
                }
            } catch (err) {
                console.error(`❌ 清理 /${path} 失败:`, err);
            }
            return false;
        }
        
        // 立即清理所有废弃路径
        console.log('🧹 开始清理所有废弃路径...');
        Promise.all(DEPRECATED_PATHS.map(cleanDeprecatedPath)).then(results => {
            const cleaned = results.filter(Boolean).length;
            if (cleaned > 0) {
                console.log(`✅ 已清理 ${cleaned} 个废弃节点`);
            } else {
                console.log('✅ 没有发现废弃节点');
            }
        });
        
        // 持续监控废弃的 draft 节点（实时删除）
        const draftWatcher = ref(db, 'draft');
        onValue(draftWatcher, (snapshot) => {
            if (snapshot.exists()) {
                console.warn('🚨 检测到废弃 /draft 节点被重新创建，立即删除！');
                set(draftWatcher, null).then(() => {
                    console.log('✅ 废弃 /draft 节点已自动删除');
                }).catch(err => {
                    console.error('❌ 自动删除失败:', err);
                });
            }
        });
    } else {
        console.warn('⚠️ No user authenticated');
        setStatus('offline', '未连接');
    }
});