import { env } from "$env/dynamic/private";
import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, fetch }) => {
	const name = url.searchParams.get("name");

	if (!name) {
		throw error(400, "name is required");
	}

	const keyId = env.BLACKBAZE_KEYID;
	const applicationKey = env.BLACKBAZE_APPLICATIONKEY;
	const bucketName = env.BLACKBAZE_BUCKETNAME;

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
		`${authData.downloadUrl}/file/${bucketName}/${encodeURIComponent(name)}`,
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
