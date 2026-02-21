<script lang="ts">
    import { onMount } from "svelte";
    import MoonIcon from "@lucide/svelte/icons/moon";
    import SunIcon from "@lucide/svelte/icons/sun";
    import { toggleMode } from "mode-watcher";
    import { goto } from "$app/navigation";
    import { page } from "$app/stores";
    import * as Avatar from "$lib/components/ui/avatar/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
    import * as NavigationMenu from "$lib/components/ui/navigation-menu/index.js";
    import { Separator } from "$lib/components/ui/separator/index.js";
    import * as Sidebar from "$lib/components/ui/sidebar/index.js";
    import {
        getFirebaseAuth,
        getGoogleProvider,
        onAuthStateChanged,
        signInWithPopup,
        signOut,
    } from "$lib/firebase/client.js";
    import { navigationMenuTriggerStyle } from "$lib/components/ui/navigation-menu/navigation-menu-trigger.svelte";
    import type { User } from "firebase/auth";

    let user = $state<User | null>(null);
    let loginOpen = $state(false);
    let searchTerm = $state("");

    const getUserInitials = (currentUser: User | null) => {
        if (!currentUser) return "U";
        const name = currentUser.displayName?.trim();
        if (name) {
            return name
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part[0]?.toUpperCase())
                .join("");
        }
        const email = currentUser.email?.trim();
        return email ? email[0]?.toUpperCase() ?? "U" : "U";
    };

    const handleLogin = async () => {
        const auth = getFirebaseAuth();
        if (!auth) return;
        await signInWithPopup(auth, getGoogleProvider());
        loginOpen = false;
    };

    const handleLogout = async () => {
        const auth = getFirebaseAuth();
        if (!auth) return;
        await signOut(auth);
    };

    onMount(() => {
        const auth = getFirebaseAuth();
        if (!auth) return;
        const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
            user = nextUser;
        });
        return () => unsubscribe();
    });

    $effect(() => {
        searchTerm = $page.url.searchParams.get("q") ?? "";
    });

    const submitSearch = (event: Event) => {
        event.preventDefault();
        const url = new URL($page.url);
        if (searchTerm.trim()) {
            url.searchParams.set("q", searchTerm.trim());
        } else {
            url.searchParams.delete("q");
        }
        goto(`${url.pathname}${url.search ? `?${url.searchParams.toString()}` : ""}`, {
            keepFocus: true,
            replaceState: true,
            noScroll: true,
        });
    };
</script>

<header class="border-b h-[var(--app-header-height)]">
    <NavigationMenu.Root class="relative flex h-full w-full max-w-none items-center justify-between px-4">
        <div class="flex items-center gap-2">
            <Sidebar.Trigger class="-ms-1" />
            <Separator orientation="vertical" class="me-2 h-4" />
            <NavigationMenu.List class="flex flex-wrap items-center gap-2">
                <NavigationMenu.Item>
                    <NavigationMenu.Link>
                        {#snippet child()}
                            <a href="/" class={navigationMenuTriggerStyle()}>PDF</a>
                        {/snippet}
                    </NavigationMenu.Link>
                </NavigationMenu.Item>

                <NavigationMenu.Item>
                    <NavigationMenu.Link>
                        {#snippet child()}
                            <a href="/upload" class={navigationMenuTriggerStyle()}>Upload</a>
                        {/snippet}
                    </NavigationMenu.Link>
                </NavigationMenu.Item>
                <NavigationMenu.Item>
                    <NavigationMenu.Link>
                        {#snippet child()}
                            <a href="/settings" class={navigationMenuTriggerStyle()}>Settings</a>
                        {/snippet}
                    </NavigationMenu.Link>
                </NavigationMenu.Item>
            </NavigationMenu.List>
        </div>

        <div class="ml-auto flex items-center gap-3">
            {#if $page.url.pathname === "/"}
                <form class="relative w-64" onsubmit={submitSearch}>
                    <input
                        class="border-input bg-background text-foreground focus-visible:ring-ring/50 focus-visible:outline-none w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-2 pr-8"
                        placeholder="Поиск документов..."
                        bind:value={searchTerm}
                    />
                    {#if searchTerm}
                        <button
                            type="button"
                            class="absolute inset-y-0 right-2 text-xs text-muted-foreground hover:text-foreground"
                            onclick={() => {
                                searchTerm = "";
                                submitSearch(new Event("submit"));
                            }}
                        >
                            ✕
                        </button>
                    {/if}
                </form>
            {/if}
            <div class="flex items-center gap-2">
                <Button onclick={toggleMode} variant="outline" size="icon" class="relative">
                    <SunIcon
                        class="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 !transition-all dark:scale-0 dark:-rotate-90"
                    />
                    <MoonIcon
                        class="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 !transition-all dark:scale-100 dark:rotate-0"
                    />
                    <span class="sr-only">Toggle theme</span>
                </Button>
                {#if user}
                    <DropdownMenu.Root>
                        <DropdownMenu.Trigger>
                            {#snippet child({ props })}
                                <button
                                    {...props}
                                    class="focus-visible:ring-ring/50 ring-offset-background flex h-8 w-8 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                                    aria-label="User menu"
                                >
                                    <Avatar.Root class="h-8 w-8">
                                        {#if user?.photoURL}
                                            <Avatar.Image src={user.photoURL} alt={user?.displayName ?? "User"} />
                                        {/if}
                                        <Avatar.Fallback>{getUserInitials(user)}</Avatar.Fallback>
                                    </Avatar.Root>
                                </button>
                            {/snippet}
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Content align="end" sideOffset={8}>
                            <DropdownMenu.Item onSelect={handleLogout}>Logout</DropdownMenu.Item>
                        </DropdownMenu.Content>
                    </DropdownMenu.Root>
                {:else}
                    <DropdownMenu.Root bind:open={loginOpen}>
                        <DropdownMenu.Trigger>
                            {#snippet child({ props })}
                                <Button {...props} size="sm" variant="outline">Login</Button>
                            {/snippet}
                        </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="end" sideOffset={8} class="w-56">
                        <div class="px-2 py-1.5 text-sm font-medium">Login</div>
                        <div class="p-2">
                            <Button class="w-full" onclick={handleLogin}>Continue with Google</Button>
                        </div>
                    </DropdownMenu.Content>
                </DropdownMenu.Root>
            {/if}
            </div>
        </div>

        <div class="perspective-[2000px] absolute left-0 top-full flex h-[var(--radix-navigation-menu-viewport-height)] justify-center overflow-hidden rounded-md border bg-popover shadow-lg data-[state=closed]:animate-exit data-[state=open]:animate-in data-[motion=to-start]:animate-viewport-slide-from-left data-[motion=to-end]:animate-viewport-slide-from-right data-[motion=from-start]:animate-viewport-slide-to-left data-[motion=from-end]:animate-viewport-slide-to-right md:w-full">
            <NavigationMenu.Viewport class="relative w-full origin-top-center md:w-[var(--radix-navigation-menu-viewport-width)]"/>
        </div>
    </NavigationMenu.Root>
</header>
