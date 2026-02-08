import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getAdminDb } from "$lib/firebase/server";
import { Timestamp } from "firebase-admin/firestore";

type SettingsDoc = {
	encryptionKeyHash: string;
	createdAt: Timestamp;
};

export const GET: RequestHandler = async ({ url }) => {
	const userId = url.searchParams.get("userId");
	if (!userId) throw error(400, "userId is required");

	const db = getAdminDb();
	const snap = await db.collection("users").doc(userId).collection("settings").doc("encryption").get();

	if (!snap.exists) {
		return json({ exists: false });
	}

	const data = snap.data() as SettingsDoc;

	return json({ exists: true, encryptionKeyHash: data.encryptionKeyHash });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { userId, encryptionKeyHash } = body ?? {};

	if (!userId || !encryptionKeyHash) {
		throw error(400, "userId and encryptionKeyHash are required");
	}

	const db = getAdminDb();
	const docRef = db.collection("users").doc(userId).collection("settings").doc("encryption");
	const snap = await docRef.get();

	if (snap.exists) {
		throw error(409, "Key already set");
	}

	await docRef.set({
		encryptionKeyHash,
		createdAt: Timestamp.now(),
	} satisfies SettingsDoc);

	return json({ success: true });
};
