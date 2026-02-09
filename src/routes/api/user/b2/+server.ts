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

	const payload: StoredB2Payload = { keyId, applicationKey, bucketId, bucketName, endpoint };
	try {
		await saveUserB2Credentials(userId, payload);
	} catch (err) {
		const message =
			err instanceof Error ? err.message : "Failed to save credentials (check B2_MASTER_SECRET)";
		throw error(500, message);
	}

	return json({ success: true });
};
