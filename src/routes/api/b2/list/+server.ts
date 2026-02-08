import { env } from "$env/dynamic/private";
import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, fetch }) => {
    const keyId = env.BLACKBAZE_KEYID;
    const applicationKey = env.BLACKBAZE_APPLICATIONKEY;
    const bucketId = env.BLACKBAZE_BUCKETID;

    if (!keyId || !applicationKey || !bucketId) {
        throw error(500, "Backblaze credentials are missing");
    }

    const maxFileCountParam = Number(url.searchParams.get("maxFileCount"));
    const maxFileCount =
        Number.isFinite(maxFileCountParam) && maxFileCountParam > 0
            ? Math.min(maxFileCountParam, 1000)
            : 200;
    const startFileName = url.searchParams.get("startFileName") ?? undefined;

    const authHeader = Buffer.from(`${keyId}:${applicationKey}`).toString("base64");
    const authResponse = await fetch(
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

    const authData = await authResponse.json();

    const body: Record<string, unknown> = {
        bucketId,
        maxFileCount,
    };

    if (startFileName) {
        body.startFileName = startFileName;
    }

    const listResponse = await fetch(`${authData.apiUrl}/b2api/v2/b2_list_file_names`, {
        method: "POST",
        headers: {
            Authorization: authData.authorizationToken,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    if (!listResponse.ok) {
        const errorText = await listResponse.text();
        throw error(502, `Failed to list files: ${errorText}`);
    }

    const listData = await listResponse.json();

    const files =
        listData.files?.filter((file: { fileName: string }) => file.fileName.toLowerCase().endsWith(".pdf")) ??
        [];

    return json({
        files: files.map(
            (file: { fileId: string; fileName: string; contentLength?: number }) => {
                const baseName = file.fileName.replace(/\.[^/.]+$/, "");
                return {
                    id: file.fileId,
                    name: file.fileName,
                    size: file.contentLength ?? null,
                    thumbnailName: `${baseName}.jpg`,
                };
            }
        ),
        nextFileName: listData.nextFileName ?? null,
    });
};
