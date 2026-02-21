<script lang="ts">
    import { onMount } from "svelte";
    import { ModeWatcher } from "mode-watcher";
    import * as Sidebar from "$lib/components/ui/sidebar/index.js";
    import AppSidebar from "$lib/components/app-sidebar.svelte";

    import NavMenu from "$lib/components/nav-menu.svelte";

    import "../routes/layout.css";

    const CHUNK_RELOAD_GUARD_KEY = "pdf-vault:chunk-reload-attempted";

    function attemptChunkRecoveryReload(): void {
        try {
            if (sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY) === "1") {
                sessionStorage.removeItem(CHUNK_RELOAD_GUARD_KEY);
                return;
            }

            sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, "1");
        } catch {
            // Ignore storage access failures and continue with reload.
        }

        window.location.reload();
    }

    onMount(() => {
        const onPreloadError = (event: Event) => {
            event.preventDefault();
            attemptChunkRecoveryReload();
        };

        const onUnhandledRejection = (event: PromiseRejectionEvent) => {
            const reason = event.reason;
            const message =
                typeof reason === "string"
                    ? reason
                    : reason instanceof Error
                      ? reason.message
                      : "";

            if (message.includes("Failed to fetch dynamically imported module")) {
                event.preventDefault();
                attemptChunkRecoveryReload();
            }
        };

        const onPageShow = () => {
            try {
                sessionStorage.removeItem(CHUNK_RELOAD_GUARD_KEY);
            } catch {
                // Ignore storage access failures.
            }
        };

        window.addEventListener("vite:preloadError", onPreloadError);
        window.addEventListener("unhandledrejection", onUnhandledRejection);
        window.addEventListener("pageshow", onPageShow);

        return () => {
            window.removeEventListener("vite:preloadError", onPreloadError);
            window.removeEventListener("unhandledrejection", onUnhandledRejection);
            window.removeEventListener("pageshow", onPageShow);
        };
    });

    let { children } = $props();
</script>


<Sidebar.Provider
    class="flex min-h-svh w-full"
    style="--sidebar-width: 15rem; --sidebar-width-mobile: 20rem; --app-header-height: 3.5rem;"
>
    <ModeWatcher />
    <AppSidebar />
    <Sidebar.Inset class="flex min-h-0 flex-1 flex-col">
        <NavMenu />
        <div class="flex min-h-0 flex-1 flex-col">
            {@render children?.()}
        </div>
    </Sidebar.Inset>
</Sidebar.Provider>
