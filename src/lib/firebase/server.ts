import { env } from "$env/dynamic/private";
import { initializeApp, cert, getApps, type App as AdminApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

let adminApp: AdminApp | null = null;

const getAdminApp = () => {
	if (adminApp) return adminApp;

	const credentialsPath = env.FIREBASE_ADMIN_CREDENTIALS_PATH;
	if (!credentialsPath) {
		throw new Error("FIREBASE_ADMIN_CREDENTIALS_PATH is not set");
	}

	const absolutePath = resolve(process.cwd(), credentialsPath);
	if (!existsSync(absolutePath)) {
		throw new Error(`Firebase admin credentials not found at ${absolutePath}`);
	}

	const serviceAccount = JSON.parse(readFileSync(absolutePath, "utf-8"));

	adminApp = getApps().length
		? getApps()[0]!
		: initializeApp({
				credential: cert(serviceAccount),
			});

	return adminApp;
};

const getAdminAuth = () => getAuth(getAdminApp());
const getAdminDb = () => getFirestore(getAdminApp());

export { getAdminApp, getAdminAuth, getAdminDb };
