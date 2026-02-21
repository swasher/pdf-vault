import { env } from "$env/dynamic/private";
import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import crypto from "crypto";
import { getB2CredentialsForUserOrEnv } from "$lib/server/b2-creds";

const getAuthData = async (fetchFn: typeof fetch, keyId: string, applicationKey: string) => {
	const authHeader = Buffer.from(`${keyId}:${applicationKey}`).toString("base64");
	const authResponse = await fetchFn(
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

	return authResponse.json();
};

const uploadToB2 = async ({
	fetchFn,
	authData,
	bucketId,
	file,
	fileName,
}: {
	fetchFn: typeof fetch;
	authData: { authorizationToken: string; apiUrl: string };
	bucketId: string;
	file: File;
	fileName: string;
}) => {
	const uploadResponse = await fetchFn(`${authData.apiUrl}/b2api/v2/b2_get_upload_url`, {
		method: "POST",
		headers: {
			Authorization: authData.authorizationToken,
		},
		body: JSON.stringify({ bucketId }),
	});

	if (!uploadResponse.ok) {
		const errorText = await uploadResponse.text();
		throw error(502, `Failed to get upload URL: ${errorText}`);
	}

	const uploadData = await uploadResponse.json();

	const fileBuffer = await file.arrayBuffer();
	const fileData = Buffer.from(fileBuffer);
	const sha1 = crypto.createHash("sha1").update(fileData).digest("hex");

	const uploadFileResponse = await fetchFn(uploadData.uploadUrl, {
		method: "POST",
		headers: {
			Authorization: uploadData.authorizationToken,
			"X-Bz-File-Name": encodeURIComponent(fileName),
			"Content-Type": file.type || "b2/x-auto",
			"Content-Length": fileData.length.toString(),
			"X-Bz-Content-Sha1": sha1,
		},
		body: fileData,
	});

	if (!uploadFileResponse.ok) {
		const errorText = await uploadFileResponse.text();
		throw error(502, `File upload failed: ${errorText}`);
	}

	return uploadFileResponse.json();
};

export const POST: RequestHandler = async ({ request, fetch }) => {
	const formData = await request.formData();
	const file = formData.get("file") as File | null;
	const thumbnail = formData.get("thumbnail") as File | null;
	const thumbnailNameFromClient = formData.get("thumbnailName")?.toString();
	const title = formData.get("title")?.toString();
	const userId = formData.get("userId")?.toString();
	const encrypted = formData.get("encrypted")?.toString() === "true";
	const sectionId = formData.get("sectionId")?.toString() || null;
	const subsectionId = formData.get("subsectionId")?.toString() || null;

	if (!file) {
		throw error(400, "file is required");
	}
	if (!userId) {
		throw error(400, "userId is required");
	}
	if (!title) {
		throw error(400, "title is required");
	}

	const creds = await getB2CredentialsForUserOrEnv(userId);
	if (!creds) {
		throw error(400, "B2 credentials are missing");
	}

	const { keyId, applicationKey, bucketId, bucketName, endpoint } = creds;
	const authData = await getAuthData(fetch, keyId, applicationKey);

	const baseName = file.name.replace(/\.[^/.]+$/, "");
	const pdfFileName = file.name;
	const thumbnailFileName = thumbnailNameFromClient || `${baseName}.jpg`;

	const pdfResult = await uploadToB2({
		fetchFn: fetch,
		authData,
		bucketId,
		file,
		fileName: pdfFileName,
	});

	let thumbnailResult: { fileId: string; fileName: string } | null = null;

	if (thumbnail) {
		thumbnailResult = await uploadToB2({
			fetchFn: fetch,
			authData,
			bucketId,
			file: thumbnail,
			fileName: thumbnailFileName,
		});
	}

	const localFileUrl = `/api/b2/file?name=${encodeURIComponent(pdfResult.fileName)}`;
	const localThumbnailUrl = thumbnailResult
		? `/api/b2/file?name=${encodeURIComponent(thumbnailResult.fileName)}`
		: null;

	if (thumbnailResult) {
		// Сохраняем метаданные в Firestore
		const payload = {
			userId,
			title,
			fileSize: file.size,
			files: {
				pdf: { name: pdfResult.fileName, id: pdfResult.fileId },
				thumbnail: { name: thumbnailResult.fileName, id: thumbnailResult.fileId },
			},
			metadata: {
				fileName: file.name,
			},
			tags: [],
			sectionId,
			subsectionId,
			encrypted,
		};

		await fetch("/api/documents", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(request.headers.get("authorization")
					? { Authorization: request.headers.get("authorization")! }
					: {}),
			},
			body: JSON.stringify(payload),
		});
	}

	return json({
		success: true,
		fileId: pdfResult.fileId,
		fileName: pdfResult.fileName,
		fileUrl: localFileUrl,
		thumbnail: thumbnailResult
			? {
					fileId: thumbnailResult.fileId,
					fileName: thumbnailResult.fileName,
					fileUrl: localThumbnailUrl,
				}
			: null,
		downloadUrl: `${endpoint ?? authData.downloadUrl}/file/${bucketName}/${pdfResult.fileName}`,
	});
};
