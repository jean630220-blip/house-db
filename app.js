/**
 * 看房管理系統 (House Viewing Database)
 * 主應用程式邏輯 (Application logic, Routing, Event listeners)
 */

document.addEventListener('DOMContentLoaded', () => {
  // --- 狀態變數 ---
  let appState = {
    currentView: 'dashboard', // dashboard, form, detail, compare, settings
    houses: [],
    checkedHouseIds: new Set(),
    selectedPhotos: [], // 用於表單編輯時暫存圖片 Base64
    activePhotoIndex: 0, // 用於詳情頁 Carousel
    editingHouseId: null // 若為 null 代表是新增，否則為編輯的 ID
  };

  // --- DOM 節點 ---
  const views = {
    dashboard: document.getElementById('page-dashboard'),
    form: document.getElementById('page-form'),
    detail: document.getElementById('page-detail'),
    compare: document.getElementById('page-compare'),
    settings: document.getElementById('page-settings')
  };

  const navLogo = document.getElementById('nav-logo');
  const navBtnSettings = document.getElementById('nav-settings');
  const btnToggleTheme = document.getElementById('btn-toggle-theme');
  const fabAdd = document.getElementById('fab-add');
  
  // 搜尋與篩選
  const searchInput = document.getElementById('search-input');
  const filterRegion = document.getElementById('filter-region');
  const filterPrice = document.getElementById('filter-price');
  const filterPing = document.getElementById('filter-ping');
  const filterLayout = document.getElementById('filter-layout');
  const filterRating = document.getElementById('filter-rating');
  const houseGrid = document.getElementById('house-grid');
  
  // 批次操作
  const batchBar = document.getElementById('batch-actions-bar');
  const batchCount = document.getElementById('batch-count');
  const btnBatchCompare = document.getElementById('btn-batch-compare');
  const btnBatchClear = document.getElementById('btn-batch-clear');

  // --- 初始化作業 ---
  initApp();

  async function initApp() {
    // 載入主題偏好
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);

    // 載入資料庫資料
    await refreshHouseData();

    // 註冊全局事件
    registerGlobalEvents();
    
    // 渲染下拉選單區域（從資料中提取現有的地區）
    populateRegionFilter();
    
    // 渲染房屋列表
    renderHouseList();

    // 初始化 Google API (若已儲存金鑰且 SDK 載入完成)
    const clientId = localStorage.getItem('gdrive_client_id');
    const apiKey = localStorage.getItem('gdrive_api_key');
    if (clientId && apiKey) {
      // 延遲一點點確保 Google SDK 完全初始化完成
      setTimeout(() => {
        window.utils.initGoogleDriveAuth(clientId, apiKey, (res) => {
          handleGapiStatusChange(res);
        });
      }, 500);
    }

    // 檢查 URL Hash（若有）
    handleRouting();
  }

  // --- 資料同步 ---
  async function refreshHouseData() {
    try {
      appState.houses = await window.houseDB.getAllHouses();
      // 確保將勾選清單中已刪除的 ID 移除
      const validIds = new Set(appState.houses.map(h => h.id));
      appState.checkedHouseIds = new Set([...appState.checkedHouseIds].filter(id => validIds.has(id)));
      updateBatchBar();
    } catch (err) {
      console.error('無法載入房屋資料', err);
    }
  }

  // --- Google Drive 同步邏輯 ---
  function handleGapiStatusChange(res) {
    const statusTextEl = document.getElementById('settings-gapi-status-text');
    const btnLogin = document.getElementById('btn-settings-gapi-login');
    const btnLogout = document.getElementById('btn-settings-gapi-logout');
    const btnSyncNow = document.getElementById('btn-settings-gapi-sync-now');
    const syncIndicator = document.getElementById('sync-status-indicator');

    if (!statusTextEl) return;

    if (res.status === 'connected') {
      statusTextEl.textContent = '已連線，已成功取得 Google 雲端授權。';
      statusTextEl.style.color = 'var(--success)';
      btnLogin.style.display = 'none';
      btnLogout.style.display = 'inline-block';
      btnSyncNow.style.display = 'inline-block';
      syncIndicator.style.display = 'flex';
      
      // 自動同步
      syncWithGoogleDrive();
    } else if (res.status === 'ready') {
      statusTextEl.textContent = res.message;
      statusTextEl.style.color = 'var(--text-secondary)';
      btnLogin.removeAttribute('disabled');
      btnLogin.style.display = 'inline-block';
      btnLogout.style.display = 'none';
      btnSyncNow.style.display = 'none';
      syncIndicator.style.display = 'none';
    } else if (res.status === 'error') {
      statusTextEl.textContent = res.message;
      statusTextEl.style.color = 'var(--danger)';
      btnLogin.setAttribute('disabled', 'true');
      btnLogin.style.display = 'inline-block';
      btnLogout.style.display = 'none';
      btnSyncNow.style.display = 'none';
      syncIndicator.style.display = 'none';
    }
  }

  async function syncWithGoogleDrive() {
    const clientId = localStorage.getItem('gdrive_client_id');
    const apiKey = localStorage.getItem('gdrive_api_key');
    const token = window.utils.getValidToken();

    const syncIndicator = document.getElementById('sync-status-indicator');
    const syncDot = document.getElementById('sync-dot');
    const syncStatusText = document.getElementById('sync-status-text');
    const settingsStatusText = document.getElementById('settings-gapi-status-text');

    if (!clientId || !apiKey || !token) {
      if (syncIndicator) syncIndicator.style.display = 'none';
      return;
    }

    if (syncIndicator) {
      syncIndicator.style.display = 'flex';
      syncDot.style.background = '#f59e0b'; // 黃燈：同步中
      syncStatusText.textContent = '同步中...';
    }
    if (settingsStatusText) {
      settingsStatusText.textContent = '正在與 Google 雲端進行雙向同步...';
      settingsStatusText.style.color = 'var(--text-secondary)';
    }

    try {
      // 1. 取得本機資料
      let localHouses = await window.houseDB.getAllHouses();
      
      // 2. 搜尋雲端同步檔
      const cloudFile = await window.utils.findSyncFile(token);

      if (cloudFile) {
        // 下載雲端檔案
        const cloudData = await window.utils.downloadSyncFile(token, cloudFile.id);
        const cloudHouses = cloudData.houses || [];
        const cloudDeleted = cloudData.deleted || [];
        
        // 3. 合併刪除清單
        let localDeleted = JSON.parse(localStorage.getItem('deletedHouseIds') || '[]');
        const deletedMap = new Map();
        localDeleted.forEach(d => deletedMap.set(Number(d.id), Number(d.deletedAt)));
        cloudDeleted.forEach(d => {
          const id = Number(d.id);
          const time = Number(d.deletedAt);
          if (!deletedMap.has(id) || deletedMap.get(id) < time) {
            deletedMap.set(id, time);
          }
        });

        // 4. 合併兩端資料 (時間戳記最新勝出)
        const mergedHouses = new Map();
        localHouses.forEach(h => {
          if (h && h.id) mergedHouses.set(Number(h.id), h);
        });

        cloudHouses.forEach(ch => {
          if (!ch || !ch.id) return;
          const id = Number(ch.id);
          const localHouse = mergedHouses.get(id);

          if (!localHouse) {
            mergedHouses.set(id, ch);
          } else {
            const localTime = Number(localHouse.updatedAt || 0);
            const cloudTime = Number(ch.updatedAt || 0);
            if (cloudTime > localTime) {
              mergedHouses.set(id, ch);
            }
          }
        });

        // 5. 套用過濾已刪除資料 (若更新時間早於刪除時間則刪除)
        const finalHouses = [];
        for (let [id, house] of mergedHouses.entries()) {
          if (deletedMap.has(id)) {
            const deletedAt = deletedMap.get(id);
            const updatedAt = Number(house.updatedAt || 0);
            if (deletedAt > updatedAt) {
              continue; // 被刪除
            } else {
              deletedMap.delete(id); // 更新時間較新，救回資料並自刪除清單移除
              finalHouses.push(house);
            }
          } else {
            finalHouses.push(house);
          }
        }

        // 6. 更新本機資料庫
        await window.houseDB.clearAll();
        for (let h of finalHouses) {
          await window.houseDB.addHouse(h);
        }

        // 7. 更新 local 刪除列表與雲端儲存負載
        const updatedDeletedList = Array.from(deletedMap.entries()).map(([id, deletedAt]) => ({ id, deletedAt }));
        localStorage.setItem('deletedHouseIds', JSON.stringify(updatedDeletedList));

        const syncPayload = {
          houses: finalHouses,
          deleted: updatedDeletedList,
          lastSyncTime: Date.now()
        };
        await window.utils.uploadSyncFile(token, syncPayload, cloudFile.id);
      } else {
        // 第一次同步：直接上傳本機資料
        const localDeleted = JSON.parse(localStorage.getItem('deletedHouseIds') || '[]');
        const syncPayload = {
          houses: localHouses,
          deleted: localDeleted,
          lastSyncTime: Date.now()
        };
        await window.utils.uploadSyncFile(token, syncPayload);
      }

      // 同步成功
      if (syncIndicator) {
        syncDot.style.background = '#10b981'; // 綠燈
        syncStatusText.textContent = '已同步';
      }
      const lastSyncStr = new Date().toLocaleTimeString();
      if (settingsStatusText) {
        settingsStatusText.textContent = `已與 Google 雲端完成同步 (最後同步時間：${lastSyncStr})`;
        settingsStatusText.style.color = 'var(--success)';
      }

      // 重新載入畫面
      await refreshHouseData();
      if (appState.currentView === 'dashboard') {
        populateRegionFilter();
        renderHouseList();
      }
    } catch (err) {
      console.error('Google Drive 同步失敗:', err);
      if (syncIndicator) {
        syncDot.style.background = '#ef4444'; // 紅燈
        syncStatusText.textContent = '同步失敗';
      }
      if (settingsStatusText) {
        settingsStatusText.textContent = '同步失敗：' + err.message;
        settingsStatusText.style.color = 'var(--danger)';
      }
    }
  }

  // --- 路由切換邏輯 ---
  function navigateTo(viewName, params = {}) {
    appState.currentView = viewName;
    
    // 更新網址 Hash (可選，這裡用簡單的 DOM 狀態控制)
    // 切換 active class
    Object.keys(views).forEach(key => {
      if (key === viewName) {
        views[key].classList.add('active');
      } else {
        views[key].classList.remove('active');
      }
    });

    // 捲動至最上方
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // 根據不同頁面做初始化渲染
    if (viewName === 'dashboard') {
      refreshHouseData().then(() => {
        populateRegionFilter();
        renderHouseList();
      });
      fabAdd.style.display = 'flex';
    } else {
      fabAdd.style.display = 'none';
    }

    if (viewName === 'form') {
      setupFormPage(params.id);
    }

    if (viewName === 'detail') {
      setupDetailPage(params.id);
    }

    if (viewName === 'compare') {
      setupComparePage();
    }

    if (viewName === 'settings') {
      setupSettingsPage();
    }
  }

  function handleRouting() {
    const hash = window.location.hash;
    if (!hash || hash === '#dashboard') {
      navigateTo('dashboard');
    } else if (hash.startsWith('#detail/')) {
      const id = Number(hash.split('/')[1]);
      navigateTo('detail', { id });
    } else if (hash.startsWith('#edit/')) {
      const id = Number(hash.split('/')[1]);
      navigateTo('form', { id });
    } else if (hash === '#new') {
      navigateTo('form');
    } else if (hash === '#compare') {
      navigateTo('compare');
    } else if (hash === '#settings') {
      navigateTo('settings');
    }
  }

  window.addEventListener('hashchange', handleRouting);

  // --- 全局事件註冊 ---
  function registerGlobalEvents() {
    // Logo 返回首頁
    navLogo.addEventListener('click', () => {
      window.location.hash = 'dashboard';
    });

    // 設定頁面
    navBtnSettings.addEventListener('click', () => {
      window.location.hash = 'settings';
    });

    // 新增按鈕 FAB
    fabAdd.addEventListener('click', () => {
      window.location.hash = 'new';
    });

    // 主題切換
    btnToggleTheme.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
      updateThemeIcon(newTheme);
    });

    // 搜尋與篩選監聽器
    const filterElements = [searchInput, filterRegion, filterPrice, filterPing, filterLayout, filterRating];
    filterElements.forEach(el => {
      if (el) {
        el.addEventListener('input', () => renderHouseList());
        el.addEventListener('change', () => renderHouseList());
      }
    });

    // 批次操作
    btnBatchCompare.addEventListener('click', () => {
      if (appState.checkedHouseIds.size >= 2) {
        window.location.hash = 'compare';
      } else {
        alert('請至少勾選 2 間房子進行比較！');
      }
    });

    btnBatchClear.addEventListener('click', () => {
      appState.checkedHouseIds.clear();
      updateBatchBar();
      // 重新渲染卡片以更新勾選狀態
      renderHouseList();
    });
  }

  function updateThemeIcon(theme) {
    if (theme === 'dark') {
      btnToggleTheme.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-11.314l.707.707m12.02 11.314l.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z"></path></svg>`;
    } else {
      btnToggleTheme.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>`;
    }
  }

  // --- 地區篩選下拉選單動態產生 ---
  function populateRegionFilter() {
    const regions = new Set();
    appState.houses.forEach(h => {
      if (h.address) {
        // 簡單解析地址前三個字作為地區，例如「台中市」、「台北市」、「西屯區」等
        const match = h.address.match(/^.{3}/);
        if (match) regions.add(match[0]);
      }
    });

    // 清除舊選項，保留「全部地區」
    filterRegion.innerHTML = '<option value="">全部地區</option>';
    regions.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      filterRegion.appendChild(opt);
    });
  }

  // --- 篩選與渲染房屋列表 ---
  function renderHouseList() {
    const q = searchInput.value.toLowerCase().trim();
    const regionVal = filterRegion.value;
    const priceVal = filterPrice.value;
    const pingVal = filterPing.value;
    const layoutVal = filterLayout.value;
    const ratingVal = filterRating.value;

    const filtered = appState.houses.filter(h => {
      // 1. 關鍵字搜尋 (社區、地址、備註、格局)
      if (q) {
        const titleMatch = h.title && h.title.toLowerCase().includes(q);
        const communityMatch = h.community && h.community.toLowerCase().includes(q);
        const addressMatch = h.address && h.address.toLowerCase().includes(q);
        const noteMatch = h.notes && h.notes.toLowerCase().includes(q);
        if (!titleMatch && !communityMatch && !addressMatch && !noteMatch) return false;
      }

      // 2. 地區篩選
      if (regionVal && (!h.address || !h.address.startsWith(regionVal))) return false;

      // 3. 價格篩選
      if (priceVal) {
        const price = Number(h.price) || 0;
        if (priceVal === 'under-1000' && price > 1000) return false;
        if (priceVal === '1000-1500' && (price < 1000 || price > 1500)) return false;
        if (priceVal === '1500-2500' && (price < 1500 || price > 2500)) return false;
        if (priceVal === 'above-2500' && price < 2500) return false;
      }

      // 4. 坪數篩選
      if (pingVal) {
        const ping = Number(h.ping) || 0;
        if (pingVal === 'under-20' && ping > 20) return false;
        if (pingVal === '20-35' && (ping < 20 || ping > 35)) return false;
        if (pingVal === '35-50' && (ping < 35 || ping > 50)) return false;
        if (pingVal === 'above-50' && ping < 50) return false;
      }

      // 5. 格局房數篩選
      if (layoutVal) {
        const layoutNum = parseInt(h.layout) || 0;
        if (layoutVal === '1' && layoutNum !== 1) return false;
        if (layoutVal === '2' && layoutNum !== 2) return false;
        if (layoutVal === '3' && layoutNum !== 3) return false;
        if (layoutVal === '4+' && layoutNum < 4) return false;
      }

      // 6. 評分篩選
      if (ratingVal) {
        const rating = Number(h.rating) || 0;
        if (rating < Number(ratingVal)) return false;
      }

      return true;
    });

    // 渲染卡片
    if (filtered.length === 0) {
      houseGrid.innerHTML = `
        <div class="empty-state">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path>
          </svg>
          <h3>找不到符合條件的看房資料</h3>
          <p>您可以嘗試清除篩選條件，或點選右下角 + 號新增第一間房子。</p>
        </div>
      `;
      return;
    }

    houseGrid.innerHTML = filtered.map(h => {
      const coverImg = (h.photos && h.photos.length > 0) ? h.photos[0].base64 : '';
      const checked = appState.checkedHouseIds.has(h.id) ? 'checked' : '';
      const pingText = h.ping ? `${h.ping} 坪` : '-- 坪';
      const ageText = h.age ? `${h.age} 年` : '-- 年';
      const ratingStars = '★'.repeat(h.rating || 0) + '☆'.repeat(5 - (h.rating || 0));

      return `
        <div class="house-card" data-id="${h.id}">
          <label class="card-checkbox-label" onclick="event.stopPropagation()">
            <input type="checkbox" class="card-checkbox" data-id="${h.id}" ${checked}>
          </label>
          <div class="card-cover">
            ${coverImg ? `<img src="${coverImg}" alt="${h.community || h.title}">` : '<div style="height:100%; display:flex; align-items:center; justify-content:center; color:var(--text-muted)">暫無照片</div>'}
            <div class="card-tag">${h.layout || '未填格局'}</div>
            <div class="rating-badge">
              <svg viewBox="0 0 20 20" fill="currentColor"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
              ${h.rating || 0}
            </div>
          </div>
          <div class="card-body">
            <h3 class="card-title">${h.community || h.title || '未命名房屋'}</h3>
            <div class="card-address">
              <svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
              ${h.address || '未填寫地址'}
            </div>
            <div class="card-stats">
              <div class="stat-item">
                <span class="stat-val">${pingText}</span>
                <span class="stat-lbl">坪數</span>
              </div>
              <div class="stat-item">
                <span class="stat-val">${ageText}</span>
                <span class="stat-lbl">屋齡</span>
              </div>
              <div class="stat-item">
                <span class="stat-val">${h.floor || '-- 樓'}</span>
                <span class="stat-lbl">樓層</span>
              </div>
            </div>
            <div class="card-footer">
              <div class="card-price">${h.price || '--'}<span>萬</span></div>
              <div class="card-meta-bottom">${h.visitDate || '未記看房日'}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // 綁定卡片點擊事件 (進入詳情頁)
    document.querySelectorAll('.house-grid .house-card').forEach(card => {
      card.addEventListener('click', (e) => {
        // 如果點擊的是 Checkbox，不觸發詳情頁跳轉
        if (e.target.classList.contains('card-checkbox')) return;
        const id = card.getAttribute('data-id');
        window.location.hash = `detail/${id}`;
      });
    });

    // 綁定 Checkbox 點擊事件
    document.querySelectorAll('.card-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const id = Number(cb.getAttribute('data-id'));
        if (cb.checked) {
          appState.checkedHouseIds.add(id);
        } else {
          appState.checkedHouseIds.delete(id);
        }
        updateBatchBar();
      });
    });
  }

  // --- 更新批次操作列顯示 ---
  function updateBatchBar() {
    const size = appState.checkedHouseIds.size;
    if (size > 0) {
      batchBar.style.display = 'flex';
      batchCount.textContent = `已選取 ${size} 間房屋`;
      if (size >= 2) {
        btnBatchCompare.removeAttribute('disabled');
      } else {
        btnBatchCompare.setAttribute('disabled', 'true');
      }
    } else {
      batchBar.style.display = 'none';
    }
  }

  // ==========================================================================
  // 新增/編輯表單邏輯 (House Form Setup)
  // ==========================================================================
  
  function setupFormPage(houseId = null) {
    appState.editingHouseId = houseId;
    appState.selectedPhotos = [];
    
    const formTitle = document.getElementById('house-form-title');
    const form = document.getElementById('house-edit-form');
    const previewGrid = document.getElementById('photo-preview-grid');
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('file-upload-input');
    const btnCancel = document.getElementById('btn-form-cancel');

    // 評分星星綁定
    const starContainer = document.getElementById('star-rating-select-container');
    setupStarRatingSelector(starContainer, 0);

    if (houseId) {
      formTitle.textContent = '編輯看房紀錄';
      // 載入舊資料並填入表單
      window.houseDB.getHouse(houseId).then(house => {
        if (!house) {
          alert('找不到該房屋資料！');
          window.location.hash = 'dashboard';
          return;
        }

        document.getElementById('form-title').value = house.title || '';
        document.getElementById('form-community').value = house.community || '';
        document.getElementById('form-address').value = house.address || '';
        document.getElementById('form-price').value = house.price || '';
        document.getElementById('form-deal-price').value = house.dealPrice || '';
        document.getElementById('form-ping').value = house.ping || '';
        document.getElementById('form-age').value = house.age || '';
        document.getElementById('form-floor').value = house.floor || '';
        document.getElementById('form-layout').value = house.layout || '';
        document.getElementById('form-parking').value = house.parking || '';
        document.getElementById('form-mgmt-fee').value = house.managementFee || '';
        document.getElementById('form-orientation').value = house.orientation || '';
        document.getElementById('form-lighting').value = house.lighting || 3;
        document.getElementById('form-ventilation').value = house.ventilation || 3;
        document.getElementById('form-decoration').value = house.decoration || '';
        document.getElementById('form-agent-name').value = house.agentName || '';
        document.getElementById('form-agent-phone').value = house.agentPhone || '';
        document.getElementById('form-visit-date').value = house.visitDate || '';
        document.getElementById('form-link').value = house.link || '';
        document.getElementById('form-notes').value = house.notes || '';
        document.getElementById('form-pros').value = (house.pros || []).join('\n');
        document.getElementById('form-cons').value = (house.cons || []).join('\n');

        setupStarRatingSelector(starContainer, house.rating || 0);

        // 載入照片
        if (house.photos && house.photos.length > 0) {
          appState.selectedPhotos = [...house.photos];
          renderPhotoPreviews();
        } else {
          previewGrid.innerHTML = '';
        }
      });
    } else {
      formTitle.textContent = '新增看房紀錄';
      form.reset();
      previewGrid.innerHTML = '';
      // 預設日期為今天
      document.getElementById('form-visit-date').value = new Date().toISOString().split('T')[0];
    }

    // 拖曳上傳處理
    dropzone.onclick = () => fileInput.click();
    
    dropzone.ondragover = (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    };

    dropzone.ondragleave = () => {
      dropzone.classList.remove('dragover');
    };

    dropzone.ondrop = async (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      await handleImageUploads(files);
    };

    fileInput.onchange = async (e) => {
      const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
      await handleImageUploads(files);
      fileInput.value = ''; // 清除以利重複上傳
    };

    // 表單取消按鈕
    btnCancel.onclick = () => {
      if (houseId) {
        window.location.hash = `detail/${houseId}`;
      } else {
        window.location.hash = 'dashboard';
      }
    };

    // 表單提交
    form.onsubmit = async (e) => {
      e.preventDefault();

      const ratingVal = Number(starContainer.getAttribute('data-value')) || 0;
      const prosVal = document.getElementById('form-pros').value.split('\n').map(p => p.trim()).filter(p => p);
      const consVal = document.getElementById('form-cons').value.split('\n').map(p => p.trim()).filter(p => p);

      const houseData = {
        title: document.getElementById('form-title').value.trim(),
        community: document.getElementById('form-community').value.trim(),
        address: document.getElementById('form-address').value.trim(),
        price: Number(document.getElementById('form-price').value) || null,
        dealPrice: Number(document.getElementById('form-deal-price').value) || null,
        ping: Number(document.getElementById('form-ping').value) || null,
        age: Number(document.getElementById('form-age').value) || null,
        floor: document.getElementById('form-floor').value.trim(),
        layout: document.getElementById('form-layout').value.trim(),
        parking: document.getElementById('form-parking').value.trim(),
        managementFee: Number(document.getElementById('form-mgmt-fee').value) || null,
        orientation: document.getElementById('form-orientation').value.trim(),
        lighting: Number(document.getElementById('form-lighting').value) || 3,
        ventilation: Number(document.getElementById('form-ventilation').value) || 3,
        decoration: document.getElementById('form-decoration').value.trim(),
        agentName: document.getElementById('form-agent-name').value.trim(),
        agentPhone: document.getElementById('form-agent-phone').value.trim(),
        visitDate: document.getElementById('form-visit-date').value,
        link: document.getElementById('form-link').value.trim(),
        notes: document.getElementById('form-notes').value.trim(),
        rating: ratingVal,
        pros: prosVal,
        cons: consVal,
        photos: appState.selectedPhotos,
        updatedAt: Date.now() // 設定最後修改時間戳記
      };

      // 檢查必填 (以社區名稱或標題二擇一作為識別)
      if (!houseData.title && !houseData.community) {
        alert('請填寫房屋標題或社區名稱！');
        return;
      }

      try {
        if (appState.editingHouseId) {
          // 編輯模式：繼承原有的歷史看房紀錄
          const original = await window.houseDB.getHouse(appState.editingHouseId);
          houseData.id = appState.editingHouseId;
          houseData.history = original.history || [];
          
          // 如果編輯表單時修改了心得、日期、評分，自動新增一筆歷史紀錄
          const visitNotes = houseData.notes;
          const visitDate = houseData.visitDate;
          const rating = houseData.rating;

          // 判斷是否需要自動追加歷史軌跡 (如果與最後一次紀錄不同，則加一筆)
          const lastHistory = houseData.history[houseData.history.length - 1];
          if (!lastHistory || lastHistory.notes !== visitNotes || lastHistory.date !== visitDate) {
            houseData.history.push({
              date: visitDate || new Date().toISOString().split('T')[0],
              notes: visitNotes || '修改看房紀錄',
              rating: rating
            });
          }

          await window.houseDB.updateHouse(houseData);
          alert('看房紀錄更新成功！');
          
          // 背景同步
          syncWithGoogleDrive().catch(err => console.error(err));

          window.location.hash = `detail/${appState.editingHouseId}`;
        } else {
          // 新增模式：預設加上第一筆看房紀錄到歷程
          houseData.history = [{
            date: houseData.visitDate || new Date().toISOString().split('T')[0],
            notes: houseData.notes || '初次看房',
            rating: houseData.rating
          }];

          const newId = await window.houseDB.addHouse(houseData);
          alert('成功新增看房紀錄！');
          
          // 背景同步
          syncWithGoogleDrive().catch(err => console.error(err));

          window.location.hash = `detail/${newId}`;
        }
      } catch (err) {
        console.error('儲存失敗', err);
        alert('儲存失敗，請檢查資料欄位是否正確！');
      }
    };
  }

  // 實作拖曳上傳與圖片壓縮
  async function handleImageUploads(files) {
    if (appState.selectedPhotos.length + files.length > 10) {
      alert('抱歉，每間房屋最多只能上傳 10 張照片！');
      return;
    }

    for (let file of files) {
      try {
        // 調用 utils 中的壓縮功能
        const base64 = await window.utils.compressImage(file, 1000, 1000, 0.7);
        appState.selectedPhotos.push({
          name: file.name,
          base64: base64
        });
      } catch (err) {
        console.error('圖片載入失敗', err);
      }
    }
    renderPhotoPreviews();
  }

  // 渲染表單圖片預覽
  function renderPhotoPreviews() {
    const previewGrid = document.getElementById('photo-preview-grid');
    previewGrid.innerHTML = appState.selectedPhotos.map((photo, index) => `
      <div class="preview-photo-item">
        <img src="${photo.base64}" alt="${photo.name}">
        <button type="button" class="btn-remove-photo" data-index="${index}">✕</button>
      </div>
    `).join('');

    // 綁定刪除照片按鈕
    previewGrid.querySelectorAll('.btn-remove-photo').forEach(btn => {
      btn.onclick = () => {
        const index = Number(btn.getAttribute('data-index'));
        appState.selectedPhotos.splice(index, 1);
        renderPhotoPreviews();
      };
    });
  }

  // 星星評選渲染與邏輯
  function setupStarRatingSelector(container, initialValue = 0) {
    container.setAttribute('data-value', initialValue);
    renderStars();

    function renderStars() {
      const currentVal = Number(container.getAttribute('data-value'));
      container.innerHTML = Array.from({ length: 5 }, (_, i) => {
        const active = i < currentVal ? 'active' : '';
        return `
          <button type="button" class="star-btn ${active}" data-star="${i + 1}">
            <svg viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
          </button>
        `;
      }).join('');

      // 星星點擊事件
      container.querySelectorAll('.star-btn').forEach(btn => {
        btn.onclick = () => {
          const val = Number(btn.getAttribute('data-star'));
          container.setAttribute('data-value', val);
          renderStars();
        };
      });
    }
  }

  // ==========================================================================
  // 房屋詳情頁邏輯 (House Detail Setup)
  // ==========================================================================
  
  function setupDetailPage(houseId) {
    if (!houseId) {
      window.location.hash = 'dashboard';
      return;
    }

    const btnBack = document.getElementById('btn-detail-back');
    const btnEdit = document.getElementById('btn-detail-edit');
    const btnDelete = document.getElementById('btn-detail-delete');

    btnBack.onclick = () => window.location.hash = 'dashboard';
    btnEdit.onclick = () => window.location.hash = `edit/${houseId}`;
    
    btnDelete.onclick = async () => {
      if (confirm('確定要永久刪除此看房紀錄與所有相片嗎？此動作無法復原！')) {
        // 紀錄刪除歷史，供雲端同步過濾使用
        let deleted = JSON.parse(localStorage.getItem('deletedHouseIds') || '[]');
        deleted.push({ id: Number(houseId), deletedAt: Date.now() });
        localStorage.setItem('deletedHouseIds', JSON.stringify(deleted));

        await window.houseDB.deleteHouse(houseId);
        alert('已成功刪除！');

        // 背景同步
        syncWithGoogleDrive().catch(err => console.error(err));

        window.location.hash = 'dashboard';
      }
    };

    window.houseDB.getHouse(houseId).then(house => {
      if (!house) {
        alert('找不到該房屋資料！');
        window.location.hash = 'dashboard';
        return;
      }

      // 1. 頂部基本資訊
      document.getElementById('detail-title').textContent = house.community || house.title || '未命名房屋';
      document.getElementById('detail-subtitle').textContent = house.title ? `社區：${house.community || '無'}` : '基本資料';
      document.getElementById('detail-address').textContent = house.address || '未填寫地址';
      document.getElementById('detail-price-val').textContent = house.price || '--';
      
      const dealPriceEl = document.getElementById('detail-deal-price-area');
      if (house.dealPrice) {
        dealPriceEl.style.display = 'block';
        document.getElementById('detail-deal-price-val').textContent = house.dealPrice;
      } else {
        dealPriceEl.style.display = 'none';
      }

      // 2. 照片輪播 (Carousel)
      setupCarousel(house.photos || []);

      // 3. 特色規格 (Specs Panel)
      document.getElementById('detail-spec-ping').textContent = house.ping ? `${house.ping} 坪` : '--';
      document.getElementById('detail-spec-unit-price').textContent = window.utils.formatPingPrice(house.price, house.ping);
      document.getElementById('detail-spec-age').textContent = house.age ? `${house.age} 年` : '--';
      document.getElementById('detail-spec-floor').textContent = house.floor || '--';
      document.getElementById('detail-spec-layout').textContent = house.layout || '--';
      document.getElementById('detail-spec-parking').textContent = house.parking || '--';
      document.getElementById('detail-spec-mgmt').textContent = house.managementFee ? `${house.managementFee} 元/月` : '--';
      document.getElementById('detail-spec-orientation').textContent = house.orientation || '--';

      // 4. 其他資訊與滑桿指標
      document.getElementById('detail-spec-lighting').textContent = '★'.repeat(house.lighting || 0) + '☆'.repeat(5 - (house.lighting || 0));
      document.getElementById('detail-spec-ventilation').textContent = '★'.repeat(house.ventilation || 0) + '☆'.repeat(5 - (house.ventilation || 0));
      document.getElementById('detail-spec-decoration').textContent = house.decoration || '未註記';
      
      // 評分
      document.getElementById('detail-rating-display').textContent = '★'.repeat(house.rating || 0) + '☆'.repeat(5 - (house.rating || 0));
      document.getElementById('detail-rating-num').textContent = `(${house.rating || 0} / 5)`;

      // 房仲資訊
      document.getElementById('detail-agent-name').textContent = house.agentName || '未填寫';
      const agentPhoneEl = document.getElementById('detail-agent-phone');
      if (house.agentPhone) {
        agentPhoneEl.innerHTML = `<a href="tel:${house.agentPhone}">${house.agentPhone}</a>`;
      } else {
        agentPhoneEl.textContent = '未填寫';
      }

      // 網站連結
      const linkEl = document.getElementById('detail-web-link');
      if (house.link) {
        linkEl.innerHTML = `<a href="${house.link}" target="_blank" class="btn btn-secondary" style="width:100%; display:inline-flex">🔗 開啟網站物件</a>`;
      } else {
        linkEl.innerHTML = `<button class="btn btn-secondary" disabled style="width:100%">無連結</button>`;
      }

      // 5. 優缺點 & 備註
      const prosContainer = document.getElementById('detail-pros-list');
      const consContainer = document.getElementById('detail-cons-list');
      
      if (house.pros && house.pros.length > 0) {
        prosContainer.innerHTML = house.pros.map(p => `<li>${p}</li>`).join('');
      } else {
        prosContainer.innerHTML = '<li style="list-style:none; color:var(--text-muted); padding-left:0">無登錄優點</li>';
      }

      if (house.cons && house.cons.length > 0) {
        consContainer.innerHTML = house.cons.map(c => `<li>${c}</li>`).join('');
      } else {
        consContainer.innerHTML = '<li style="list-style:none; color:var(--text-muted); padding-left:0">無登錄缺點</li>';
      }

      document.getElementById('detail-notes-content').textContent = house.notes || '無看房備註內容。';

      // 6. 房貸計算機
      setupMortgageCalculator(house.price || 0);

      // 7. 地圖整合 (嵌入式 Iframe)
      const mapContainer = document.getElementById('detail-map-container');
      if (house.address) {
        mapContainer.innerHTML = `
          <iframe 
            width="100%" 
            height="100%" 
            frameborder="0" 
            style="border:0" 
            src="https://maps.google.com/maps?q=${encodeURIComponent(house.address)}&t=&z=15&ie=UTF8&iwloc=&output=embed" 
            allowfullscreen>
          </iframe>
        `;
      } else {
        mapContainer.innerHTML = `
          <div class="map-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <span>未提供地址，無法顯示 Google 地圖</span>
          </div>
        `;
      }

      // 8. 看房歷史 (Timeline)
      const timelineContainer = document.getElementById('detail-timeline');
      const historyList = house.history || [];
      if (historyList.length > 0) {
        // 按日期降序排列
        const sortedHistory = [...historyList].sort((a, b) => new Date(b.date) - new Date(a.date));
        timelineContainer.innerHTML = sortedHistory.map(h => `
          <div class="timeline-item">
            <div class="timeline-dot"></div>
            <div class="timeline-header">
              <span class="timeline-date">${h.date}</span>
              <span class="timeline-rating" style="color: #ffb800">${'★'.repeat(h.rating || 0)}</span>
            </div>
            <div class="timeline-content">
              ${h.notes || '無紀錄備註'}
            </div>
          </div>
        `).join('');
      } else {
        timelineContainer.innerHTML = `
          <div class="timeline-item" style="color:var(--text-muted)">
            暫無看房歷史軌跡記錄。
          </div>
        `;
      }

      // 歷史看房快捷新增 (在詳情頁下方)
      const btnAddLog = document.getElementById('btn-add-history-log');
      const logInput = document.getElementById('history-log-notes');
      
      btnAddLog.onclick = async () => {
        const text = logInput.value.trim();
        if (!text) {
          alert('請輸入看房心得！');
          return;
        }

        const newLog = {
          date: new Date().toISOString().split('T')[0],
          notes: text,
          rating: house.rating || 3
        };

        if (!house.history) house.history = [];
        house.history.push(newLog);

        // 同步更新主表備註與日期為最新一次看房心得
        house.notes = text;
        house.visitDate = newLog.date;
        house.updatedAt = Date.now(); // 設定最後修改時間戳記

        await window.houseDB.updateHouse(house);
        logInput.value = '';
        alert('已成功新增看房心得！');

        // 背景同步
        syncWithGoogleDrive().catch(err => console.error(err));

        setupDetailPage(houseId); // 重新渲染本頁
      };
    });
  }

  // 照片輪播器實作
  function setupCarousel(photos) {
    const container = document.getElementById('detail-carousel-inner');
    const dotsContainer = document.getElementById('detail-carousel-dots');
    const btnPrev = document.getElementById('btn-carousel-prev');
    const btnNext = document.getElementById('btn-carousel-next');

    if (photos.length === 0) {
      container.innerHTML = `
        <div class="carousel-slide active" style="display:flex; align-items:center; justify-content:center; color:var(--text-muted); background:var(--bg-primary)">
          <h3>暫無照片</h3>
        </div>
      `;
      dotsContainer.innerHTML = '';
      btnPrev.style.display = 'none';
      btnNext.style.display = 'none';
      return;
    }

    btnPrev.style.display = photos.length > 1 ? 'flex' : 'none';
    btnNext.style.display = photos.length > 1 ? 'flex' : 'none';

    appState.activePhotoIndex = 0;

    // 渲染 Slide
    container.innerHTML = photos.map((photo, index) => `
      <div class="carousel-slide ${index === 0 ? 'active' : ''}">
        <img src="${photo.base64}" alt="${photo.name}">
      </div>
    `).join('');

    // 渲染 Dots
    dotsContainer.innerHTML = photos.map((_, index) => `
      <button class="carousel-dot ${index === 0 ? 'active' : ''}" data-slide="${index}"></button>
    `).join('');

    const slides = container.querySelectorAll('.carousel-slide');
    const dots = dotsContainer.querySelectorAll('.carousel-dot');

    function showSlide(index) {
      // 循環邊界處理
      if (index >= photos.length) index = 0;
      if (index < 0) index = photos.length - 1;
      
      appState.activePhotoIndex = index;

      slides.forEach((slide, i) => {
        slide.classList.toggle('active', i === index);
      });

      dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === index);
      });
    }

    btnPrev.onclick = () => showSlide(appState.activePhotoIndex - 1);
    btnNext.onclick = () => showSlide(appState.activePhotoIndex + 1);

    dots.forEach(dot => {
      dot.onclick = () => {
        const idx = Number(dot.getAttribute('data-slide'));
        showSlide(idx);
      };
    });
  }

  // 詳情頁房貸計算器實作
  function setupMortgageCalculator(housePrice) {
    const loanPercentInput = document.getElementById('calc-loan-percent');
    const loanYearsInput = document.getElementById('calc-loan-years');
    const rateInput = document.getElementById('calc-rate');
    const graceInput = document.getElementById('calc-grace');

    const totalLoanVal = document.getElementById('calc-total-loan');
    const selfPayVal = document.getElementById('calc-self-pay');
    
    const displayGraceArea = document.getElementById('calc-grace-repay-area');
    const monthlyGraceVal = document.getElementById('calc-monthly-grace-payment');
    const monthlyVal = document.getElementById('calc-monthly-payment');
    const totalInterestVal = document.getElementById('calc-total-interest');

    // 預設填入值
    loanPercentInput.value = 80;
    loanYearsInput.value = 30;
    rateInput.value = 2.185;
    graceInput.value = 0;

    function recalculate() {
      const price = Number(housePrice) || 0;
      const loanPercent = Number(loanPercentInput.value) || 80;
      const years = Number(loanYearsInput.value) || 30;
      const rate = Number(rateInput.value) || 2.185;
      const grace = Number(graceInput.value) || 0;

      // 總貸款與自備款計算
      const loanAmount = price * (loanPercent / 100); // 萬元
      const selfPayAmount = price - loanAmount; // 萬元

      totalLoanVal.textContent = `${Math.round(loanAmount)} 萬`;
      selfPayVal.textContent = `${Math.round(selfPayAmount)} 萬`;

      // 呼叫算式計算每月本息
      const result = window.utils.calculateMortgage(loanAmount, rate, years, grace);

      // 顯示利息與攤還額
      monthlyVal.textContent = result.monthlyPayment.toLocaleString() + ' 元';
      totalInterestVal.textContent = `${Math.round(result.totalInterest / 10000 * 100) / 100} 萬`;

      if (grace > 0) {
        displayGraceArea.style.display = 'block';
        monthlyGraceVal.textContent = result.monthlyPaymentGrace.toLocaleString() + ' 元';
      } else {
        displayGraceArea.style.display = 'none';
      }
    }

    // 綁定事件
    [loanPercentInput, loanYearsInput, rateInput, graceInput].forEach(input => {
      input.addEventListener('input', recalculate);
    });

    recalculate(); // 執行首次計算
  }

  // ==========================================================================
  // 房屋比較頁面邏輯 (Compare Page Setup)
  // ==========================================================================
  
  function setupComparePage() {
    const btnBack = document.getElementById('btn-compare-back');
    const tbody = document.getElementById('compare-table-body');
    const thead = document.getElementById('compare-table-head');

    btnBack.onclick = () => window.location.hash = 'dashboard';

    const ids = Array.from(appState.checkedHouseIds);
    if (ids.length < 2) {
      alert('至少需要 2 間房屋才能進行比較！');
      window.location.hash = 'dashboard';
      return;
    }

    // 獲取這些房屋的資料物件
    const selectedHouses = appState.houses.filter(h => ids.includes(h.id));

    // 1. 生成 Header（表頭包含圖片與名稱）
    let headHtml = '<th>比較項目</th>';
    selectedHouses.forEach(h => {
      const coverImg = (h.photos && h.photos.length > 0) ? h.photos[0].base64 : '';
      headHtml += `
        <th>
          <div class="compare-house-header">
            ${coverImg ? `<img src="${coverImg}" class="compare-house-img" alt="${h.community}">` : '<div class="compare-house-img" style="display:flex; align-items:center; justify-content:center; color:var(--text-muted); background:var(--bg-primary); font-size:0.8rem">暫無照片</div>'}
            <div style="font-weight:700">${h.community || h.title}</div>
            <a href="#detail/${h.id}" class="btn btn-secondary" style="padding: 0.25rem 0.6rem; font-size: 0.8rem; border-radius: 4px; display:inline-block; width: fit-content; margin: 0 auto">檢視詳情</a>
          </div>
        </th>
      `;
    });
    thead.innerHTML = `<tr>${headHtml}</tr>`;

    // 2. 比較項目與數值計算
    // 找出各項目最優值
    const minPrice = Math.min(...selectedHouses.map(h => Number(h.price) || Infinity));
    const minPingPrice = Math.min(...selectedHouses.map(h => (Number(h.price) && Number(h.ping)) ? (Number(h.price) / Number(h.ping)) : Infinity));
    const maxPing = Math.max(...selectedHouses.map(h => Number(h.ping) || 0));
    const minAge = Math.min(...selectedHouses.map(h => Number(h.age) || Infinity));
    const minMgmt = Math.min(...selectedHouses.map(h => Number(h.managementFee) || Infinity));
    const maxRating = Math.max(...selectedHouses.map(h => Number(h.rating) || 0));

    // 渲染每一列
    let bodyHtml = '';

    // A. 開價
    bodyHtml += `<tr><td>開價</td>`;
    selectedHouses.forEach(h => {
      const val = Number(h.price) || 0;
      const isBest = val > 0 && val === minPrice;
      bodyHtml += `<td class="${isBest ? 'best-value' : ''}">${val ? `${val} 萬` : '未填寫'}</td>`;
    });
    bodyHtml += `</tr>`;

    // B. 坪數
    bodyHtml += `<tr><td>坪數</td>`;
    selectedHouses.forEach(h => {
      const val = Number(h.ping) || 0;
      const isBest = val > 0 && val === maxPing;
      bodyHtml += `<td class="${isBest ? 'best-value' : ''}">${val ? `${val} 坪` : '未填寫'}</td>`;
    });
    bodyHtml += `</tr>`;

    // C. 單坪價格
    bodyHtml += `<tr><td>單坪價格</td>`;
    selectedHouses.forEach(h => {
      const price = Number(h.price);
      const ping = Number(h.ping);
      const val = (price && ping) ? (price / ping) : 0;
      const isBest = val > 0 && val === minPingPrice;
      bodyHtml += `<td class="${isBest ? 'best-value' : ''}">${val ? `${val.toFixed(2)} 萬/坪` : '無法計算'}</td>`;
    });
    bodyHtml += `</tr>`;

    // D. 屋齡
    bodyHtml += `<tr><td>屋齡</td>`;
    selectedHouses.forEach(h => {
      const val = Number(h.age) || 0;
      const isBest = val > 0 && val === minAge;
      bodyHtml += `<td class="${isBest ? 'best-value' : ''}">${val ? `${val} 年` : '未填寫'}</td>`;
    });
    bodyHtml += `</tr>`;

    // E. 樓層
    bodyHtml += `<tr><td>樓層</td>`;
    selectedHouses.forEach(h => {
      bodyHtml += `<td>${h.floor || '未填寫'}</td>`;
    });
    bodyHtml += `</tr>`;

    // F. 格局
    bodyHtml += `<tr><td>格局</td>`;
    selectedHouses.forEach(h => {
      bodyHtml += `<td>${h.layout || '未填寫'}</td>`;
    });
    bodyHtml += `</tr>`;

    // G. 車位
    bodyHtml += `<tr><td>車位</td>`;
    selectedHouses.forEach(h => {
      bodyHtml += `<td>${h.parking || '未填寫'}</td>`;
    });
    bodyHtml += `</tr>`;

    // H. 管理費
    bodyHtml += `<tr><td>管理費 (月)</td>`;
    selectedHouses.forEach(h => {
      const val = Number(h.managementFee) || 0;
      const isBest = val > 0 && val === minMgmt;
      bodyHtml += `<td class="${isBest ? 'best-value' : ''}">${val ? `${val} 元` : '未填寫'}</td>`;
    });
    bodyHtml += `</tr>`;

    // I. 朝向
    bodyHtml += `<tr><td>朝向</td>`;
    selectedHouses.forEach(h => {
      bodyHtml += `<td>${h.orientation || '未填寫'}</td>`;
    });
    bodyHtml += `</tr>`;

    // J. 裝潢狀況
    bodyHtml += `<tr><td>裝潢狀況</td>`;
    selectedHouses.forEach(h => {
      bodyHtml += `<td>${h.decoration || '未填寫'}</td>`;
    });
    bodyHtml += `</tr>`;

    // K. 評分
    bodyHtml += `<tr><td>評分</td>`;
    selectedHouses.forEach(h => {
      const val = Number(h.rating) || 0;
      const isBest = val > 0 && val === maxRating;
      bodyHtml += `<td class="${isBest ? 'best-value' : ''}">${'★'.repeat(val) + '☆'.repeat(5 - val)}</td>`;
    });
    bodyHtml += `</tr>`;

    // L. 優點
    bodyHtml += `<tr><td>優點</td>`;
    selectedHouses.forEach(h => {
      const prosList = h.pros || [];
      bodyHtml += `<td>${prosList.length > 0 ? prosList.map(p => `• ${p}`).join('<br>') : '無'}</td>`;
    });
    bodyHtml += `</tr>`;

    // M. 缺點
    bodyHtml += `<tr><td>缺點</td>`;
    selectedHouses.forEach(h => {
      const consList = h.cons || [];
      bodyHtml += `<td>${consList.length > 0 ? consList.map(c => `• ${c}`).join('<br>') : '無'}</td>`;
    });
    bodyHtml += `</tr>`;

    // N. 備註
    bodyHtml += `<tr><td>備註摘要</td>`;
    selectedHouses.forEach(h => {
      const note = h.notes || '';
      bodyHtml += `<td><span style="font-size:0.85rem; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden">${note || '無'}</span></td>`;
    });
    bodyHtml += `</tr>`;

    tbody.innerHTML = bodyHtml;
  }

  // ==========================================================================
  // 設定與備份還原邏輯 (Settings Page Setup)
  // ==========================================================================
  
  function setupSettingsPage() {
    const btnBack = document.getElementById('btn-settings-back');
    const btnExport = document.getElementById('btn-settings-export');
    const btnImport = document.getElementById('btn-settings-import');
    const fileImportInput = document.getElementById('settings-import-input');
    const btnClearDB = document.getElementById('btn-settings-clear');

    // Google Drive 同步相關 DOM
    const inputClientId = document.getElementById('settings-gapi-client-id');
    const inputApiKey = document.getElementById('settings-gapi-key');
    const btnSaveKeys = document.getElementById('btn-settings-save-keys');
    const btnLogin = document.getElementById('btn-settings-gapi-login');
    const btnLogout = document.getElementById('btn-settings-gapi-logout');
    const btnSyncNow = document.getElementById('btn-settings-gapi-sync-now');

    btnBack.onclick = () => window.location.hash = 'dashboard';

    // 載入已儲存的金鑰
    const savedClientId = localStorage.getItem('gdrive_client_id');
    const savedApiKey = localStorage.getItem('gdrive_api_key');
    inputClientId.value = savedClientId || '';
    inputApiKey.value = savedApiKey || '';

    // 更新金鑰與登入狀態
    const currentToken = window.utils.getValidToken();
    if (savedClientId && savedApiKey) {
      if (currentToken) {
        handleGapiStatusChange({ status: 'connected', token: currentToken });
      } else {
        // 初始化 Auth
        window.utils.initGoogleDriveAuth(savedClientId, savedApiKey, (res) => {
          handleGapiStatusChange(res);
        });
      }
    } else {
      handleGapiStatusChange({ status: 'error', message: '尚未設定金鑰。' });
    }

    // 儲存金鑰按鈕
    btnSaveKeys.onclick = () => {
      const cid = inputClientId.value.trim();
      const key = inputApiKey.value.trim();
      if (!cid || !key) {
        alert('請填寫 Client ID 與 API Key！');
        return;
      }
      localStorage.setItem('gdrive_client_id', cid);
      localStorage.setItem('gdrive_api_key', key);
      alert('金鑰已儲存，正在初始化 Google API...');
      window.utils.initGoogleDriveAuth(cid, key, (res) => {
        handleGapiStatusChange(res);
      });
    };

    // 登入按鈕
    btnLogin.onclick = () => {
      window.utils.loginGoogle((res) => {
        handleGapiStatusChange(res);
      });
    };

    // 登出按鈕
    btnLogout.onclick = () => {
      if (confirm('確定要登出 Google 帳號嗎？這將會暫停自動雲端同步。')) {
        localStorage.removeItem('gdrive_token');
        localStorage.removeItem('gdrive_token_expires');
        alert('已登出 Google 帳號！');
        
        // 重新初始化回 ready 狀態
        const cid = localStorage.getItem('gdrive_client_id');
        const key = localStorage.getItem('gdrive_api_key');
        window.utils.initGoogleDriveAuth(cid, key, (res) => {
          handleGapiStatusChange(res);
        });
      }
    };

    // 立即同步按鈕
    btnSyncNow.onclick = () => {
      syncWithGoogleDrive();
    };

    // 1. 匯出備份 JSON
    btnExport.onclick = async () => {
      try {
        const data = await window.houseDB.getAllHouses();
        if (data.length === 0) {
          alert('資料庫中目前沒有資料可匯出！');
          return;
        }
        await window.utils.exportBackup(data, `看房資料庫備份_${new Date().toISOString().split('T')[0]}.json`);
      } catch (err) {
        console.error('匯出失敗', err);
        alert('匯出資料庫失敗，請重試！');
      }
    };

    // 2. 匯入備份 JSON
    btnImport.onclick = () => fileImportInput.click();

    fileImportInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (confirm('匯入備份將會覆蓋您目前瀏覽器中的所有看房資料！是否確定繼續？')) {
        try {
          const importedData = await window.utils.importBackup(file);
          
          if (!Array.isArray(importedData)) {
            throw new Error('資料結構必須是陣列格式');
          }

          // 清空資料庫
          await window.houseDB.clearAll();

          // 重新寫入資料
          for (let item of importedData) {
            // 清理掉可能存在的舊 ID，避免主鍵衝突
            delete item.id;
            // 設定修改時間
            if (!item.updatedAt) item.updatedAt = Date.now();
            await window.houseDB.addHouse(item);
          }

          alert('資料備份還原成功！');
          
          // 背景同步
          syncWithGoogleDrive().catch(err => console.error(err));

          window.location.hash = 'dashboard';
        } catch (err) {
          console.error('匯入失敗', err);
          alert(`匯入失敗：${err.message}`);
        }
      }
      fileImportInput.value = ''; // 重置 file input
    };

    // 3. 清空所有資料
    btnClearDB.onclick = async () => {
      if (confirm('⚠️ 警告：這將會永久刪除您所有的看房資料與照片！\n確定要完全清空資料庫嗎？')) {
        const doubleCheck = confirm('真的確定要清空嗎？刪除後無法還原！');
        if (doubleCheck) {
          await window.houseDB.clearAll();
          // 清空已刪除列表
          localStorage.removeItem('deletedHouseIds');
          alert('資料庫已完全清空！');

          // 背景同步
          syncWithGoogleDrive().catch(err => console.error(err));

          window.location.hash = 'dashboard';
        }
      }
    };
  }
});
