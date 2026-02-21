import { error, type RequestEvent } from "@sveltejs/kit";
import { getAdminAuth } from "$lib/firebase/server";

const getBearerToken = (header: string | null): string | null => {
	if (!header) return null;
	const [scheme, token] = header.split(" ");
	if (scheme?.toLowerCase() !== "bearer" || !token) return null;
	return token;
};

export const requireUserId = async (event: Pick<RequestEvent, "request">): Promise<string> => {
	const token = getBearerToken(event.request.headers.get("authorization"));
	if (!token) {
		throw error(401, "Authorization token is required");
	}

	try {
		const decoded = await getAdminAuth().verifyIdToken(token);
		if (!decoded.uid) throw new Error("Missing uid");
		return decoded.uid;
	} catch {
		throw error(401, "Invalid authorization token");
	}
};

