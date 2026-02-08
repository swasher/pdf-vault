<script lang="ts">
    import { browser } from "$app/environment";
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
    let hasKey = $state<boolean | null>(null);
    let hasDocuments = $state<boolean | null>(null);
    let checking = $state(false);

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

    const deriveKey = async (phrase: string) => {
        const encoder = new TextEncoder();
        const base = encoder.encode(phrase);
        const salt = encoder.encode("pdf-vault-salt");
        const keyMaterial = await crypto.subtle.importKey("raw", base, "PBKDF2", false, ["deriveKey"]);
        return crypto.subtle.deriveKey(
            { name: "PBKDF2", salt, iterations: 200_000, hash: "SHA-256" },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );
    };

    const encryptBytes = async (data: ArrayBuffer, key: CryptoKey) => {
        const nonce = crypto.getRandomValues(new Uint8Array(12));
        const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, data);
        const combined = new Uint8Array(nonce.byteLength + cipher.byteLength);
        combined.set(nonce, 0);
        combined.set(new Uint8Array(cipher), nonce.byteLength);
        return combined;
    };

    const encryptFileWithKey = async (file: File, key: CryptoKey) => {
        const data = await file.arrayBuffer();
        const encrypted = await encryptBytes(data, key);
        return new File([encrypted], file.name, { type: "application/octet-stream" });
    };

    const getKeyPhrase = () => (browser ? localStorage.getItem("pdf-vault:key") ?? "" : "");

    const uploadFile = async (file: File) => {
        const id = crypto.randomUUID();
        uploads = [...uploads, { id, name: file.name, size: file.size, status: "uploading" }];

        try {
            if (!user) {
                throw new Error("Для загрузки необходимо войти");
            }
            const phrase = getKeyPhrase();
            if (!phrase) {
                throw new Error("Сначала задайте ключ в Settings");
            }
            const key = await deriveKey(phrase);
            const thumbnailFile = await generateThumbnail(file);

            // Шифруем
            const encryptedPdf = await encryptFileWithKey(file, key);
            const encryptedThumb = await encryptFileWithKey(thumbnailFile, key);

            // Создаем FormData и отправляем зашифрованные файл и миниатюру
            const formData = new FormData();
            formData.append("file", encryptedPdf);
            formData.append("thumbnail", encryptedThumb);
            formData.append("thumbnailName", thumbnailFile.name);
            formData.append("title", file.name.replace(/\.[^/.]+$/, ""));
            formData.append("userId", user.uid);
            if (selectedSectionId) formData.append("sectionId", selectedSectionId);
            if (selectedSubsectionId) formData.append("subsectionId", selectedSubsectionId);
            formData.append("encrypted", "true");

            const response = await fetch("/api/b2/upload-url", {
                method: "POST",
                body: formData, // Отправляем FormData, а не JSON
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: "Upload failed" }));
                throw new Error(errorData.message || "Upload failed");
            }

            const result = await response.json();

            // Обновляем статус с URL файла
            updateUpload(id, {
                status: "done",
                fileUrl: result.fileUrl,
                thumbnailUrl: result.thumbnail?.fileUrl ?? undefined
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

    const fetchSettings = async (uid: string) => {
        const res = await fetch(`/api/settings?userId=${encodeURIComponent(uid)}`);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        hasKey = data.exists ?? false;
    };

    const checkDocs = async (uid: string) => {
        const res = await fetch(`/api/documents?userId=${encodeURIComponent(uid)}&limit=1`);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        hasDocuments = (data.documents ?? []).length > 0;
    };

    if (browser) {
        const auth = getFirebaseAuth();
        if (auth) {
            onAuthStateChanged(auth, (nextUser) => {
                user = nextUser;
                authError = nextUser ? null : "Для загрузки войдите в аккаунт";
                if (nextUser) {
                    checking = true;
                    Promise.allSettled([
                        fetch(`/api/sections?userId=${encodeURIComponent(nextUser.uid)}`).then((res) =>
                            res.ok ? res.json() : Promise.reject(new Error(res.statusText))
                        ),
                        fetchSettings(nextUser.uid),
                        checkDocs(nextUser.uid),
                    ])
                        .then(([sectionsResult]) => {
                            if (sectionsResult?.status === "fulfilled") {
                                sections = sectionsResult.value.sections ?? [];
                            }
                        })
                        .catch((err) => console.error("Failed to load initial data", err))
                        .finally(() => {
                            checking = false;
                        });
                } else {
                    sections = [];
                    selectedSectionId = null;
                    selectedSubsectionId = null;
                    selectedCategory = "";
                    hasKey = null;
                    hasDocuments = null;
                }
            });
        } else {
            authError = "Firebase не инициализирован";
        }
    }
</script>

<div class="flex w-full flex-col gap-4 p-6">
    {#if hasKey === false && hasDocuments === false}
        <div class="rounded-md border border-muted-foreground/30 bg-muted/30 px-4 py-3 text-sm">
            <p class="font-medium">Требуется ключ</p>
            <p class="text-muted-foreground">Перед загрузкой документов задайте ключ в Settings.</p>
            <a class="text-primary text-sm hover:underline" href="/settings">Перейти в Settings</a>
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
            disabled={!user || hasKey === false && hasDocuments === false}
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
