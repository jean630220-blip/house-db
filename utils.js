/**
 * 工具函數 (Mortgage, Image Compression, Import/Export Utilities)
 */

// 圖片壓縮為 Base64
function compressImage(file, maxWidth = 1000, maxHeight = 1000, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // 計算縮放比例
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // 輸出為 jpeg 格式以達最佳壓縮比
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

/**
 * 房貸試算
 * @param {number} principalInTenThousand - 貸款金額(萬元)
 * @param {number} annualRate - 年利率 (%) e.g. 2.185
 * @param {number} totalYears - 總年限 (年) e.g. 30
 * @param {number} graceYears - 寬限期 (年) e.g. 3
 * @returns {object} 計算結果 { monthlyPayment, monthlyPaymentGrace, totalInterest }
 */
function calculateMortgage(principalInTenThousand, annualRate, totalYears, graceYears = 0) {
  const principal = principalInTenThousand * 10000;
  const monthlyRate = annualRate / 12 / 100;
  const totalMonths = totalYears * 12;
  const graceMonths = graceYears * 12;
  const repayMonths = totalMonths - graceMonths;

  if (principal <= 0 || isNaN(principal)) {
    return { monthlyPayment: 0, monthlyPaymentGrace: 0, totalInterest: 0 };
  }

  // 若利率為 0
  if (monthlyRate === 0) {
    const monthlyPayment = principal / totalMonths;
    const monthlyPaymentGrace = graceMonths > 0 ? 0 : monthlyPayment;
    return {
      monthlyPayment: Math.round(monthlyPayment),
      monthlyPaymentGrace: Math.round(monthlyPaymentGrace),
      totalInterest: 0
    };
  }

  // 1. 寬限期內：只付利息
  let monthlyPaymentGrace = 0;
  if (graceMonths > 0) {
    monthlyPaymentGrace = principal * monthlyRate;
  }

  // 2. 本息平均攤還 (均攤月付額)
  // 公式：[P * r * (1+r)^n] / [(1+r)^n - 1]
  const temp = Math.pow(1 + monthlyRate, repayMonths);
  const monthlyPayment = (principal * monthlyRate * temp) / (temp - 1);

  // 3. 計算總利息
  // 總利息 = 寬限期月付額 * 寬限月數 + 攤還期月付額 * 攤還月數 - 貸款本金
  const totalInterest = (monthlyPaymentGrace * graceMonths) + (monthlyPayment * repayMonths) - principal;

  return {
    monthlyPayment: Math.round(monthlyPayment),
    monthlyPaymentGrace: Math.round(monthlyPaymentGrace),
    totalInterest: Math.round(totalInterest)
  };
}

// 格式化坪數與單價
function formatPingPrice(priceInTenThousand, ping) {
  if (!priceInTenThousand || !ping || ping <= 0) return '-- 萬/坪';
  const unitPrice = priceInTenThousand / ping;
  return `${unitPrice.toFixed(2)} 萬/坪`;
}

// 備份匯出 JSON (支援手機原生分享選單)
async function exportBackup(data, filename = 'house_viewing_backup.json') {
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });

  // 嘗試使用行動端原生分享 (Web Share API)
  if (navigator.canShare && navigator.canShare({ files: [new File([blob], filename, { type: 'application/json' })] })) {
    try {
      const file = new File([blob], filename, { type: 'application/json' });
      await navigator.share({
        files: [file],
        title: '看房資料庫備份',
        text: '這是我的看房資料庫備份檔案，可用於導入還原。'
      });
      return; // 成功分享，結束
    } catch (err) {
      console.log('使用者取消分享或發生錯誤，轉為傳統下載。', err);
    }
  }

  // 傳統下載方式 (PC端或不支援 Web Share 的瀏覽器)
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 檔案讀取 (JSON 匯入)
function importBackup(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        resolve(data);
      } catch (err) {
        reject(new Error('JSON 格式錯誤，請確保您匯入了正確的備份檔。'));
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsText(file);
  });
}

// 生成隨機的 ID（如果 IndexedDB 分配出錯，作為備用）
function generateUniqueId() {
  return Date.now() + Math.random().toString(36).substr(2, 9);
}

// --- Google Drive 同步工具函數 ---

let googleTokenClient = null;

// 初始化 Google Auth Token Client (GIS)
function initGoogleDriveAuth(clientId, apiKey, onStatusChange) {
  if (!clientId || !apiKey) {
    onStatusChange({ status: 'error', message: '尚未設定金鑰' });
    return;
  }

  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
    onStatusChange({ status: 'error', message: 'Google Auth SDK 載入中，請稍候...' });
    return;
  }

  try {
    googleTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (tokenResponse) => {
        if (tokenResponse.error !== undefined) {
          console.error(tokenResponse);
          onStatusChange({ status: 'error', message: '授權失敗：' + tokenResponse.error });
          return;
        }
        const accessToken = tokenResponse.access_token;
        localStorage.setItem('gdrive_token', accessToken);
        localStorage.setItem('gdrive_token_expires', Date.now() + (tokenResponse.expires_in * 1000));
        onStatusChange({ status: 'connected', token: accessToken });
      },
    });
    onStatusChange({ status: 'ready', message: '金鑰設定成功，可進行登入授權。' });
  } catch (err) {
    console.error('GSI Init Error:', err);
    onStatusChange({ status: 'error', message: '初始化失敗，請檢查金鑰格式。' });
  }
}

// 觸發 Google 登入視窗
function loginGoogle(onStatusChange) {
  if (!googleTokenClient) {
    onStatusChange({ status: 'error', message: '請先儲存並設定金鑰！' });
    return;
  }
  googleTokenClient.requestAccessToken({ prompt: 'consent' });
}

// 取得當前有效的 Token
function getValidToken() {
  const token = localStorage.getItem('gdrive_token');
  const expires = Number(localStorage.getItem('gdrive_token_expires') || 0);
  if (token && Date.now() < expires) {
    return token;
  }
  return null;
}

// 搜尋雲端同步檔
async function findSyncFile(token) {
  const url = `https://www.googleapis.com/drive/v3/files?q=name='house_viewing_sync.json'+and+trashed=false&fields=files(id,name)`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('無法搜尋雲端硬碟檔案');
  const result = await res.json();
  return result.files && result.files.length > 0 ? result.files[0] : null;
}

// 下載雲端同步檔內容
async function downloadSyncFile(token, fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('下載同步檔失敗');
  return await res.json();
}

// 上傳或建立雲端同步檔
async function uploadSyncFile(token, data, fileId = null) {
  let activeFileId = fileId;

  // 1. 若無 fileId，先搜尋看看是否已存在檔案，避免重複建立
  if (!activeFileId) {
    const existingFile = await findSyncFile(token);
    if (existingFile) {
      activeFileId = existingFile.id;
    }
  }

  // 2. 若依然無 fileId，代表需建立新檔案
  if (!activeFileId) {
    const metaUrl = 'https://www.googleapis.com/drive/v3/files';
    const metaRes = await fetch(metaUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'house_viewing_sync.json',
        mimeType: 'application/json'
      })
    });
    if (!metaRes.ok) throw new Error('建立雲端同步檔案失敗');
    const metadata = await metaRes.json();
    activeFileId = metadata.id;
  }

  // 3. 上傳檔案內文 (PATCH media)
  const uploadUrl = `https://www.googleapis.com/upload/drive/v3/files/${activeFileId}?uploadType=media`;
  const uploadRes = await fetch(uploadUrl, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
  if (!uploadRes.ok) throw new Error('更新雲端檔案內容失敗');
  
  const result = await uploadRes.json();
  return { fileId: activeFileId, result };
}

// 全局掛載
window.utils = {
  compressImage,
  calculateMortgage,
  formatPingPrice,
  exportBackup,
  importBackup,
  generateUniqueId,
  initGoogleDriveAuth,
  loginGoogle,
  getValidToken,
  findSyncFile,
  downloadSyncFile,
  uploadSyncFile
};
