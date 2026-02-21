<script lang="ts">
    import * as Sidebar from "$lib/components/ui/sidebar/index.js";
    import * as Dialog from "$lib/components/ui/dialog/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { ConfirmDeleteDialog, confirmDelete } from "$lib/components/ui/confirm-delete-dialog/index.js";
    import GalleryVerticalEndIcon from "@lucide/svelte/icons/gallery-vertical-end";
    import PlusIcon from "@lucide/svelte/icons/plus";
    import MinusIcon from "@lucide/svelte/icons/minus";
    import PencilIcon from "@lucide/svelte/icons/pencil";
    import { browser } from "$app/environment";
    import { authFetch } from "$lib/firebase/auth-fetch";
    import { getFirebaseAuth, onAuthStateChanged } from "$lib/firebase/client.js";
    import type { ComponentProps } from "svelte";
    import type { User } from "firebase/auth";

    type SectionNode = {
        id: string;
        title: string;
        children: SectionNode[];
    };

    let { ref = $bindable(null), ...restProps }: ComponentProps<typeof Sidebar.Root> = $props();

    let user = $state<User | null>(null);
    let sections = $state<SectionNode[]>([]);
    let loading = $state(false);
    let error = $state<string | null>(null);
    let editMode = $state(false);

    const fetchSections = async () => {
        loading = true;
        error = null;
        try {
            const response = await authFetch("/api/sections");
            if (!response.ok) throw new Error(await response.text());
            const data = await response.json();
            sections = data.sections ?? [];
        } catch (err) {
            error = err instanceof Error ? err.message : "Не удалось загрузить разделы";
            sections = [];
        } finally {
            loading = false;
        }
    };

    let createDialogOpen = $state(false);
    let createParentId = $state<string | null>(null);
    let createTitle = $state("");
    let creating = $state(false);
    let createError = $state<string | null>(null);

    let renameDialogOpen = $state(false);
    let renameTargetId = $state<string | null>(null);
    let renameTitle = $state("");
    let renaming = $state(false);
    let renameError = $state<string | null>(null);

    const openCreateDialog = (parentId: string | null) => {
        createParentId = parentId;
        createTitle = "";
        createError = null;
        createDialogOpen = true;
    };

    const openRenameDialog = (id: string, title: string) => {
        renameTargetId = id;
        renameTitle = title;
        renameError = null;
        renameDialogOpen = true;
    };

    const submitCreate = async () => {
        if (!user) {
            createError = "Войдите, чтобы добавлять разделы";
            return;
        }
        if (!createTitle.trim()) {
            createError = "Введите название";
            return;
        }
        creating = true;
        createError = null;
        try {
            await authFetch("/api/sections", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: createTitle.trim(), parentId: createParentId }),
            });
            await fetchSections();
            createDialogOpen = false;
        } catch (err) {
            createError = err instanceof Error ? err.message : "Не удалось создать";
        } finally {
            creating = false;
        }
    };

    const submitRename = async () => {
        if (!user) {
            renameError = "Войдите, чтобы переименовывать разделы";
            return;
        }
        if (!renameTargetId) {
            renameError = "Не выбрана цель";
            return;
        }
        if (!renameTitle.trim()) {
            renameError = "Введите название";
            return;
        }
        renaming = true;
        renameError = null;
        try {
            const response = await authFetch(`/api/sections/${renameTargetId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: renameTitle.trim() }),
            });
            if (!response.ok) {
                throw new Error(await response.text());
            }
            await fetchSections();
            renameDialogOpen = false;
        } catch (err) {
            renameError = err instanceof Error ? err.message : "Не удалось переименовать";
        } finally {
            renaming = false;
        }
    };

    const deleteSection = async (id: string) => {
        if (!user) return;
        await authFetch(`/api/sections/${id}`, { method: "DELETE" });
        await fetchSections();
    };

    if (browser) {
        const auth = getFirebaseAuth();
        if (auth) {
            onAuthStateChanged(auth, (nextUser) => {
                user = nextUser;
                if (nextUser) {
                    fetchSections();
                } else {
                    sections = [];
                }
            });
        }
    }

    $effect(() => {
        if (!renameDialogOpen) {
            renameTargetId = null;
            renameTitle = "";
            renameError = null;
            renaming = false;
        }
    });
</script>

<Sidebar.Root {...restProps} bind:ref>
    <Sidebar.Header>
        <Sidebar.Menu>
            <Sidebar.MenuItem>
                <Sidebar.MenuButton size="lg">
                    {#snippet child({ props })}
                        <a href="/" {...props}>
                            <div
                                class="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg"
                            >
                                <GalleryVerticalEndIcon class="size-4" />
                            </div>
                            <div class="flex flex-col gap-0.5 leading-none">
                                <span class="font-medium">PDF Vault</span>
                                <span class="text-xs text-muted-foreground">
                                    {#if user}книги и документы{:else}Войдите{/if}
                                </span>
                            </div>
                        </a>
                    {/snippet}
                </Sidebar.MenuButton>
            </Sidebar.MenuItem>
        </Sidebar.Menu>
    </Sidebar.Header>
    <Sidebar.Content>
        <Sidebar.Group>
            {#if loading}
                <div class="px-3 py-2 text-xs text-muted-foreground">Загружаем разделы...</div>
            {:else if error}
                <div class="px-3 py-2 text-xs text-destructive">{error}</div>
            {:else if !user}
                <div class="px-3 py-2 text-xs text-muted-foreground">Войдите, чтобы увидеть разделы.</div>
            {:else if sections.length === 0}
                <div class="px-3 py-2 text-xs text-muted-foreground">Разделов пока нет.</div>
            {/if}
            <Sidebar.Menu>
                {#each sections as item (item.id)}
                    <Sidebar.MenuItem>
                        <div class="flex items-center gap-1">
                            <Sidebar.MenuButton class="font-medium flex-1">
                                {#snippet child({ props })}
                                    <a href={`/?section=${item.id}`} {...props}>
                                        {item.title}
                                    </a>
                                {/snippet}
                            </Sidebar.MenuButton>
                            {#if editMode}
                                <button
                                    class="inline-flex h-6 w-6 items-center justify-center rounded border text-xs"
                                    title="Добавить подраздел"
                                    onclick={(event) => {
                                        event.stopPropagation();
                                        openCreateDialog(item.id);
                                    }}
                                >
                                    <PlusIcon class="h-3 w-3" />
                                </button>
                                <button
                                    class="inline-flex h-6 w-6 items-center justify-center rounded border text-xs"
                                    title="Переименовать раздел"
                                    onclick={(event) => {
                                        event.stopPropagation();
                                        openRenameDialog(item.id, item.title);
                                    }}
                                >
                                    <PencilIcon class="h-3 w-3" />
                                </button>
                                <button
                                    class="inline-flex h-6 w-6 items-center justify-center rounded border text-xs text-destructive"
                                    title="Удалить раздел и документы"
                                    onclick={(event) => {
                                        event.stopPropagation();
                                        confirmDelete({
                                            title: "Удалить раздел?",
                                            description:
                                                "Раздел и все вложенные документы будут удалены. Отменить действие нельзя.",
                                            onConfirm: () => deleteSection(item.id),
                                        });
                                    }}
                                >
                                    <MinusIcon class="h-3 w-3" />
                                </button>
                            {/if}
                        </div>
                        {#if item.children?.length}
                            <Sidebar.MenuSub>
                                {#each item.children as subItem (subItem.id)}
                                    <Sidebar.MenuSubItem>
                                        <div class="flex items-center gap-1">
                                            <Sidebar.MenuSubButton>
                                                {#snippet child({ props })}
                                                    <a
                                                        href={`/?section=${item.id}&subsection=${subItem.id}`}
                                                        {...props}
                                                    >
                                                        {subItem.title}
                                                    </a>
                                                {/snippet}
                                            </Sidebar.MenuSubButton>
                                            {#if editMode}
                                                <button
                                                    class="inline-flex h-6 w-6 items-center justify-center rounded border text-xs"
                                                    title="Переименовать подраздел"
                                                    onclick={(event) => {
                                                        event.stopPropagation();
                                                        openRenameDialog(subItem.id, subItem.title);
                                                    }}
                                                >
                                                    <PencilIcon class="h-3 w-3" />
                                                </button>
                                                <button
                                                    class="inline-flex h-6 w-6 items-center justify-center rounded border text-xs text-destructive"
                                                    title="Удалить подраздел и документы"
                                                    onclick={(event) => {
                                                        event.stopPropagation();
                                                        confirmDelete({
                                                            title: "Удалить подраздел?",
                                                            description:
                                                                "Подраздел и все вложенные документы будут удалены. Отменить действие нельзя.",
                                                            onConfirm: () => deleteSection(subItem.id),
                                                        });
                                                    }}
                                                >
                                                    <MinusIcon class="h-3 w-3" />
                                                </button>
                                            {/if}
                                        </div>
                                    </Sidebar.MenuSubItem>
                                {/each}
                            </Sidebar.MenuSub>
                        {/if}
                    </Sidebar.MenuItem>
                {/each}
            </Sidebar.Menu>
        </Sidebar.Group>
        <div class="mt-auto border-t px-3 py-3">
            <div class="flex items-center justify-between gap-2">
                <button
                    class="rounded-md border px-2 py-1 text-xs"
                    onclick={() => (editMode = !editMode)}
                    disabled={!user}
                >
                    {editMode ? "Done" : "Edit"}
                </button>
                {#if editMode}
                    <button
                        class="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
                        onclick={() => openCreateDialog(null)}
                        disabled={!user}
                    >
                        <PlusIcon class="h-3 w-3" /> Добавить раздел
                    </button>
                {/if}
            </div>
        </div>
    </Sidebar.Content>
    <Sidebar.Rail />
</Sidebar.Root>

<Dialog.Root bind:open={createDialogOpen}>
    <Dialog.Content>
        <Dialog.Header>
            <Dialog.Title>{createParentId ? "Новый подраздел" : "Новый раздел"}</Dialog.Title>
            <Dialog.Description>
                Создайте {createParentId ? "подраздел" : "раздел"} для группировки документов.
            </Dialog.Description>
        </Dialog.Header>
        <div class="space-y-2">
            <label class="flex flex-col gap-1 text-sm">
                <span class="text-muted-foreground">Название</span>
                <input
                    class="border-input bg-background text-foreground focus-visible:ring-ring/50 focus-visible:outline-none w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-2"
                    placeholder="Например, Кухня"
                    bind:value={createTitle}
                />
            </label>
            {#if createError}
                <div class="text-destructive text-xs">{createError}</div>
            {/if}
        </div>
        <Dialog.Footer>
            <div class="flex w-full items-center justify-end gap-2">
                <Button variant="outline" onclick={() => (createDialogOpen = false)} disabled={creating}>
                    Отмена
                </Button>
                <Button variant="default" onclick={submitCreate} disabled={creating}>
                    {creating ? "Создаем..." : "Создать"}
                </Button>
            </div>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={renameDialogOpen}>
    <Dialog.Content>
        <Dialog.Header>
            <Dialog.Title>Переименовать</Dialog.Title>
            <Dialog.Description>Измените название раздела или подраздела.</Dialog.Description>
        </Dialog.Header>
        <div class="space-y-2">
            <label class="flex flex-col gap-1 text-sm">
                <span class="text-muted-foreground">Новое название</span>
                <input
                    class="border-input bg-background text-foreground focus-visible:ring-ring/50 focus-visible:outline-none w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-2"
                    placeholder="Новое название"
                    bind:value={renameTitle}
                />
            </label>
            {#if renameError}
                <div class="text-destructive text-xs">{renameError}</div>
            {/if}
        </div>
        <Dialog.Footer>
            <div class="flex w-full items-center justify-end gap-2">
                <Button variant="outline" onclick={() => (renameDialogOpen = false)} disabled={renaming}>
                    Отмена
                </Button>
                <Button variant="default" onclick={submitRename} disabled={renaming || !renameTargetId}>
                    {renaming ? "Сохраняем..." : "Сохранить"}
                </Button>
            </div>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>

<ConfirmDeleteDialog />
