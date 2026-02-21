const STORAGE_KEY = "pdf-vault-backup-ack-fingerprint-v1";

const canUseStorage = () => typeof window !== "undefined" && typeof localStorage !== "undefined";

export const isBackupConfirmedFor = (fingerprint: string): boolean => {
	if (!canUseStorage()) return false;
	return localStorage.getItem(STORAGE_KEY) === fingerprint;
};

export const setBackupConfirmedFor = (fingerprint: string): void => {
	if (!canUseStorage()) return;
	localStorage.setItem(STORAGE_KEY, fingerprint);
};

export const clearBackupConfirmed = (): void => {
	if (!canUseStorage()) return;
	localStorage.removeItem(STORAGE_KEY);
};

