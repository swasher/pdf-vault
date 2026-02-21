<script lang="ts">
    import { onMount } from "svelte";
    import {
        decryptFromStorage,
        masterKeyFingerprint,
        masterKeyToPhrase,
        type EncryptedBlobMeta,
    } from "$lib/crypto/crypto";
    import { clearBackupConfirmed, isBackupConfirmedFor, setBackupConfirmedFor } from "$lib/crypto/backup-ack";
    import {
        createAndStoreMasterKey,
        getStoredMasterKey,
        parseMasterKeyPhrase,
        removeStoredMasterKey,
        storeMasterKey,
    } from "$lib/crypto/master-key";
    import { authFetch } from "$lib/firebase/auth-fetch";
    import { getFirebaseAuth, onAuthStateChanged } from "$lib/firebase/client";
    import type { User } from "firebase/auth";

    let user = $state<User | null>(null);
    let loading = $state(true);
    let error = $state<string | null>(null);
    let keyLoading = $state(false);
    let keyError = $state<string | null>(null);
    let masterKey = $state<CryptoKey | null>(null);
    let keyFingerprint = $state<string | null>(null);
    let backupPhrase = $state<string | null>(null);
    let backupConfirmed = $state(false);
    let confirmChecked = $state(false);
    let restorePhrase = $state("");
    let creatingKey = $state(false);
    let restoringKey = $state(false);
    let revealingPhrase = $state(false);
    let removingKey = $state(false);

    type FileRef = { name: string; id?: string } | string;
    type DocumentForValidation = {
        files: { pdf: FileRef; thumbnail: FileRef };
        encryption?: {
            pdf?: EncryptedBlobMeta;
            thumbnail?: EncryptedBlobMeta;
        };
    };

    const getFileName = (file: FileRef) => (typeof file === "string" ? file : file.name);
    const isKeyDecryptionError = (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err ?? "");
        return /operationerror|decrypt|cipher|authentication/i.test(message);
    };

    const getSignedDownloadUrl = async (fileName: string) => {
        const requestInit = {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileName }),
        } satisfies RequestInit;

        let response = await authFetch("/.netlify/functions/get-download-url", requestInit);
        if (response.status === 404) {
            response = await authFetch("/get-download-url", requestInit);
        }

        if (!response.ok) {
            throw new Error(`Не удалось получить ссылку для проверки ключа (${response.status})`);
        }

        const data = (await response.json()) as { downloadUrl?: string };
        if (!data.downloadUrl) throw new Error("Сервер не вернул ссылку для проверки ключа");
        return data.downloadUrl;
    };

    const validateMasterKeyAgainstExistingData = async (candidateKey: CryptoKey) => {
        const response = await authFetch("/api/documents?limit=50");
        if (!response.ok) {
            throw new Error("Не удалось проверить ключ: список документов недоступен");
        }

        const data = (await response.json()) as { documents?: DocumentForValidation[] };
        const documents = data.documents ?? [];
        const candidate = documents.find((doc) => doc.encryption?.thumbnail || doc.encryption?.pdf);
        if (!candidate) {
            return;
        }

        const meta = candidate.encryption?.thumbnail ?? candidate.encryption?.pdf;
        const fileRef = candidate.encryption?.thumbnail ? candidate.files.thumbnail : candidate.files.pdf;
        if (!meta || !fileRef) {
            return;
        }

        const downloadUrl = await getSignedDownloadUrl(getFileName(fileRef));
        const encryptedResponse = await fetch(downloadUrl);
        if (!encryptedResponse.ok) {
            throw new Error(`Не удалось скачать файл для проверки ключа (${encryptedResponse.status})`);
        }

        const encryptedBytes = await encryptedResponse.arrayBuffer();
        try {
            await decryptFromStorage(encryptedBytes, meta, candidateKey);
        } catch (err) {
            if (isKeyDecryptionError(err)) {
                throw new Error("Неверный backup phrase: ключ не подходит к существующим файлам.");
            }
            throw err;
        }
    };

    const resetKeyUi = () => {
        keyError = null;
        backupPhrase = null;
        confirmChecked = false;
        restorePhrase = "";
    };

    const refreshKeyState = async () => {
        keyLoading = true;
        keyError = null;
        try {
            masterKey = await getStoredMasterKey();
            if (!masterKey) {
                keyFingerprint = null;
                backupConfirmed = false;
                return;
            }
            keyFingerprint = await masterKeyFingerprint(masterKey);
            backupConfirmed = isBackupConfirmedFor(keyFingerprint);
        } catch (err) {
            keyError = err instanceof Error ? err.message : "Не удалось загрузить ключ";
            masterKey = null;
            keyFingerprint = null;
            backupConfirmed = false;
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
            keyFingerprint = await masterKeyFingerprint(result.key);
            clearBackupConfirmed();
            backupConfirmed = false;
            backupPhrase = result.phrase;
            confirmChecked = false;
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
            const key = await parseMasterKeyPhrase(restorePhrase.trim());
            await validateMasterKeyAgainstExistingData(key);
            await storeMasterKey(key);
            masterKey = key;
            keyFingerprint = await masterKeyFingerprint(key);
            if (keyFingerprint) {
                setBackupConfirmedFor(keyFingerprint);
            }
            backupConfirmed = true;
            restorePhrase = "";
            backupPhrase = null;
            confirmChecked = false;
        } catch (err) {
            keyError = err instanceof Error ? err.message : "Не удалось восстановить ключ";
        } finally {
            restoringKey = false;
        }
    };

    const revealBackupPhrase = async () => {
        if (!masterKey) return;
        revealingPhrase = true;
        keyError = null;
        try {
            backupPhrase = await masterKeyToPhrase(masterKey);
            confirmChecked = false;
        } catch (err) {
            keyError = err instanceof Error ? err.message : "Не удалось показать backup phrase";
        } finally {
            revealingPhrase = false;
        }
    };

    const confirmBackupSaved = () => {
        if (!keyFingerprint || !backupPhrase || !confirmChecked) {
            keyError = "Подтвердите, что сохранили backup phrase";
            return;
        }
        setBackupConfirmedFor(keyFingerprint);
        backupConfirmed = true;
        backupPhrase = null;
        confirmChecked = false;
        keyError = null;
    };

    const removeKeyFromDevice = async () => {
        if (!masterKey) return;
        const confirmed = window.confirm(
            "Удалить master key с этого устройства? После этого чтение/загрузка файлов будут недоступны, пока вы не восстановите ключ по backup phrase."
        );
        if (!confirmed) return;

        removingKey = true;
        keyError = null;
        try {
            await removeStoredMasterKey();
            clearBackupConfirmed();
            masterKey = null;
            keyFingerprint = null;
            backupConfirmed = false;
            backupPhrase = null;
            confirmChecked = false;
        } catch (err) {
            keyError = err instanceof Error ? err.message : "Не удалось удалить ключ с устройства";
        } finally {
            removingKey = false;
        }
    };

    $effect(() => {
        if (typeof window === "undefined") return;
        if (!user || !masterKey || backupConfirmed) return;

        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = "";
        };

        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    });

    onMount(() => {
        const auth = getFirebaseAuth();
        if (!auth) {
            error = "Firebase не инициализирован";
            loading = false;
            return;
        }
        const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
            user = nextUser;
            resetKeyUi();
            if (!nextUser) {
                masterKey = null;
                keyFingerprint = null;
                backupConfirmed = false;
                loading = false;
                return;
            }
            await refreshKeyState();
            loading = false;
        });
        return () => unsubscribe();
    });
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
    <div>
        <h1 class="text-2xl font-semibold">Settings</h1>
        <p class="text-sm text-muted-foreground">
            Управление master key и backup phrase. Без них доступ к зашифрованным файлам будет потерян.
        </p>
    </div>

    {#if loading}
        <p class="text-muted-foreground text-sm">Проверяем сессию...</p>
    {:else if !user}
        <p class="text-muted-foreground text-sm">Войдите, чтобы управлять ключом.</p>
    {:else if error}
        <div class="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
        </div>
    {:else}
        {#if keyLoading}
            <div class="rounded-md border border-muted-foreground/30 bg-muted/30 px-4 py-3 text-sm">
                Проверяем ключ шифрования...
            </div>
        {/if}

        {#if !keyLoading && !masterKey}
            <div class="rounded-md border border-muted-foreground/30 bg-muted/20 p-4 space-y-3">
                <p class="font-medium">Ключ шифрования не настроен</p>
                <p class="text-sm text-muted-foreground">
                    Создайте новый ключ или восстановите из backup phrase. Без ключа вы не сможете загружать и читать
                    зашифрованные файлы.
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
            </div>
        {/if}

        {#if masterKey}
            <div class="rounded-md border border-muted-foreground/30 bg-muted/20 p-4 space-y-3">
                <p class="font-medium">Master key активен</p>
                {#if backupConfirmed}
                    <div class="rounded-md border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm">
                        Backup phrase подтверждена на этом устройстве.
                    </div>
                {:else}
                    <div class="rounded-md border border-yellow-400/40 bg-yellow-500/10 px-3 py-2 text-sm">
                        Внимание: backup phrase не подтверждена. Без нее вы потеряете доступ к файлам на новом
                        устройстве.
                    </div>
                {/if}
                <div class="flex flex-wrap items-center gap-2">
                    <button
                        class="rounded-md border px-3 py-2 text-xs"
                        onclick={revealBackupPhrase}
                        disabled={revealingPhrase || removingKey}
                    >
                        {revealingPhrase ? "Показываем..." : "Показать backup phrase"}
                    </button>
                    {#if backupPhrase}
                        <button
                            class="rounded-md border px-3 py-2 text-xs"
                            onclick={() => {
                                backupPhrase = null;
                                confirmChecked = false;
                            }}
                        >
                            Скрыть
                        </button>
                    {/if}
                </div>
                {#if backupPhrase}
                    <div class="rounded-md border border-yellow-400/40 bg-yellow-500/10 px-3 py-2 text-xs space-y-2">
                        <p class="font-medium">Сохраните backup phrase в менеджере паролей</p>
                        <p class="font-mono break-all">{backupPhrase}</p>
                        {#if !backupConfirmed}
                            <label class="flex items-center gap-2 text-xs">
                                <input type="checkbox" bind:checked={confirmChecked} />
                                <span>Я сохранил backup phrase и понимаю, что без нее восстановление невозможно.</span>
                            </label>
                            <button class="rounded-md border px-3 py-2 text-xs" onclick={confirmBackupSaved}>
                                Подтвердить сохранение
                            </button>
                        {/if}
                    </div>
                {/if}
                <div class="border-t border-border/60 pt-3">
                    <button
                        class="rounded-md border border-red-500/40 px-3 py-2 text-xs text-red-600 hover:bg-red-500/10"
                        onclick={removeKeyFromDevice}
                        disabled={removingKey}
                    >
                        {removingKey ? "Удаляем..." : "Удалить ключ с этого устройства"}
                    </button>
                </div>
            </div>
        {/if}

        {#if keyError}
            <div class="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {keyError}
            </div>
        {/if}
    {/if}
</div>
