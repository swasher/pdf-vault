export type EncryptedBlobMeta = {
	encryptedDEK: string;
	dekIV: string;
	fileIV: string;
	algorithm: "AES-GCM-256";
	mimeType: string;
};

const AES_ALGO = "AES-GCM";
const IV_LENGTH = 12;

const toUint8Array = (buffer: ArrayBuffer): Uint8Array<ArrayBuffer> => new Uint8Array(buffer);

export const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
	const bytes = toUint8Array(buffer);
	let binary = "";
	for (const value of bytes) binary += String.fromCharCode(value);
	return btoa(binary);
};

export const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
};

const randomIv = (): Uint8Array<ArrayBuffer> => {
	const iv = new Uint8Array(IV_LENGTH);
	crypto.getRandomValues(iv);
	return new Uint8Array(iv.buffer);
};

export const generateMasterKey = async (): Promise<CryptoKey> =>
	crypto.subtle.generateKey({ name: AES_ALGO, length: 256 }, true, ["encrypt", "decrypt"]);

export const masterKeyToPhrase = async (masterKey: CryptoKey): Promise<string> => {
	const raw = await crypto.subtle.exportKey("raw", masterKey);
	const hex = Array.from(new Uint8Array(raw))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase();
	return hex.match(/.{1,8}/g)?.join("-") ?? hex;
};

export const masterKeyFingerprint = async (masterKey: CryptoKey): Promise<string> => {
	const raw = await crypto.subtle.exportKey("raw", masterKey);
	const digest = await crypto.subtle.digest("SHA-256", raw);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
};

export const phraseToMasterKey = async (phrase: string): Promise<CryptoKey> => {
	const normalized = phrase.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
	if (normalized.length !== 64) {
		throw new Error("Неверная backup phrase");
	}
	const bytes = new Uint8Array(
		normalized.match(/.{2}/g)?.map((chunk) => Number.parseInt(chunk, 16)) ?? []
	);
	return crypto.subtle.importKey("raw", bytes, { name: AES_ALGO, length: 256 }, true, [
		"encrypt",
		"decrypt",
	]);
};

const encryptBytes = async (plain: ArrayBuffer, key: CryptoKey) => {
	const iv = randomIv();
	const encrypted = await crypto.subtle.encrypt({ name: AES_ALGO, iv }, key, plain);
	return { encrypted, iv };
};

const decryptBytes = async (encrypted: ArrayBuffer, key: CryptoKey, iv: Uint8Array<ArrayBuffer>) =>
	crypto.subtle.decrypt({ name: AES_ALGO, iv }, key, encrypted);

const generateDataKey = async (): Promise<CryptoKey> =>
	crypto.subtle.generateKey({ name: AES_ALGO, length: 256 }, true, ["encrypt", "decrypt"]);

const importDataKey = async (raw: ArrayBuffer): Promise<CryptoKey> =>
	crypto.subtle.importKey("raw", raw, { name: AES_ALGO, length: 256 }, false, ["encrypt", "decrypt"]);

export const encryptForStorage = async (
	plainBytes: ArrayBuffer,
	masterKey: CryptoKey,
	mimeType: string
): Promise<{ encryptedBytes: ArrayBuffer; encryption: EncryptedBlobMeta }> => {
	const dataKey = await generateDataKey();
	const { encrypted, iv: fileIv } = await encryptBytes(plainBytes, dataKey);
	const rawDEK = await crypto.subtle.exportKey("raw", dataKey);
	const { encrypted: encryptedDEK, iv: dekIv } = await encryptBytes(rawDEK, masterKey);

	return {
		encryptedBytes: encrypted,
		encryption: {
			encryptedDEK: arrayBufferToBase64(encryptedDEK),
			dekIV: arrayBufferToBase64(dekIv.buffer),
			fileIV: arrayBufferToBase64(fileIv.buffer),
			algorithm: "AES-GCM-256",
			mimeType,
		},
	};
};

export const decryptFromStorage = async (
	encryptedBytes: ArrayBuffer,
	encryption: EncryptedBlobMeta,
	masterKey: CryptoKey
): Promise<ArrayBuffer> => {
	const dekIv = toUint8Array(base64ToArrayBuffer(encryption.dekIV));
	const fileIv = toUint8Array(base64ToArrayBuffer(encryption.fileIV));
	const encryptedDEK = base64ToArrayBuffer(encryption.encryptedDEK);
	const rawDEK = await decryptBytes(encryptedDEK, masterKey, dekIv);
	const dataKey = await importDataKey(rawDEK);
	return decryptBytes(encryptedBytes, dataKey, fileIv);
};
