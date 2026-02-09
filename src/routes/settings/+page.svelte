<script lang="ts">
    import { onMount } from "svelte";
    import { getFirebaseAuth, onAuthStateChanged } from "$lib/firebase/client";
    import { Button } from "$lib/components/ui/button/index.js";
    import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
    import type { User } from "firebase/auth";

    let user = $state<User | null>(null);
    let loading = $state(true);
    let error = $state<string | null>(null);
    let keyPhrase = $state("");
    let hasKey = $state(false);
    let saving = $state(false);
    let info = $state<string | null>(null);
    let hasDocuments = $state<boolean | null>(null);
    let checkingDocs = $state(false);
    let generating = $state(false);
    let b2KeyId = $state("");
    let b2ApplicationKey = $state("");
    let b2BucketId = $state("");
    let b2BucketName = $state("");
    let b2Endpoint = $state("");
    let b2Exists = $state(false);
    let b2Saving = $state(false);
    let b2Info = $state<string | null>(null);
    let b2Error = $state<string | null>(null);

    const localKeyKey = "pdf-vault:key";

    const hashKey = async (phrase: string) => {
        const encoder = new TextEncoder();
        const data = encoder.encode(phrase);
        const digest = await crypto.subtle.digest("SHA-256", data);
        return Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
    };

    const loadSettings = async (uid: string) => {
        const res = await fetch(`/api/settings?userId=${encodeURIComponent(uid)}`);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        hasKey = data.exists ?? false;
        if (!hasKey) {
            const cached = localStorage.getItem(localKeyKey);
            if (cached) keyPhrase = cached;
        } else {
            keyPhrase = "";
        }
    };

    const checkDocuments = async (uid: string) => {
        checkingDocs = true;
        try {
            const res = await fetch(`/api/documents?userId=${encodeURIComponent(uid)}&limit=1`);
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            hasDocuments = (data.documents ?? []).length > 0;
        } catch (err) {
            error = err instanceof Error ? err.message : "Не удалось проверить документы";
            hasDocuments = null;
        } finally {
            checkingDocs = false;
        }
    };

    const fetchB2Status = async (uid: string) => {
        try {
            const res = await fetch(`/api/user/b2?userId=${encodeURIComponent(uid)}`);
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            b2Exists = data.exists ?? false;
        } catch (err) {
            b2Error = err instanceof Error ? err.message : "Не удалось загрузить B2 статус";
        }
    };

    const generateSecureKey = async (wordCount = 8) => {
        const response = await fetch(
            "https://raw.githubusercontent.com/bitcoin/bips/master/bip-0039/english.txt"
        );
        const text = await response.text();
        const words = text.trim().split("\n");

        const array = new Uint32Array(wordCount);
        crypto.getRandomValues(array);

        const selectedWords = Array.from(array).map((num) => words[num % words.length]);

        return selectedWords.join("-");
    };

    const saveB2 = async () => {
        if (!user) {
            b2Error = "Войдите, чтобы сохранить B2";
            return;
        }
        if (!b2KeyId || !b2ApplicationKey || !b2BucketId || !b2BucketName) {
            b2Error = "Заполните все обязательные поля";
            return;
        }
        b2Saving = true;
        b2Error = null;
        b2Info = null;
        try {
            const res = await fetch("/api/user/b2", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId: user.uid,
                    keyId: b2KeyId,
                    applicationKey: b2ApplicationKey,
                    bucketId: b2BucketId,
                    bucketName: b2BucketName,
                    endpoint: b2Endpoint || null,
                }),
            });
            if (!res.ok) throw new Error(await res.text());
            b2Exists = true;
            b2Info = "B2 настройки сохранены.";
            b2KeyId = "";
            b2ApplicationKey = "";
            b2BucketId = "";
            b2BucketName = "";
            b2Endpoint = "";
        } catch (err) {
            b2Error = err instanceof Error ? err.message : "Не удалось сохранить B2";
        } finally {
            b2Saving = false;
        }
    };

    const saveKey = async () => {
        if (!user) {
            error = "Войдите, чтобы установить ключ";
            return;
        }
        if (!keyPhrase.trim()) {
            error = "Введите ключ-фразу";
            return;
        }
        saving = true;
        error = null;
        info = null;
        try {
            const hash = await hashKey(keyPhrase.trim());
            const res = await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: user.uid, encryptionKeyHash: hash }),
            });
            if (!res.ok) {
                throw new Error(await res.text());
            }
            hasKey = true;
            localStorage.setItem(localKeyKey, keyPhrase.trim());
            info = "Ключ сохранён. Сохраните его в безопасном месте — восстановление невозможно.";
        } catch (err) {
            error = err instanceof Error ? err.message : "Не удалось сохранить ключ";
        } finally {
            saving = false;
        }
    };

    onMount(() => {
        const auth = getFirebaseAuth();
        if (!auth) {
            error = "Firebase не инициализирован";
            loading = false;
            return;
        }
        const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
            user = nextUser;
            if (!nextUser) {
                loading = false;
                hasKey = false;
                keyPhrase = "";
                hasDocuments = null;
                return;
            }
            try {
                await loadSettings(nextUser.uid);
                if (!hasKey) {
                    await checkDocuments(nextUser.uid);
                } else {
                    hasDocuments = true;
                }
                await fetchB2Status(nextUser.uid);
            } catch (err) {
                error = err instanceof Error ? err.message : "Не удалось загрузить настройки";
            } finally {
                loading = false;
            }
        });
        return () => unsubscribe();
    });
</script>

<div class="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
    <div>
        <h1 class="text-2xl font-semibold">Настройки</h1>
        <p class="text-sm text-muted-foreground">Установите ключ-фразу для шифрования файлов.</p>
    </div>

    {#if loading}
        <p class="text-muted-foreground text-sm">Загружаем настройки...</p>
    {:else if !user}
        <p class="text-muted-foreground text-sm">Войдите, чтобы настроить ключ.</p>
    {:else}
        <div class="rounded-md border border-yellow-400/40 bg-yellow-500/10 px-4 py-3">
            <div class="font-semibold text-sm">Важно</div>
            <div class="text-xs text-muted-foreground">
                Ключ нельзя изменить. Если его потерять — доступ к загруженным файлам будет утрачен.
            </div>
        </div>

        <div class="space-y-3">
            {#if !hasKey}
                <label class="flex flex-col gap-1 text-sm">
                    <span class="text-muted-foreground">Ключ-фраза</span>
                    <div class="flex items-center gap-2">
                        <input
                            class="border-input bg-background text-foreground focus-visible:ring-ring/50 focus-visible:outline-none w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-2"
                            type="text"
                            placeholder="Введите ключ-фразу"
                            bind:value={keyPhrase}
                            disabled={hasDocuments === true}
                        />
                        <Button
                            type="button"
                            variant="outline"
                            onclick={async () => {
                                generating = true;
                                error = null;
                                try {
                                    keyPhrase = await generateSecureKey();
                                } catch (err) {
                                    error =
                                        err instanceof Error ? err.message : "Не удалось сгенерировать ключ";
                                } finally {
                                    generating = false;
                                }
                            }}
                            disabled={generating || hasDocuments === true}
                        >
                            {generating ? "..." : "Gen"}
                        </Button>
                    </div>
                </label>
                <Button
                    variant="default"
                    onclick={saveKey}
                    disabled={
                        saving || checkingDocs || !keyPhrase.trim() || hasDocuments === true
                    }
                >
                    {saving ? "Сохраняем..." : "Сохранить ключ"}
                </Button>
            {:else}
                <div class="rounded-md border border-muted-foreground/30 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    Ключ установлен. Изменение или удаление недоступны.
                </div>
            {/if}
            {#if error}
                <div class="text-destructive text-xs">{error}</div>
            {/if}
            {#if info}
                <div class="text-xs text-muted-foreground">{info}</div>
            {/if}
            {#if checkingDocs}
                <div class="text-xs text-muted-foreground">Проверяем документы...</div>
            {/if}
            {#if hasDocuments === false && !hasKey}
                <div class="text-xs text-muted-foreground">
                    У вас пока нет документов. Перед загрузкой нужно установить ключ.
                </div>
            {/if}
            {#if hasDocuments === true && !hasKey}
                <div class="text-xs text-destructive">
                    У вас уже есть документы. Установить ключ сейчас нельзя, чтобы не потерять доступ к существующим файлам.
                </div>
            {/if}
        </div>

        <div class="mt-6 space-y-2 rounded-md border border-muted-foreground/30 bg-muted/20 p-4">
            <div>
                <h2 class="text-lg font-semibold">Backblaze B2</h2>
                <p class="text-xs text-muted-foreground">
                    Данные сохраняются на сервере в зашифрованном виде. После ввода значения не показываются.
                </p>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
                <label class="flex flex-col gap-1 text-sm">
                    <span class="text-muted-foreground">Key ID</span>
                    <input
                        class="border-input bg-background text-foreground focus-visible:ring-ring/50 focus-visible:outline-none w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-2"
                        bind:value={b2KeyId}
                        placeholder="Key ID"
                    />
                </label>
                <label class="flex flex-col gap-1 text-sm">
                    <span class="text-muted-foreground">Application Key</span>
                    <input
                        class="border-input bg-background text-foreground focus-visible:ring-ring/50 focus-visible:outline-none w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-2"
                        bind:value={b2ApplicationKey}
                        placeholder="Application Key"
                        type="password"
                    />
                </label>
                <label class="flex flex-col gap-1 text-sm">
                    <span class="text-muted-foreground">Bucket ID</span>
                    <input
                        class="border-input bg-background text-foreground focus-visible:ring-ring/50 focus-visible:outline-none w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-2"
                        bind:value={b2BucketId}
                        placeholder="Bucket ID"
                    />
                </label>
                <label class="flex flex-col gap-1 text-sm">
                    <span class="text-muted-foreground">Bucket Name</span>
                    <input
                        class="border-input bg-background text-foreground focus-visible:ring-ring/50 focus-visible:outline-none w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-2"
                        bind:value={b2BucketName}
                        placeholder="Bucket Name"
                    />
                </label>
                <label class="flex flex-col gap-1 text-sm sm:col-span-2">
                    <span class="text-muted-foreground">Endpoint (опционально)</span>
                    <input
                        class="border-input bg-background text-foreground focus-visible:ring-ring/50 focus-visible:outline-none w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-2"
                        bind:value={b2Endpoint}
                        placeholder="https://s3.region.backblazeb2.com"
                    />
                </label>
            </div>
            <div class="flex items-center gap-2">
                <Button variant="default" onclick={saveB2} disabled={b2Saving}>
                    {b2Saving ? "Сохраняем..." : b2Exists ? "Обновить" : "Сохранить"}
                </Button>
                {#if b2Exists}
                    <span class="text-xs text-muted-foreground">Настройки сохранены.</span>
                {/if}
            </div>
            {#if b2Error}
                <div class="text-destructive text-xs">{b2Error}</div>
            {/if}
            {#if b2Info}
                <div class="text-xs text-muted-foreground">{b2Info}</div>
            {/if}
        </div>
    {/if}
</div>
