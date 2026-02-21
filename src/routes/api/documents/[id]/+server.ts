import { env } from "$env/dynamic/private";
import { error, json } from "@sveltejs/kit";
import { getAdminDb } from "$lib/firebase/server";
import { requireUserId } from "$lib/server/auth";
import type { RequestHandler } from "./$types";
import { Timestamp } from "firebase-admin/firestore";

type StoredFile = { name: string; id?: string } | string;

const authorizeB2 = async (fetchFn: typeof fetch) => {
	const keyId = env.BLACKBAZE_KEYID;
	const applicationKey = env.BLACKBAZE_APPLICATIONKEY;

	if (!keyId || !applicationKey) {
		throw error(500, "Backblaze credentials are missing");
	}

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

const ensureFileId = async ({
	fetchFn,
	authData,
	fileName,
	fileId,
	bucketId,
}: {
	fetchFn: typeof fetch;
	authData: { authorizationToken: string; apiUrl: string };
	fileName: string;
	fileId?: string;
	bucketId: string;
}) => {
	if (fileId) return fileId;

	const listResponse = await fetchFn(`${authData.apiUrl}/b2api/v2/b2_list_file_names`, {
		method: "POST",
		headers: {
			Authorization: authData.authorizationToken,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ bucketId, startFileName: fileName, maxFileCount: 1 }),
	});

	if (!listResponse.ok) {
		return null;
	}

	const data = await listResponse.json();
	const match = data.files?.find((f: { fileName: string }) => f.fileName === fileName);
	return match?.fileId ?? null;
};

const deleteFileVersion = async ({
	fetchFn,
	authData,
	fileName,
	fileId,
	bucketId,
}: {
	fetchFn: typeof fetch;
	authData: { authorizationToken: string; apiUrl: string };
	fileName: string;
	fileId?: string | null;
	bucketId: string;
}) => {
	const resolvedId = await ensureFileId({ fetchFn, authData, fileName, fileId: fileId ?? undefined, bucketId });
	if (!resolvedId) {
		return;
	}

	await fetchFn(`${authData.apiUrl}/b2api/v2/b2_delete_file_version`, {
		method: "POST",
		headers: {
			Authorization: authData.authorizationToken,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ fileName, fileId: resolvedId }),
	});
};

export const DELETE: RequestHandler = async ({ params, fetch, request }) => {
	const userId = await requireUserId({ request });
	const { id } = params;
	const db = getAdminDb();
	const docRef = db.collection("documents").doc(id);
	const snap = await docRef.get();

	if (!snap.exists) {
		throw error(404, "Document not found");
	}
	if (snap.data()?.userId !== userId) {
		throw error(403, "Not your document");
	}

	const data = snap.data() as {
		files?: { pdf?: StoredFile; thumbnail?: StoredFile };
	};

	const pdf = data.files?.pdf;
	const thumbnail = data.files?.thumbnail;

	const authData = await authorizeB2(fetch);
	const bucketId = env.BLACKBAZE_BUCKETID;

	if (!bucketId) {
		throw error(500, "Backblaze bucketId missing");
	}

	const extractName = (file: StoredFile | undefined) =>
		file ? (typeof file === "string" ? file : file.name) : null;
	const extractId = (file: StoredFile | undefined) =>
		file && typeof file !== "string" ? file.id ?? null : null;

	const pdfName = extractName(pdf);
	const pdfId = extractId(pdf);
	const thumbName = extractName(thumbnail);
	const thumbId = extractId(thumbnail);

	const deletions: Promise<unknown>[] = [];

	if (pdfName) {
		deletions.push(deleteFileVersion({ fetchFn: fetch, authData, fileName: pdfName, fileId: pdfId, bucketId }));
	}
	if (thumbName) {
		deletions.push(deleteFileVersion({ fetchFn: fetch, authData, fileName: thumbName, fileId: thumbId, bucketId }));
	}

	await Promise.allSettled(deletions);
	await docRef.delete();

	return json({ success: true });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const userId = await requireUserId({ request });
	const { id } = params;
	const body = await request.json();
	const { title, description, tags, sectionId = null, subsectionId = null } = body ?? {};

	if (title !== undefined && typeof title !== "string") throw error(400, "title must be a string");
	if (description !== undefined && typeof description !== "string") throw error(400, "description must be a string");
	if (tags !== undefined && !Array.isArray(tags)) throw error(400, "tags must be an array");

	const db = getAdminDb();
	const docRef = db.collection("documents").doc(id);
	const snap = await docRef.get();
	if (!snap.exists) throw error(404, "Document not found");
	if (snap.data()?.userId !== userId) throw error(403, "Not your document");

	// Ensure section ownership when provided
	const checkSectionOwner = async (section: string | null) => {
		if (!section) return;
		const sectionSnap = await db.collection("sections").doc(section).get();
		if (!sectionSnap.exists) throw error(404, "Section not found");
		if (sectionSnap.data()?.userId !== userId) throw error(403, "Section belongs to another user");
	};
	await checkSectionOwner(sectionId);
	await checkSectionOwner(subsectionId);

	const updatePayload: Record<string, unknown> = {
		updatedAt: Timestamp.now(),
	};
	if (title !== undefined) updatePayload.title = title;
	if (description !== undefined) updatePayload.description = description;
	if (tags !== undefined) updatePayload.tags = tags;
	updatePayload.sectionId = sectionId;
	updatePayload.subsectionId = subsectionId;

	await docRef.update(updatePayload);

	return json({ success: true });
};
