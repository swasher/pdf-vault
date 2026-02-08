<script lang="ts">
    import { ModeWatcher } from "mode-watcher";
    import * as Sidebar from "$lib/components/ui/sidebar/index.js";
    import AppSidebar from "$lib/components/app-sidebar.svelte";

    import NavMenu from "$lib/components/nav-menu.svelte";

    import "../routes/layout.css";

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
