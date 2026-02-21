import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getAdminDb } from "$lib/firebase/server";
import { requireUserId } from "$lib/server/auth";
import { Timestamp } from "firebase-admin/firestore";

export const POST: RequestHandler = async ({ request }) => {
	const userId = await requireUserId({ request });
	const body = await request.json();

	const {
		title,
		description = "",
		tags = [],
		fileSize,
		files,
		metadata = {},
		section = null,
		sectionId = null,
		subsectionId = null,
		encryption = null,
		encrypted = false,
	} = body ?? {};

	if (!title || !files?.pdf || !files?.thumbnail) {
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
		encryption,
		encrypted: Boolean(encrypted || encryption),
		searchTokens: title.toLowerCase().split(/\s+/).filter(Boolean),
		uploadedAt: Timestamp.now(),
	});

	return json({ id: docRef.id });
};

export const GET: RequestHandler = async ({ request, url }) => {
	const userId = await requireUserId({ request });
	const limitParam = Number(url.searchParams.get("limit") ?? 200);
	const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 200;

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
