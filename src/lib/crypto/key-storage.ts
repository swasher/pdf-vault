const DB_NAME = "pdf-vault-crypto";
const DB_VERSION = 1;
const STORE = "keys";
const DEVICE_KEY_ID = "device-key";
const WRAPPED_MASTER_KEY_ID = "wrapped-master-key";

type WrappedMasterKeyRecord = {
	id: typeof WRAPPED_MASTER_KEY_ID;
	wrappedKey: ArrayBuffer;
	iv: ArrayBuffer;
};

const openDb = (): Promise<IDBDatabase> =>
	new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			if (!req.result.objectStoreNames.contains(STORE)) {
				req.result.createObjectStore(STORE, { keyPath: "id" });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});

const storeGet = <T>(store: IDBObjectStore, key: string): Promise<T | undefined> =>
	new Promise((resolve, reject) => {
		const req = store.get(key);
		req.onsuccess = () => resolve(req.result as T | undefined);
		req.onerror = () => reject(req.error);
	});

const storePut = (store: IDBObjectStore, value: unknown): Promise<void> =>
	new Promise((resolve, reject) => {
		const req = store.put(value);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});

const storeDelete = (store: IDBObjectStore, key: string): Promise<void> =>
	new Promise((resolve, reject) => {
		const req = store.delete(key);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});

const getOrCreateDeviceKey = async (store: IDBObjectStore): Promise<CryptoKey> => {
	const existing = await storeGet<{ id: string; key: CryptoKey }>(store, DEVICE_KEY_ID);
	if (existing?.key) return existing.key;

	const key = await crypto.subtle.generateKey(
		{ name: "AES-GCM", length: 256 },
		false,
		["wrapKey", "unwrapKey"]
	);
	await storePut(store, { id: DEVICE_KEY_ID, key });
	return key;
};

const randomIv = () => {
	const iv = new Uint8Array(12);
	crypto.getRandomValues(iv);
	return iv;
};

export const hasStoredMasterKey = async (): Promise<boolean> => {
	const db = await openDb();
	const tx = db.transaction(STORE, "readonly");
	const store = tx.objectStore(STORE);
	const record = await storeGet<WrappedMasterKeyRecord>(store, WRAPPED_MASTER_KEY_ID);
	return !!record?.wrappedKey;
};

export const saveMasterKey = async (masterKey: CryptoKey): Promise<void> => {
	const db = await openDb();
	const tx = db.transaction(STORE, "readwrite");
	const store = tx.objectStore(STORE);
	const deviceKey = await getOrCreateDeviceKey(store);
	const iv = randomIv();
	const wrappedKey = await crypto.subtle.wrapKey("raw", masterKey, deviceKey, {
		name: "AES-GCM",
		iv,
	});
	await storePut(store, {
		id: WRAPPED_MASTER_KEY_ID,
		wrappedKey,
		iv: iv.buffer,
	} satisfies WrappedMasterKeyRecord);
	await new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
};

export const loadMasterKey = async (): Promise<CryptoKey | null> => {
	const db = await openDb();
	const tx = db.transaction(STORE, "readonly");
	const store = tx.objectStore(STORE);
	const wrapped = await storeGet<WrappedMasterKeyRecord>(store, WRAPPED_MASTER_KEY_ID);
	const deviceRecord = await storeGet<{ id: string; key: CryptoKey }>(store, DEVICE_KEY_ID);
	if (!wrapped?.wrappedKey || !wrapped.iv || !deviceRecord?.key) {
		return null;
	}
	const iv = new Uint8Array(wrapped.iv);

	const key = await crypto.subtle.unwrapKey(
		"raw",
		wrapped.wrappedKey,
		deviceRecord.key,
		{ name: "AES-GCM", iv },
		{ name: "AES-GCM", length: 256 },
		true,
		["encrypt", "decrypt"]
	);
	return key;
};

export const clearStoredMasterKey = async (): Promise<void> => {
	const db = await openDb();
	const tx = db.transaction(STORE, "readwrite");
	const store = tx.objectStore(STORE);
	await Promise.all([storeDelete(store, WRAPPED_MASTER_KEY_ID), storeDelete(store, DEVICE_KEY_ID)]);
	await new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
};
