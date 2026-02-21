<script lang="ts">
    import { browser } from "$app/environment";
    import { encryptForStorage } from "$lib/crypto/crypto";
    import {
        createAndStoreMasterKey,
        getStoredMasterKey,
        restoreMasterKeyFromPhrase,
    } from "$lib/crypto/master-key";
    import { authFetch } from "$lib/firebase/auth-fetch";
    import * as FileDropZone from "$lib/components/ui/file-drop-zone/index.js";
    import { getFirebaseAuth, onAuthStateChanged } from "$lib/firebase/client.js";
    import type { User } from "firebase/auth";

    type SectionNode = {
        id: string;
        title: string;
        children: SectionNode[];
    };

    type UploadItem = {
        id: string;
        name: string;
        size: number;
        status: "uploading" | "done" | "error";
        message?: string;
        fileUrl?: string;
        thumbnailUrl?: string;
    };

    type RejectedFile = {
        name: string;
        reason: string;
    };

    let uploads = $state<UploadItem[]>([]);
    let rejected = $state<RejectedFile[]>([]);
    let user = $state<User | null>(null);
    let authError = $state<string | null>(null);
    let sections = $state<SectionNode[]>([]);
    let selectedSectionId = $state<string | null>(null);
    let selectedSubsectionId = $state<string | null>(null);
    let selectedCategory = $state("");
    let masterKey = $state<CryptoKey | null>(null);
    let keyLoading = $state(false);
    let keyError = $state<string | null>(null);
    let backupPhrase = $state<string | null>(null);
    let restorePhrase = $state("");
    let creatingKey = $state(false);
    let restoringKey = $state(false);

    const workerPromise = browser
        ? import("pdfjs-dist/build/pdf.worker.min.mjs?url").then((mod) => mod.default)
        : Promise.resolve(null);
    let pdfjsLib: typeof import("pdfjs-dist") | null = null;

    const loadPdfJs = async () => {
        if (!browser) {
            throw new Error("PDF rendering is only available in the browser");
        }
        if (!pdfjsLib) {
            pdfjsLib = await import("pdfjs-dist");
            const workerSrc = await workerPromise;
            if (workerSrc) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (pdfjsLib as any).GlobalWorkerOptions.workerSrc = workerSrc;
            }
        }
        return pdfjsLib;
    };

    const generateThumbnail = async (file: File) => {
        const pdfjs = await loadPdfJs();
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1);

        const initialViewport = page.getViewport({ scale: 1 });
        const targetWidth = 300;
        const scale = targetWidth / initialViewport.width;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        if (!context) {
            throw new Error("Canvas rendering context not available");
        }

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({ canvasContext: context, viewport, canvas }).promise;

        const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
                (b) => {
                    if (b) resolve(b);
                    else reject(new Error("Failed to create thumbnail blob"));
                },
                "image/jpeg",
                0.85
            );
        });

        const baseName = file.name.replace(/\.[^/.]+$/, "");
        return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
    };

    const updateUpload = (id: string, patch: Partial<UploadItem>) => {
        uploads = uploads.map((item) => (item.id === id ? { ...item, ...patch } : item));
    };

    const loadMasterKey = async () => {
        keyLoading = true;
        keyError = null;
        try {
            masterKey = await getStoredMasterKey();
        } catch (err) {
            keyError = err instanceof Error ? err.message : "Не удалось загрузить ключ";
            masterKey = null;
        } finally {
            keyLoading = false;
        }
    };

    const createKey = async () => {
        creatingKey = true;
        keyError = null;
        try {
            const result = await createAndStoreMasterKey();
            masterKey = result.key;
            backupPhrase = result.phrase;
        } catch (err) {
            keyError = err instanceof Error ? err.message : "Не удалось создать ключ";
        } finally {
            creatingKey = false;
        }
    };

    const restoreKey = async () => {
        if (!restorePhrase.trim()) {
            keyError = "Введите backup phrase";
            return;
        }
        restoringKey = true;
        keyError = null;
        try {
            masterKey = await restoreMasterKeyFromPhrase(restorePhrase.trim());
            restorePhrase = "";
            backupPhrase = null;
        } catch (err) {
            keyError = err instanceof Error ? err.message : "Не удалось восстановить ключ";
        } finally {
            restoringKey = false;
        }
    };

    const requestUploadUrl = async (filename: string, kind: "pdf" | "thumbnail") => {
        const requestInit = {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename, kind }),
        } satisfies RequestInit;

        let response = await authFetch("/.netlify/functions/get-upload-url", requestInit);
        if (response.status === 404) {
            response = await authFetch("/get-upload-url", requestInit);
        }
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.message ?? "Не удалось получить upload URL");
        }
        return response.json() as Promise<{
            uploadUrl: string;
            uploadAuthToken: string;
            fileName: string;
        }>;
    };

    const uploadToB2WithPresignedUrl = async (
        file: File,
        upload: { uploadUrl: string; uploadAuthToken: string; fileName: string }
    ) => {
        const response = await fetch(upload.uploadUrl, {
            method: "POST",
            headers: {
                Authorization: upload.uploadAuthToken,
                "X-Bz-File-Name": encodeURIComponent(upload.fileName),
                "Content-Type": file.type || "b2/x-auto",
                "X-Bz-Content-Sha1": "do_not_verify",
            },
            body: file,
        });
        if (!response.ok) {
            throw new Error(`B2 upload failed (${response.status})`);
        }
        return response.json() as Promise<{ fileId: string; fileName: string }>;
    };

    const uploadFile = async (file: File) => {
        const id = crypto.randomUUID();
        uploads = [...uploads, { id, name: file.name, size: file.size, status: "uploading" }];

        try {
            if (!user) {
                throw new Error("Для загрузки необходимо войти");
            }
            if (!masterKey) {
                throw new Error("Сначала настройте ключ шифрования");
            }
            const thumbnailFile = await generateThumbnail(file);
            const [encryptedPdf, encryptedThumbnail] = await Promise.all([
                encryptForStorage(await file.arrayBuffer(), masterKey, file.type || "application/pdf"),
                encryptForStorage(await thumbnailFile.arrayBuffer(), masterKey, "image/jpeg"),
            ]);
            const [pdfUpload, thumbnailUpload] = await Promise.all([
                requestUploadUrl(file.name, "pdf"),
                requestUploadUrl(thumbnailFile.name, "thumbnail"),
            ]);

            const [pdfResult, thumbnailResult] = await Promise.all([
                uploadToB2WithPresignedUrl(
                    new File([encryptedPdf.encryptedBytes], "file.bin", {
                        type: "application/octet-stream",
                    }),
                    pdfUpload
                ),
                uploadToB2WithPresignedUrl(
                    new File([encryptedThumbnail.encryptedBytes], "thumbnail.bin", {
                        type: "application/octet-stream",
                    }),
                    thumbnailUpload
                ),
            ]);

            const metadataResponse = await authFetch("/api/documents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: file.name.replace(/\.[^/.]+$/, ""),
                    fileSize: file.size,
                    files: {
                        pdf: { name: pdfResult.fileName, id: pdfResult.fileId },
                        thumbnail: { name: thumbnailResult.fileName, id: thumbnailResult.fileId },
                    },
                    metadata: { fileName: file.name },
                    tags: [],
                    sectionId: selectedSectionId,
                    subsectionId: selectedSubsectionId,
                    encrypted: true,
                    encryption: {
                        pdf: encryptedPdf.encryption,
                        thumbnail: encryptedThumbnail.encryption,
                    },
                }),
            });
            if (!metadataResponse.ok) {
                const errorData = await metadataResponse
                    .json()
                    .catch(() => ({ message: "Не удалось сохранить документ" }));
                throw new Error(errorData.message ?? "Не удалось сохранить документ");
            }

            // Обновляем статус с URL файла
            updateUpload(id, {
                status: "done",
                fileUrl: URL.createObjectURL(file),
                thumbnailUrl: URL.createObjectURL(thumbnailFile),
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Upload failed";
            updateUpload(id, { status: "error", message });
        }
    };

    const onUpload: FileDropZone.FileDropZoneRootProps["onUpload"] = async (incoming) => {
        await Promise.allSettled(incoming.map((file) => uploadFile(file)));
    };

    const onFileRejected: FileDropZone.FileDropZoneRootProps["onFileRejected"] = ({ reason, file }) => {
        rejected = [...rejected, { name: file.name, reason }];
    };

    const clearRejected = () => {
        rejected = [];
    };

    const clearUploads = () => {
        uploads = [];
    };

    if (browser) {
        const auth = getFirebaseAuth();
        if (auth) {
            onAuthStateChanged(auth, (nextUser) => {
                user = nextUser;
                authError = nextUser ? null : "Для загрузки войдите в аккаунт";
                if (nextUser) {
                    loadMasterKey();
                    Promise.allSettled([
                        authFetch(`/api/sections`).then((res) =>
                            res.ok ? res.json() : Promise.reject(new Error(res.statusText))
                        ),
                    ])
                        .then(([sectionsResult]) => {
                            if (sectionsResult?.status === "fulfilled") {
                                sections = sectionsResult.value.sections ?? [];
                            }
                        })
                        .catch((err) => console.error("Failed to load sections", err));
                } else {
                    sections = [];
                    selectedSectionId = null;
                    selectedSubsectionId = null;
                    selectedCategory = "";
                    masterKey = null;
                    backupPhrase = null;
                    keyError = null;
                }
            });
        } else {
            authError = "Firebase не инициализирован";
        }
    }
</script>

<div class="flex w-full flex-col gap-4 p-6">
    {#if user && keyLoading}
        <div class="rounded-md border border-muted-foreground/30 bg-muted/30 px-4 py-3 text-sm">
            Проверяем ключ шифрования...
        </div>
    {:else if user && !masterKey}
        <div class="rounded-md border border-muted-foreground/30 bg-muted/30 px-4 py-3 text-sm space-y-3">
            <p class="font-medium">Настройка ключа шифрования</p>
            <p class="text-muted-foreground">
                Для загрузки нужен мастер-ключ. Создайте новый ключ или восстановите его из backup phrase.
            </p>
            <div class="flex flex-wrap items-center gap-2">
                <button
                    class="rounded-md border px-3 py-2 text-xs"
                    onclick={createKey}
                    disabled={creatingKey || restoringKey}
                >
                    {creatingKey ? "Создаем..." : "Создать новый ключ"}
                </button>
                <input
                    class="border-input bg-background text-foreground focus-visible:ring-ring/50 focus-visible:outline-none rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-2 min-w-72"
                    placeholder="Вставьте backup phrase"
                    bind:value={restorePhrase}
                    disabled={creatingKey || restoringKey}
                />
                <button
                    class="rounded-md border px-3 py-2 text-xs"
                    onclick={restoreKey}
                    disabled={creatingKey || restoringKey}
                >
                    {restoringKey ? "Восстанавливаем..." : "Восстановить"}
                </button>
            </div>
            {#if backupPhrase}
                <div class="rounded-md border border-yellow-400/40 bg-yellow-500/10 px-3 py-2 text-xs">
                    <p class="font-medium">Сохраните backup phrase</p>
                    <p class="mt-1 font-mono break-all">{backupPhrase}</p>
                </div>
            {/if}
            {#if keyError}
                <div class="text-destructive text-xs">{keyError}</div>
            {/if}
        </div>
    {/if}

    <div class="flex flex-col gap-2">
        <label class="flex flex-col gap-1 text-sm">
            <span class="text-muted-foreground">Раздел</span>
            <select
                class="border-input bg-background text-foreground focus-visible:ring-ring/50 focus-visible:outline-none w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-2"
                bind:value={selectedCategory}
                onchange={(event) => {
                    const value = (event.currentTarget as HTMLSelectElement).value;
                    if (!value) {
                        selectedSectionId = null;
                        selectedSubsectionId = null;
                        selectedCategory = "";
                        return;
                    }
                    const [type, parentId, childId] = value.split(":");
                    if (type === "section") {
                        selectedSectionId = parentId;
                        selectedSubsectionId = null;
                        selectedCategory = value;
                    } else if (type === "sub" && parentId && childId) {
                        selectedSectionId = parentId;
                        selectedSubsectionId = childId;
                        selectedCategory = value;
                    }
                }}
                disabled={!user}
            >
                <option value="">Без раздела</option>
                {#each sections as section (section.id)}
                    <option value={`section:${section.id}`}>{section.title}</option>
                    {#each section.children as child (child.id)}
                        <option value={`sub:${section.id}:${child.id}`}>
                            {section.title} / {child.title}
                        </option>
                    {/each}
                {/each}
            </select>
        </label>
    </div>

    <FileDropZone.Root
            {onUpload}
            {onFileRejected}
            accept="application/pdf"
            maxFileSize={200 * FileDropZone.MEGABYTE}
            fileCount={uploads.length}
            disabled={!user || keyLoading || !masterKey}
    >
        <FileDropZone.Trigger />
    </FileDropZone.Root>

    {#if authError}
        <div class="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {authError}
        </div>
    {/if}

    {#if uploads.length}
        <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
                <span class="text-sm font-medium">Uploads ({uploads.length})</span>
                <button
                        onclick={clearUploads}
                        class="text-xs text-muted-foreground hover:text-foreground"
                >
                    Clear
                </button>
            </div>
            {#each uploads as item (item.id)}
                <div class="border-border flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <div class="flex flex-col gap-1">
                        <span class="truncate font-medium">{item.name}</span>
                        <span class="text-muted-foreground text-xs">
                            {FileDropZone.displaySize(item.size)}
                        </span>
                        {#if item.fileUrl && item.status === "done"}
                            <a
                                    href={item.fileUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="text-xs text-blue-600 hover:underline"
                            >
                                View file
                            </a>
                        {/if}
                    </div>
                    {#if item.status === "uploading"}
                        <div class="flex items-center gap-2">
                            <div class="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"></div>
                            <span class="text-muted-foreground text-xs">Uploading...</span>
                        </div>
                    {:else if item.status === "done"}
                        <span class="text-green-600 text-xs font-medium">✓ Uploaded</span>
                    {:else}
                        <span class="text-destructive text-xs max-w-xs truncate">
                            ✗ {item.message ?? "Upload failed"}
                        </span>
                    {/if}
                </div>
            {/each}
        </div>
    {/if}

    {#if rejected.length}
        <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
                <span class="text-sm font-medium text-destructive">Rejected Files ({rejected.length})</span>
                <button
                        onclick={clearRejected}
                        class="text-xs text-muted-foreground hover:text-foreground"
                >
                    Clear
                </button>
            </div>
            <div class="flex flex-col gap-1 text-sm">
                {#each rejected as item (item.name)}
                    <div class="text-destructive rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2">
                        <span class="font-medium">{item.name}</span>: {item.reason}
                    </div>
                {/each}
            </div>
        </div>
    {/if}
</div>
