import crypto from "node:crypto";
import { b2Authorize, b2GetUploadUrl, getB2Config, json, verifyUserFromRequest } from "./_shared.mjs";

const getExtension = (filename, fallbackExt) => {
	const index = filename.lastIndexOf(".");
	if (index <= 0 || index === filename.length - 1) return fallbackExt;
	return filename.slice(index).toLowerCase();
};

export default async (request) => {
	if (request.method !== "POST") {
		return new Response("Method not allowed", { status: 405 });
	}

	try {
		const uid = await verifyUserFromRequest(request);
		const { filename = "file.bin", kind = "pdf" } = await request.json().catch(() => ({}));

		const config = getB2Config();
		const auth = await b2Authorize(config);
		const upload = await b2GetUploadUrl({
			apiUrl: auth.apiUrl,
			authorizationToken: auth.authorizationToken,
			bucketId: config.bucketId,
		});

		const extension = kind === "thumbnail" ? ".jpg" : getExtension(filename, ".bin");
		const fileName = `files/${uid}/${crypto.randomUUID()}${extension}`;

		return json({
			uploadUrl: upload.uploadUrl,
			uploadAuthToken: upload.authorizationToken,
			fileName,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unauthorized";
		const status = /token|Unauthorized|bearer|auth/i.test(message) ? 401 : 500;
		return json({ message }, status);
	}
};
