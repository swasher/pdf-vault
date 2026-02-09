import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
	getUserB2Credentials,
	saveUserB2Credentials,
	type StoredB2Payload,
} from "$lib/server/b2-creds";

export const GET: RequestHandler = async ({ url }) => {
	const userId = url.searchParams.get("userId");
	if (!userId) throw error(400, "userId is required");

	const creds = await getUserB2Credentials(userId);
	return json({ exists: !!creds });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { userId, keyId, applicationKey, bucketId, bucketName, endpoint = null } = body ?? {};

	if (!userId || !keyId || !applicationKey || !bucketId || !bucketName) {
		throw error(400, "userId, keyId, applicationKey, bucketId, bucketName are required");
	}

	const master = process.env.B2_MASTER_SECRET;
	const isMasterValid = (() => {
		if (!master) return false;
		if (master.length >= 32) return true;
		try {
			return Buffer.from(master, "hex").length >= 32;
		} catch {
			return false;
		}
	})();
	if (!isMasterValid) {
		throw error(500, "B2 master secret is missing or too short (set B2_MASTER_SECRET env)");
	}

	const payload: StoredB2Payload = { keyId, applicationKey, bucketId, bucketName, endpoint };
	await saveUserB2Credentials(userId, payload);

	return json({ success: true });
};
