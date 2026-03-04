
const DB_NAME = 'LinkUpDB';
const STORE_NAME = 'history';
const DB_VERSION = 3;

export const initDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            let store;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            } else {
                store = request.transaction!.objectStore(STORE_NAME);
            }

            if (!store.indexNames.contains('userUrn')) {
                store.createIndex('userUrn', 'userUrn', { unique: false });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

export const saveHistory = async (history: any[], userUrn?: string): Promise<void> => {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    // If we have a userUrn, we only want to clear and update history for THAT user
    // However, store.clear() wipes everything. 
    // For simplicity with user-specific history, we should only delete items matching this URN.

    return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => {
            const allItems = request.result;
            // Delete all items for this user (or all items if no user provided, for backward compatibility)
            for (const item of allItems) {
                if (!userUrn || item.userUrn === userUrn) {
                    store.delete(item.id);
                }
            }

            for (const item of history) {
                store.add({ ...item, userUrn });
            }
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

export const getHistory = async (userUrn?: string): Promise<any[]> => {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
        let request;
        if (userUrn) {
            const index = store.index('userUrn');
            request = index.getAll(userUrn);
        } else {
            request = store.getAll();
        }

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};
