import { env } from "$env/dynamic/private";
import { getAdminDb } from "$lib/firebase/server";
import crypto from "crypto";

export type StoredB2Payload = {
	keyId: string;
	applicationKey: string;
	bucketId: string;
	bucketName: string;
	endpoint?: string | null;
};

const MASTER_ENV_KEY = "B2_MASTER_SECRET";

const getMasterKey = () => {
	const secret = env[MASTER_ENV_KEY];
	if (!secret) {
		throw new Error(`Missing ${MASTER_ENV_KEY} env variable`);
	}

	const isHex = /^[0-9a-fA-F]+$/.test(secret) && secret.length % 2 === 0;
	const buf = isHex ? Buffer.from(secret, "hex") : Buffer.from(secret, "utf-8");

	if (buf.length < 32) {
		throw new Error(`${MASTER_ENV_KEY} must be at least 32 bytes (use 64-char hex or longer utf-8)`);
	}

	return buf;
};

const encryptPayload = (data: StoredB2Payload) => {
	const master = getMasterKey();
	if (master.length < 32) throw new Error("Master key must be at least 32 bytes");
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv("aes-256-gcm", master.subarray(0, 32), iv);
	const plaintext = Buffer.from(JSON.stringify(data), "utf-8");
	const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, encrypted, tag]).toString("base64");
};

const decryptPayload = (payload: string): StoredB2Payload => {
	const master = getMasterKey();
	const raw = Buffer.from(payload, "base64");
	const iv = raw.subarray(0, 12);
	const tag = raw.subarray(raw.length - 16);
	const encrypted = raw.subarray(12, raw.length - 16);
	const decipher = crypto.createDecipheriv("aes-256-gcm", master.subarray(0, 32), iv);
	decipher.setAuthTag(tag);
	const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
	return JSON.parse(decrypted.toString("utf-8")) as StoredB2Payload;
};

export const saveUserB2Credentials = async (userId: string, payload: StoredB2Payload) => {
	const db = getAdminDb();
	const docRef = db.collection("users").doc(userId).collection("settings").doc("b2");
	await docRef.set(
		{
			payload: encryptPayload(payload),
			updatedAt: new Date(),
		},
		{ merge: true }
	);
};

export const getUserB2Credentials = async (userId: string): Promise<StoredB2Payload | null> => {
	const db = getAdminDb();
	const docRef = db.collection("users").doc(userId).collection("settings").doc("b2");
	const snap = await docRef.get();
	if (!snap.exists) return null;
	const payload = snap.data()?.payload as string | undefined;
	if (!payload) return null;
	return decryptPayload(payload);
};

export const userHasB2Credentials = async (userId: string) => {
	const creds = await getUserB2Credentials(userId);
	return !!creds;
};

export const getB2CredentialsForUserOrEnv = async (
	userId: string
): Promise<StoredB2Payload | null> => {
	const userCreds = await getUserB2Credentials(userId);
	if (userCreds) return userCreds;

	const keyId = env.BLACKBAZE_KEYID;
	const applicationKey = env.BLACKBAZE_APPLICATIONKEY;
	const bucketId = env.BLACKBAZE_BUCKETID;
	const bucketName = env.BLACKBAZE_BUCKETNAME;
	const endpoint = env.BLACKBAZE_ENDPOINT ?? null;

	if (keyId && applicationKey && bucketId && bucketName) {
		return { keyId, applicationKey, bucketId, bucketName, endpoint };
	}

	return null;
};
