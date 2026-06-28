/**
 * 看房資料庫 (IndexedDB Wrapper)
 */
const DB_NAME = 'HouseViewingDB';
const DB_VERSION = 1;
const STORE_NAME = 'houses';

class HouseDB {
  constructor() {
    this.db = null;
  }

  init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (event) => {
        console.error('Database error: ' + event.target.errorCode);
        reject(event.target.errorCode);
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      };
    });
  }

  async ensureDb() {
    if (!this.db) {
      await this.init();
    }
  }

  // 取得所有房屋資料
  async getAllHouses() {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  // 取得單一房屋資料
  async getHouse(id) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(Number(id));

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  // 新增房屋資料
  async addHouse(house) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(house);

      request.onsuccess = (event) => {
        resolve(event.target.result); // 回傳自動生成的 ID
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  // 更新房屋資料
  async updateHouse(house) {
    await this.ensureDb();
    // 確保 id 是 Number 型態
    if (house.id) {
      house.id = Number(house.id);
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(house);

      request.onsuccess = () => {
        resolve(true);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  // 刪除房屋資料
  async deleteHouse(id) {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(Number(id));

      request.onsuccess = () => {
        resolve(true);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  // 清空所有資料（用於重置/恢復資料）
  async clearAll() {
    await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        resolve(true);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }
}

// 導出全局實例
window.houseDB = new HouseDB();
window.houseDB.init().catch(err => console.error("Failed to initialize IndexedDB", err));
