import { browser } from "$app/environment";
import {
	PUBLIC_FIREBASE_API_KEY,
	PUBLIC_FIREBASE_APP_ID,
	PUBLIC_FIREBASE_AUTH_DOMAIN,
	PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
	PUBLIC_FIREBASE_PROJECT_ID,
	PUBLIC_FIREBASE_STORAGE_BUCKET,
} from "$env/static/public";
import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
	GoogleAuthProvider,
	getAuth,
	onAuthStateChanged,
	signInWithPopup,
	signOut,
	type Auth,
} from "firebase/auth";

const normalizeEnvValue = (value: string): string => value.trim().replace(/^['"]|['"]$/g, "");

const normalizeAuthDomain = (value: string): string => {
	let normalized = normalizeEnvValue(value);
	normalized = normalized.replace(/^https?:\/\//i, "");
	normalized = normalized.replace(/\/+$/, "");
	normalized = normalized.replace(/=+$/, "");
	if (normalized.includes("/")) {
		normalized = normalized.split("/")[0];
	}
	return normalized;
};

const normalizeApiKey = (value: string): string => {
	let normalized = normalizeEnvValue(value);
	// Firebase web API key typically does not end with "=".
	if (/=+$/.test(normalized)) {
		normalized = normalized.replace(/=+$/, "");
	}
	return normalized;
};

const rawApiKey = PUBLIC_FIREBASE_API_KEY;
const rawAuthDomain = PUBLIC_FIREBASE_AUTH_DOMAIN;
const normalizedApiKey = normalizeApiKey(rawApiKey);
const normalizedAuthDomain = normalizeAuthDomain(rawAuthDomain);

if (browser && import.meta.env.DEV) {
	if (rawApiKey !== normalizedApiKey) {
		console.warn("[firebase] PUBLIC_FIREBASE_API_KEY was normalized (removed trailing/invalid characters).");
	}
	if (rawAuthDomain !== normalizedAuthDomain) {
		console.warn(
			"[firebase] PUBLIC_FIREBASE_AUTH_DOMAIN was normalized (removed protocol/path/trailing characters)."
		);
	}
}

const firebaseConfig = {
	apiKey: normalizedApiKey,
	authDomain: normalizedAuthDomain,
	projectId: PUBLIC_FIREBASE_PROJECT_ID,
	storageBucket: PUBLIC_FIREBASE_STORAGE_BUCKET,
	messagingSenderId: PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
	appId: PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let provider: GoogleAuthProvider | null = null;

const getFirebaseApp = () => {
	if (!browser) return null;
	if (!app) {
		app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
	}
	return app;
};

const getFirebaseAuth = () => {
	if (!browser) return null;
	if (!auth) {
		const firebaseApp = getFirebaseApp();
		if (!firebaseApp) return null;
		auth = getAuth(firebaseApp);
	}
	return auth;
};

const getGoogleProvider = () => {
	if (!provider) {
		provider = new GoogleAuthProvider();
	}
	return provider;
};

export {
	getFirebaseAuth,
	getGoogleProvider,
	onAuthStateChanged,
	signInWithPopup,
	signOut,
};
