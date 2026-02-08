import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getAdminDb } from "$lib/firebase/server";
import { Timestamp } from "firebase-admin/firestore";

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();

	const {
		userId,
		title,
		description = "",
		tags = [],
		fileSize,
		files,
		metadata = {},
		section = null,
		sectionId = null,
		subsectionId = null,
	} = body ?? {};

	if (!userId || !title || !files?.pdf || !files?.thumbnail) {
		throw error(400, "Missing required fields");
	}

	const db = getAdminDb();

	const docRef = await db.collection("documents").add({
		userId,
		title,
		description,
		tags,
		fileSize,
		files,
		metadata,
		section,
		sectionId,
		subsectionId,
		searchTokens: title.toLowerCase().split(/\s+/).filter(Boolean),
		uploadedAt: Timestamp.now(),
	});

	return json({ id: docRef.id });
};

export const GET: RequestHandler = async ({ url }) => {
	const userId = url.searchParams.get("userId");
	const limitParam = Number(url.searchParams.get("limit") ?? 200);
	const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 200;

	if (!userId) {
		throw error(400, "userId is required");
	}

	const db = getAdminDb();

	const snapshot = await db
		.collection("documents")
		.where("userId", "==", userId)
		.limit(limit)
		.get();

	const documents = snapshot.docs
		.map((doc) => {
			const data = doc.data();
			const uploadedAt = (data?.uploadedAt as Timestamp | undefined)?.toMillis?.() ?? 0;
			return { id: doc.id, ...data, uploadedAt };
		})
		.sort((a, b) => b.uploadedAt - a.uploadedAt);

	return json({ documents });
};
