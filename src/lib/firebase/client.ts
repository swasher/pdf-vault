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

const firebaseConfig = {
	apiKey: PUBLIC_FIREBASE_API_KEY,
	authDomain: PUBLIC_FIREBASE_AUTH_DOMAIN,
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
