import { getFirebaseAuth } from "$lib/firebase/client";

const getBearerToken = async () => {
	const auth = getFirebaseAuth();
	const user = auth?.currentUser;
	if (!user) {
		throw new Error("Пользователь не авторизован");
	}
	return user.getIdToken();
};

export const authFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
	const token = await getBearerToken();
	const headers = new Headers(init.headers);
	headers.set("Authorization", `Bearer ${token}`);
	return fetch(input, { ...init, headers });
};

