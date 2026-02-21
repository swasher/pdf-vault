import {
	b2Authorize,
	b2GetDownloadAuthorization,
	getB2Config,
	json,
	verifyUserFromRequest,
} from "./_shared.mjs";

const encodeB2Path = (name) => name.split("/").map((chunk) => encodeURIComponent(chunk)).join("/");
const normalizeBaseUrl = (value) => {
	if (!value || typeof value !== "string") return value;
	const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
	return withProtocol.replace(/\/+$/, "");
};

export default async (request) => {
	if (request.method !== "POST") {
		return new Response("Method not allowed", { status: 405 });
	}

	try {
		const uid = await verifyUserFromRequest(request);
		const { fileName, validDurationInSeconds = 3600 } = await request.json().catch(() => ({}));

		if (!fileName || typeof fileName !== "string") {
			return json({ message: "fileName is required" }, 400);
		}
		if (!fileName.startsWith(`files/${uid}/`)) {
			return json({ message: "Forbidden" }, 403);
		}

		const config = getB2Config();
		const auth = await b2Authorize(config);
		const downloadAuth = await b2GetDownloadAuthorization({
			apiUrl: auth.apiUrl,
			authorizationToken: auth.authorizationToken,
			bucketId: config.bucketId,
			fileNamePrefix: fileName,
			validDurationInSeconds: Math.max(1, Math.min(Number(validDurationInSeconds) || 3600, 86400)),
		});

		const baseDownloadUrl = normalizeBaseUrl(config.endpoint ?? auth.downloadUrl);
		const encodedPath = encodeB2Path(fileName);
		const signedUrl = `${baseDownloadUrl}/file/${config.bucketName}/${encodedPath}?Authorization=${encodeURIComponent(downloadAuth.authorizationToken)}`;

		return json({ downloadUrl: signedUrl });
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unauthorized";
		const status = /token|Unauthorized|bearer|auth/i.test(message) ? 401 : 500;
		return json({ message }, status);
	}
};
