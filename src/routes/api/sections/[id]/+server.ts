import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getAdminDb } from "$lib/firebase/server";
import { Timestamp } from "firebase-admin/firestore";

const chunk = <T,>(arr: T[], size: number) => {
	const res: T[][] = [];
	for (let i = 0; i < arr.length; i += size) {
		res.push(arr.slice(i, i + size));
	}
	return res;
};

const collectDocIds = async ({
	db,
	field,
	ids,
}: {
	db: FirebaseFirestore.Firestore;
	field: "sectionId" | "subsectionId";
	ids: string[];
}) => {
	const results: string[] = [];
	for (const group of chunk(ids, 10)) {
		const snap = await db.collection("documents").where(field, "in", group).get();
		results.push(...snap.docs.map((d) => d.id));
	}
	return results;
};

export const DELETE: RequestHandler = async ({ params, url, fetch }) => {
	const { id } = params;
	const userId = url.searchParams.get("userId");
	if (!userId) {
		throw error(400, "userId is required");
	}

	const db = getAdminDb();
	const sectionRef = db.collection("sections").doc(id);
	const sectionSnap = await sectionRef.get();

	if (!sectionSnap.exists) {
		throw error(404, "Section not found");
	}

	if (sectionSnap.data()?.userId !== userId) {
		throw error(403, "Section belongs to another user");
	}

	const childSnap = await db.collection("sections").where("parentId", "==", id).get();
	const childIds = childSnap.docs.map((d) => d.id);

	const targetIds = [id, ...childIds];

	const docIdsBySection = await collectDocIds({ db, field: "sectionId", ids: targetIds });
	const docIdsBySubsection = await collectDocIds({ db, field: "subsectionId", ids: targetIds });

	const docIds = Array.from(new Set([...docIdsBySection, ...docIdsBySubsection]));

	// удаляем документы через существующий API, который чистит B2
	for (const docId of docIds) {
		await fetch(`/api/documents/${docId}`, { method: "DELETE" });
	}

	// удаляем дочерние секции и родителя
	for (const childId of childIds) {
		await db.collection("sections").doc(childId).delete();
	}
	await sectionRef.delete();

	return json({ success: true, deletedDocuments: docIds.length, deletedSections: 1 + childIds.length });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const { id } = params;
	const body = await request.json();
	const { userId, title } = body ?? {};

	if (!userId) {
		throw error(400, "userId is required");
	}
	if (typeof title !== "string" || !title.trim()) {
		throw error(400, "title is required");
	}

	const db = getAdminDb();
	const sectionRef = db.collection("sections").doc(id);
	const sectionSnap = await sectionRef.get();

	if (!sectionSnap.exists) {
		throw error(404, "Section not found");
	}
	if (sectionSnap.data()?.userId !== userId) {
		throw error(403, "Section belongs to another user");
	}

	await sectionRef.update({ title: title.trim(), updatedAt: Timestamp.now() });

	return json({ success: true });
};
