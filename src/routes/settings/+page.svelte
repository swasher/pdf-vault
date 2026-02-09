<script lang="ts">
    import { onMount } from "svelte";
    import { getFirebaseAuth, onAuthStateChanged } from "$lib/firebase/client";
    import { Button } from "$lib/components/ui/button/index.js";
    import type { User } from "firebase/auth";

    let user = $state<User | null>(null);
    let loading = $state(true);
    let error = $state<string | null>(null);
    let b2KeyId = $state("");
    let b2ApplicationKey = $state("");
    let b2BucketId = $state("");
    let b2BucketName = $state("");
    let b2Endpoint = $state("");
    let b2Exists = $state(false);
    let b2Saving = $state(false);
    let b2Info = $state<string | null>(null);
    let b2Error = $state<string | null>(null);

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
                return;
            }
            try {
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
        <p class="text-sm text-muted-foreground">Управление доступом к Backblaze B2.</p>
    </div>

    {#if loading}
        <p class="text-muted-foreground text-sm">Загружаем настройки...</p>
    {:else if !user}
        <p class="text-muted-foreground text-sm">Войдите, чтобы настроить.</p>
    {:else}
        <div class="space-y-2 rounded-md border border-muted-foreground/30 bg-muted/20 p-4">
            <div>
                <h2 class="text-lg font-semibold">Backblaze B2</h2>
                <p class="text-xs text-muted-foreground">
                    Креды хранятся на сервере в зашифрованном виде. После ввода значения не показываются.
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
