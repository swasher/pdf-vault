import { env } from "$env/dynamic/private";
import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getB2CredentialsForUserOrEnv } from "$lib/server/b2-creds";

export const GET: RequestHandler = async ({ url, fetch }) => {
	const name = url.searchParams.get("name");
	const userId = url.searchParams.get("userId");

	if (!name) {
		throw error(400, "name is required");
	}

	if (!userId) {
		throw error(400, "userId is required");
	}

	const creds = await getB2CredentialsForUserOrEnv(userId);
	if (!creds) {
		throw error(400, "B2 credentials are missing");
	}

	const { keyId, applicationKey, bucketName, endpoint } = creds;

	if (!keyId || !applicationKey || !bucketName) {
		throw error(500, "Backblaze credentials are missing");
	}

	const authHeader = Buffer.from(`${keyId}:${applicationKey}`).toString("base64");
	const authResponse = await fetch(
		"https://api.backblazeb2.com/b2api/v2/b2_authorize_account",
		{
			headers: {
				Authorization: `Basic ${authHeader}`,
			},
		}
	);

	if (!authResponse.ok) {
		throw error(502, "Backblaze authorization failed");
	}

	const authData = await authResponse.json();

	const fileResponse = await fetch(
		`${endpoint ?? authData.downloadUrl}/file/${bucketName}/${encodeURIComponent(name)}`,
		{
			headers: {
				Authorization: authData.authorizationToken,
			},
		}
	);

	if (!fileResponse.ok) {
		throw error(fileResponse.status === 404 ? 404 : 502, "Failed to fetch file");
	}

	const arrayBuffer = await fileResponse.arrayBuffer();

	const contentType = fileResponse.headers.get("content-type") || "application/octet-stream";
	const contentLength = fileResponse.headers.get("content-length");
	const etag = fileResponse.headers.get("etag");

	const headers: Record<string, string> = {
		"Content-Type": contentType,
		"Cache-Control": "public, max-age=31536000, immutable",
	};

	if (contentLength) {
		headers["Content-Length"] = contentLength;
	}
	if (etag) {
		headers["ETag"] = etag;
	}

	return new Response(arrayBuffer, { headers });
};
