import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const getJsonFromEnv = (value) => {
	if (!value) return null;
	try {
		return JSON.parse(value);
	} catch {
		try {
			return JSON.parse(Buffer.from(value, "base64").toString("utf-8"));
		} catch {
			return null;
		}
	}
};

const loadFirebaseCredentials = () => {
	const inline = process.env.FIREBASE_ADMIN_CREDENTIALS;
	const parsedInline = getJsonFromEnv(inline);
	if (parsedInline) return parsedInline;

	const credentialsPath = process.env.FIREBASE_ADMIN_CREDENTIALS_PATH;
	if (!credentialsPath) {
		throw new Error("Missing FIREBASE_ADMIN_CREDENTIALS or FIREBASE_ADMIN_CREDENTIALS_PATH");
	}

	const absolutePath = resolve(process.cwd(), credentialsPath);
	if (!existsSync(absolutePath)) {
		throw new Error(`Firebase admin credentials not found at ${absolutePath}`);
	}

	return JSON.parse(readFileSync(absolutePath, "utf-8"));
};

const getAdminApp = () => {
	if (getApps().length) return getApps()[0];
	return initializeApp({ credential: cert(loadFirebaseCredentials()) });
};

export const verifyUserFromRequest = async (request) => {
	const header = request.headers.get("authorization");
	if (!header?.toLowerCase().startsWith("bearer ")) {
		throw new Error("Missing bearer token");
	}

	const token = header.slice(7).trim();
	if (!token) throw new Error("Missing bearer token");

	const decoded = await getAuth(getAdminApp()).verifyIdToken(token);
	if (!decoded.uid) throw new Error("Invalid token payload");
	return decoded.uid;
};

export const getB2Config = () => {
	const keyId = process.env.B2_KEY_ID ?? null;
	const applicationKey = process.env.B2_APP_KEY ?? null;
	const bucketId = process.env.B2_BUCKET_ID ?? null;
	const bucketName = process.env.B2_BUCKET_NAME ?? null;
	const endpoint = process.env.B2_ENDPOINT ?? null;

	if (!keyId || !applicationKey || !bucketId || !bucketName) {
		throw new Error("Missing B2 credentials");
	}

	return { keyId, applicationKey, bucketId, bucketName, endpoint };
};

export const b2Authorize = async ({ keyId, applicationKey }) => {
	const authHeader = Buffer.from(`${keyId}:${applicationKey}`).toString("base64");
	const response = await fetch("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", {
		headers: { Authorization: `Basic ${authHeader}` },
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`B2 authorization failed: ${text}`);
	}

	return response.json();
};

export const b2GetUploadUrl = async ({ apiUrl, authorizationToken, bucketId }) => {
	const response = await fetch(`${apiUrl}/b2api/v2/b2_get_upload_url`, {
		method: "POST",
		headers: {
			Authorization: authorizationToken,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ bucketId }),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`b2_get_upload_url failed: ${text}`);
	}

	return response.json();
};

export const b2GetDownloadAuthorization = async ({
	apiUrl,
	authorizationToken,
	bucketId,
	fileNamePrefix,
	validDurationInSeconds,
}) => {
	const response = await fetch(`${apiUrl}/b2api/v2/b2_get_download_authorization`, {
		method: "POST",
		headers: {
			Authorization: authorizationToken,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ bucketId, fileNamePrefix, validDurationInSeconds }),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`b2_get_download_authorization failed: ${text}`);
	}

	return response.json();
};

export const json = (payload, status = 200) =>
	new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
