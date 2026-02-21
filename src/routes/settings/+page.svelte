<script lang="ts">
    import { onMount } from "svelte";
    import { getFirebaseAuth, onAuthStateChanged } from "$lib/firebase/client";
    import type { User } from "firebase/auth";

    let user = $state<User | null>(null);
    let loading = $state(true);
    let error = $state<string | null>(null);

    onMount(() => {
        const auth = getFirebaseAuth();
        if (!auth) {
            error = "Firebase не инициализирован";
            loading = false;
            return;
        }
        const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
            user = nextUser;
            loading = false;
        });
        return () => unsubscribe();
    });
</script>

<div class="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
    <div>
        <h1 class="text-2xl font-semibold">Settings</h1>
        <p class="text-sm text-muted-foreground">Страница сведений о текущей архитектуре.</p>
    </div>

    {#if loading}
        <p class="text-muted-foreground text-sm">Проверяем сессию...</p>
    {:else if !user}
        <p class="text-muted-foreground text-sm">Войдите, чтобы использовать приложение.</p>
    {:else if error}
        <div class="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
        </div>
    {:else}
        <div class="space-y-3 rounded-md border border-muted-foreground/30 bg-muted/20 p-4 text-sm">
            <p class="font-medium">Что настроено сейчас</p>
            <ul class="list-disc pl-5 text-muted-foreground">
                <li>B2 credentials задаются только через серверные env-переменные.</li>
                <li>Клиент получает только временные presigned URL через Netlify Functions.</li>
                <li>Все файлы в B2 хранятся в зашифрованном виде (AES-GCM).</li>
            </ul>
            <p class="text-xs text-muted-foreground">
                Восстановление master key делается на странице Upload через backup phrase.
            </p>
        </div>
    {/if}
</div>
