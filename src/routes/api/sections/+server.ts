import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getAdminDb } from "$lib/firebase/server";
import { Timestamp } from "firebase-admin/firestore";

type SectionRecord = {
	userId: string;
	title: string;
	parentId: string | null;
	order: number;
	createdAt: Timestamp;
};

export const GET: RequestHandler = async ({ url }) => {
	const userId = url.searchParams.get("userId");
	if (!userId) {
		throw error(400, "userId is required");
	}

	const db = getAdminDb();
	const snapshot = await db.collection("sections").where("userId", "==", userId).get();

	const items = snapshot.docs.map((doc) => {
		const data = doc.data() as Partial<SectionRecord>;
		return {
			id: doc.id,
			title: data.title ?? "",
			parentId: data.parentId ?? null,
			order: data.order ?? 0,
		};
	});

	const byParent = new Map<string | null, typeof items>();
	for (const item of items) {
		const key = item.parentId ?? null;
		if (!byParent.has(key)) byParent.set(key, []);
		byParent.get(key)!.push(item);
	}

	const sortByOrder = (list: typeof items[number][]) => list.sort((a, b) => a.order - b.order);

	const buildTree = () =>
		sortByOrder(byParent.get(null) ?? []).map((parent) => ({
			...parent,
			children: sortByOrder(byParent.get(parent.id) ?? []),
		}));

	return json({ sections: buildTree() });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { userId, title, parentId = null } = body ?? {};

	if (!userId || !title) {
		throw error(400, "userId and title are required");
	}

	const db = getAdminDb();

	if (parentId) {
		const parent = await db.collection("sections").doc(parentId).get();
		if (!parent.exists) {
			throw error(404, "Parent section not found");
		}
		if (parent.data()?.userId !== userId) {
			throw error(403, "Parent section belongs to another user");
		}
	}

	const siblingsSnap = await db
		.collection("sections")
		.where("userId", "==", userId)
		.where("parentId", "==", parentId)
		.get();
	const maxOrder = siblingsSnap.docs.reduce((max, doc) => Math.max(max, doc.data()?.order ?? 0), 0);

	const docRef = await db.collection("sections").add({
		userId,
		title,
		parentId,
		order: maxOrder + 1,
		createdAt: Timestamp.now(),
	} satisfies SectionRecord);

	return json({ id: docRef.id });
};
