import { generateMasterKey, masterKeyToPhrase, phraseToMasterKey } from "$lib/crypto/crypto";
import {
	clearStoredMasterKey,
	hasStoredMasterKey,
	loadMasterKey,
	saveMasterKey,
} from "$lib/crypto/key-storage";

export const hasMasterKey = async () => hasStoredMasterKey();

export const getStoredMasterKey = async () => loadMasterKey();

export const createAndStoreMasterKey = async () => {
	const key = await generateMasterKey();
	await saveMasterKey(key);
	const phrase = await masterKeyToPhrase(key);
	return { key, phrase };
};

export const restoreMasterKeyFromPhrase = async (phrase: string) => {
	const key = await phraseToMasterKey(phrase);
	await saveMasterKey(key);
	return key;
};

export const removeStoredMasterKey = async () => clearStoredMasterKey();
