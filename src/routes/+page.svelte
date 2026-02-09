<script lang="ts">
    import { onMount } from "svelte";
    import { getFirebaseAuth, onAuthStateChanged } from "$lib/firebase/client";
    import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
    import * as Dialog from "$lib/components/ui/dialog/index.js";
    import * as Breadcrumb from "$lib/components/ui/breadcrumb/index.js";
    import { TagsInput } from "$lib/components/ui/tags-input/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import TrashIcon from "@lucide/svelte/icons/trash-2";
    import PencilIcon from "@lucide/svelte/icons/pencil";
    import type { User } from "firebase/auth";
    import { page } from "$app/stores";

    type FileRef = { name: string; id?: string } | string;

    type DocumentItem = {
        id: string;
        title: string;
        files: { pdf: FileRef; thumbnail: FileRef };
        tags?: string[];
        fileSize?: number;
        metadata?: { fileName?: string; pages?: number };
        sectionId?: string | null;
        subsectionId?: string | null;
        uploadedAt?: number;
        encrypted?: boolean;
    };

    type SectionNode = {
        id: string;
        title: string;
        children: SectionNode[];
    };

    let user = $state<User | null>(null);
    let documents = $state<DocumentItem[]>([]);
    let sections = $state<SectionNode[]>([]);
    let loading = $state(true);
    let error = $state<string | null>(null);
    let settingsLoaded = $state(false);
    let b2Exists = $state<boolean | null>(null);

    const getFileName = (file: FileRef) => (typeof file === "string" ? file : file.name);
    const getFileUrl = (file: FileRef) => {
        const uid = user?.uid;
        if (!uid) throw new Error("Нет userId для запроса файла");
        return `/api/b2/file?name=${encodeURIComponent(getFileName(file))}&userId=${encodeURIComponent(uid)}`;
    };
    const formatSize = (size?: number | null) =>
        typeof size === "number" ? `${(size / (1024 * 1024)).toFixed(1)} MB` : "";
    const getKeyPhrase = () => "";

    const fetchDocuments = async (uid: string) => {
        loading = true;
        error = null;
        try {
            const response = await fetch(`/api/documents?userId=${encodeURIComponent(uid)}&limit=200`);
            if (!response.ok) {
                throw new Error(await response.text());
            }
            const data = await response.json();
            documents =
                (data.documents ?? []).map((doc: DocumentItem) => ({
                    ...doc,
                    encrypted: doc.encrypted !== false,
                })) ?? [];
        } catch (err) {
            const message = err instanceof Error ? err.message : "Не удалось загрузить документы";
            error = message;
            documents = [];
        } finally {
            loading = false;
        }
    };

    const fetchSections = async (uid: string) => {
        try {
            const response = await fetch(`/api/sections?userId=${encodeURIComponent(uid)}`);
            if (!response.ok) throw new Error(await response.text());
            const data = await response.json();
            sections = data.sections ?? [];
        } catch (err) {
            console.error("Failed to load sections", err);
            sections = [];
        }
    };

    const fetchSettings = async (uid: string) => {
        try {
            const res = await fetch(`/api/user/b2?userId=${encodeURIComponent(uid)}`);
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            b2Exists = data.exists ?? false;
        } catch (err) {
            console.error("Failed to load settings", err);
            b2Exists = null;
        } finally {
            settingsLoaded = true;
        }
    };

    const removeLocalDoc = (id: string) => {
        documents = documents.filter((doc) => doc.id !== id);
    };

    const deleteDocument = async (doc: DocumentItem) => {
        const response = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
        if (!response.ok) {
            throw new Error(await response.text());
        }
        removeLocalDoc(doc.id);
    };

    let deleteTarget = $state<DocumentItem | null>(null);
    let deleteDialogOpen = $state(false);
    let deleting = $state(false);
    let deleteError = $state<string | null>(null);

    $effect(() => {
        if (!deleteDialogOpen) {
            deleteTarget = null;
            deleteError = null;
            deleting = false;
        }
    });

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        deleting = true;
        deleteError = null;
        try {
            await deleteDocument(deleteTarget);
            deleteTarget = null;
            deleteDialogOpen = false;
        } catch (err) {
            deleteError = err instanceof Error ? err.message : "Не удалось удалить документ";
        } finally {
            deleting = false;
        }
    };

    onMount(() => {
        const auth = getFirebaseAuth();
        if (!auth) {
            loading = false;
            return;
        }
        const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
            user = nextUser;
            if (nextUser) {
                fetchDocuments(nextUser.uid);
                fetchSections(nextUser.uid);
                fetchSettings(nextUser.uid);
            } else {
                documents = [];
                loading = false;
                b2Exists = null;
                settingsLoaded = false;
            }
        });
        return () => unsubscribe();
    });

    // Editing
    let editDialogOpen = $state(false);
    let editTarget = $state<DocumentItem | null>(null);
    let editTitle = $state("");
    let editDescription = $state("");
    let editTags = $state<string[]>([]);
    let editSectionId = $state<string | null>(null);
    let editSubsectionId = $state<string | null>(null);
    let saving = $state(false);
    let saveError = $state<string | null>(null);
    let filterSectionId = $derived<string | null>($page.url.searchParams.get("section"));
    let filterSubsectionId = $derived<string | null>($page.url.searchParams.get("subsection"));
    let searchQuery = $state("");
    let isSearching = $state(false);
    $effect(() => {
        searchQuery = $page.url.searchParams.get("q") ?? "";
    });

    const openEdit = (doc: DocumentItem) => {
        editTarget = doc;
        editTitle = doc.title;
        editDescription = doc.description ?? "";
        editTags = doc.tags ? [...doc.tags] : [];
        editSectionId = doc.sectionId ?? null;
        editSubsectionId = doc.subsectionId ?? null;
        saveError = null;
        editDialogOpen = true;
    };

    $effect(() => {
        if (!editDialogOpen) {
            editTarget = null;
            editTitle = "";
            editDescription = "";
            editTags = [];
            editSectionId = null;
            editSubsectionId = null;
            saving = false;
            saveError = null;
        }
    });

    const currentSubsections = () =>
        sections.find((s) => s.id === editSectionId)?.children ?? [];

    const submitEdit = async () => {
        if (!user || !editTarget) return;
        if (!editTitle.trim()) {
            saveError = "Введите название";
            return;
        }
        saving = true;
        saveError = null;
        try {
            const targetId = editTarget.id;
            await fetch(`/api/documents/${targetId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userId: user.uid,
                    title: editTitle.trim(),
                    description: editDescription.trim(),
                    tags: editTags,
                    sectionId: editSectionId,
                    subsectionId: editSectionId && currentSubsections().length ? editSubsectionId : null,
                }),
            });
            documents = documents.map((d) =>
                d.id === targetId
                    ? {
                          ...d,
                          title: editTitle.trim(),
                          description: editDescription.trim(),
                          tags: editTags,
                          sectionId: editSectionId,
                          subsectionId:
                              editSectionId && currentSubsections().length ? editSubsectionId : null,
                      }
                    : d
            );
            editDialogOpen = false;
        } catch (err) {
            saveError = err instanceof Error ? err.message : "Не удалось сохранить";
        } finally {
            saving = false;
        }
    };

    const latestDocuments = () =>
        [...filteredDocs]
            .sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0))
            .slice(0, 5);

    const uncategorizedDocuments = () =>
        filteredDocs.filter((doc) => !doc.sectionId && !doc.subsectionId);

    const filteredDocuments = () => {
        if (filterSubsectionId) {
            return filteredDocs.filter((doc) => doc.subsectionId === filterSubsectionId);
        }
        if (filterSectionId) {
            return filteredDocs.filter((doc) => doc.sectionId === filterSectionId);
        }
        return filteredDocs;
    };

    const findSectionTitle = (sectionId: string | null) => {
        if (!sectionId) return "";
        return sections.find((s) => s.id === sectionId)?.title ?? "";
    };

    const findSubsectionTitle = (subId: string | null) => {
        if (!subId) return "";
        for (const section of sections) {
            const match = section.children.find((c) => c.id === subId);
            if (match) return match.title;
        }
        return "";
    };

    const requireB2Gate = $derived(!loading && settingsLoaded && b2Exists === false);

    const openPdf = (doc: DocumentItem) => {
        window.open(getFileUrl(doc.files.pdf), "_blank");
    };

    const matchSearch = (doc: DocumentItem, query: string) => {
        if (!query.trim()) return true;
        const tokens = query
            .toLowerCase()
            .split(/\s+/)
            .map((t) => t.trim())
            .filter(Boolean);
        if (tokens.length === 0) return true;

        const haystack = [
            doc.title,
            doc.description ?? "",
            ...(doc.tags ?? []),
            doc.metadata?.fileName ?? "",
        ]
            .join(" ")
            .toLowerCase();

        return tokens.every((t) => haystack.includes(t));
    };

    const applyFilters = () => {
        const base = documents.filter((doc) => {
            if (filterSubsectionId) return doc.subsectionId === filterSubsectionId;
            if (filterSectionId) return doc.sectionId === filterSectionId;
            return true;
        });
        if (!searchQuery.trim()) return base;
        return base.filter((doc) => matchSearch(doc, searchQuery));
    };

    let debouncedSearch = $state("");

    $effect(() => {
        isSearching = true;
        const handle = setTimeout(() => {
            debouncedSearch = searchQuery;
            isSearching = false;
        }, 250);
        return () => clearTimeout(handle);
    });

    const filteredDocs = $derived(applyFilters().filter((doc) => matchSearch(doc, debouncedSearch)));
</script>

<div class="flex w-full flex-col gap-6 px-4 py-6">
    <div class="space-y-2">
        <Breadcrumb.Root>
            <Breadcrumb.List>
                <Breadcrumb.Item>
                    {#if filterSectionId}
                        <Breadcrumb.Link href="/">Главная</Breadcrumb.Link>
                    {:else}
                        <Breadcrumb.Page>Главная</Breadcrumb.Page>
                    {/if}
                </Breadcrumb.Item>
                {#if filterSectionId}
                    <Breadcrumb.Separator />
                    <Breadcrumb.Item>
                        {#if filterSubsectionId}
                            <Breadcrumb.Link href={`/?section=${filterSectionId}`}>
                                {findSectionTitle(filterSectionId) || "Раздел"}
                            </Breadcrumb.Link>
                        {:else}
                            <Breadcrumb.Page>{findSectionTitle(filterSectionId) || "Раздел"}</Breadcrumb.Page>
                        {/if}
                    </Breadcrumb.Item>
                {/if}
                {#if filterSubsectionId}
                    <Breadcrumb.Separator />
                    <Breadcrumb.Item>
                        <Breadcrumb.Page>{findSubsectionTitle(filterSubsectionId) || "Подраздел"}</Breadcrumb.Page>
                    </Breadcrumb.Item>
                {/if}
            </Breadcrumb.List>
        </Breadcrumb.Root>
        <div class="border-b border-border"></div>
    </div>

    {#if loading}
        <p class="text-muted-foreground text-sm">Загружаем список...</p>
    {:else if !user}
        <p class="text-muted-foreground text-sm">Войдите, чтобы увидеть свои документы.</p>
    {:else if requireB2Gate}
        <div class="rounded-md border border-muted-foreground/30 bg-muted/30 px-4 py-3 text-sm">
            <p class="font-medium">Не заданы B2 настройки</p>
            <p class="text-muted-foreground">Добавьте Backblaze креды в Settings.</p>
            <a class="text-primary text-sm hover:underline" href="/settings">Перейти в Settings</a>
        </div>
    {:else if error}
        <div class="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
        </div>
    {:else}
        <div class="flex flex-col gap-8">
            {#if searchQuery.trim()}
                <section class="space-y-3">
                    <div class="flex items-center justify-between">
                        <h2 class="text-lg font-semibold">Результаты поиска</h2>
                        <span class="text-xs text-muted-foreground">{filteredDocs.length} найдено</span>
                    </div>
                    {#if filteredDocs.length === 0}
                        <p class="text-muted-foreground text-sm">Ничего не найдено.</p>
                    {:else}
                        <div class="grid gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
                            {#each filteredDocs as doc (doc.id)}
                                {@render Card({ doc })}
                            {/each}
                        </div>
                    {/if}
                </section>
            {:else if filterSectionId || filterSubsectionId}
                <section class="space-y-3">
                    {#if filteredDocuments().length === 0}
                        <p class="text-muted-foreground text-sm">Документов не найдено.</p>
                    {:else}
                        <div class="grid gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
                            {#each filteredDocuments() as doc (doc.id)}
                                {@render Card({ doc })}
                            {/each}
                        </div>
                    {/if}
                </section>
            {:else}
                <section class="space-y-3">
                    <div class="flex items-center justify-between">
                        <h2 class="text-lg font-semibold">Последние</h2>
                        <span class="text-xs text-muted-foreground">5 последних загрузок</span>
                    </div>
                    {#if latestDocuments().length === 0}
                        <p class="text-muted-foreground text-sm">Недавних файлов нет.</p>
                    {:else}
                        <div class="grid gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
                            {#each latestDocuments() as doc (doc.id)}
                                {@render Card({ doc })}
                            {/each}
                        </div>
                    {/if}
                </section>

                <section class="space-y-3">
                    <div class="flex items-center justify-between">
                        <h2 class="text-lg font-semibold">Без раздела</h2>
                    </div>
                    {#if uncategorizedDocuments().length === 0}
                        <p class="text-muted-foreground text-sm">Все документы привязаны к разделам.</p>
                    {:else}
                        <div class="grid gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
                            {#each uncategorizedDocuments() as doc (doc.id)}
                                {@render Card({ doc })}
                            {/each}
                        </div>
                    {/if}
                </section>
            {/if}
        </div>
    {/if}
</div>

    {#snippet Card({ doc }: { doc: DocumentItem })}
    <article class="rounded-lg border bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
        <a
            href={getFileUrl(doc.files.pdf)}
            class="flex flex-col gap-2 p-2"
            rel="noreferrer"
            target="_blank"
            onclick={(event) => {
                event.stopPropagation();
            }}
        >
            <div class="relative aspect-[3/4] overflow-hidden rounded-md bg-muted">
                <img
                    src={getFileUrl(doc.files.thumbnail)}
                    alt={doc.title}
                    loading="lazy"
                    class="absolute inset-0 h-full w-full object-cover"
                    onerror={(event) => ((event.currentTarget as HTMLImageElement).style.display = "none")}
                />
            </div>
            <div class="space-y-1">
                <div class="border-t border-border/60 pt-2">
                    <div class="truncate text-sm font-semibold">{doc.title}</div>
                </div>
                {#if doc.tags?.length}
                    <div class="flex flex-wrap gap-1">
                        {#each doc.tags.slice(0, 3) as tag}
                            <span class="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{tag}</span>
                        {/each}
                    </div>
                {/if}
            </div>
        </a>
        <div class="flex items-center gap-2 border-t border-border/60 px-2 py-2 text-xs text-muted-foreground">
            <span class="uppercase tracking-wide font-semibold">PDF</span>
            <span class="text-muted-foreground/70">|</span>
            {#if doc.fileSize !== null && doc.fileSize !== undefined}
                <span class="font-medium">{formatSize(doc.fileSize)}</span>
            {:else}
                <span class="opacity-60">—</span>
            {/if}
            <div class="ml-auto flex items-center gap-2">
                <button
                    class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background/80 text-muted-foreground shadow-sm hover:text-primary"
                    aria-label="Редактировать"
                    onclick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        openEdit(doc);
                    }}
                >
                    <PencilIcon class="h-4 w-4" />
                </button>
                <button
                    class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background/80 text-muted-foreground shadow-sm hover:text-destructive"
                    aria-label="Удалить"
                    onclick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        deleteTarget = doc;
                        deleteDialogOpen = true;
                    }}
                >
                    <TrashIcon class="h-4 w-4" />
                </button>
            </div>
        </div>
    </article>
{/snippet}

<AlertDialog.Root bind:open={deleteDialogOpen}>
    <AlertDialog.Content>
        <AlertDialog.Header>
            <AlertDialog.Title>Удалить документ?</AlertDialog.Title>
            <AlertDialog.Description>
                Это действие удалит PDF и превью из хранилища. Отменить будет невозможно.
            </AlertDialog.Description>
        </AlertDialog.Header>
        {#if deleteError}
            <div class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {deleteError}
            </div>
        {/if}
        <AlertDialog.Footer>
            <div class="flex w-full items-center justify-end gap-2">
                <Button variant="outline" onclick={() => { deleteDialogOpen = false; deleteTarget = null; }}>
                    Отмена
                </Button>
                <Button variant="destructive" onclick={confirmDelete} disabled={deleting || !deleteTarget}>
                    {deleting ? "Удаляем..." : "Удалить"}
                </Button>
            </div>
        </AlertDialog.Footer>
    </AlertDialog.Content>
</AlertDialog.Root>

<Dialog.Root bind:open={editDialogOpen}>
    <Dialog.Content>
        <Dialog.Header>
            <Dialog.Title>Редактировать документ</Dialog.Title>
            <Dialog.Description>Измените название и раздел.</Dialog.Description>
        </Dialog.Header>
        <div class="space-y-3">
            <label class="flex flex-col gap-1 text-sm">
                <span class="text-muted-foreground">Название</span>
                <input
                    class="border-input bg-background text-foreground focus-visible:ring-ring/50 focus-visible:outline-none w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-2"
                    bind:value={editTitle}
                    placeholder="Название документа"
                />
            </label>
            <div class="flex flex-col gap-1 text-sm">
                <span class="text-muted-foreground">Раздел</span>
                <select
                    class="border-input bg-background text-foreground focus-visible:ring-ring/50 focus-visible:outline-none w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-2"
                    bind:value={editSectionId}
                >
                    <option value={null}>Без раздела</option>
                    {#each sections as section (section.id)}
                        <option value={section.id}>{section.title}</option>
                    {/each}
                </select>
            </div>
            {#if editSectionId && currentSubsections().length}
                <div class="flex flex-col gap-1 text-sm">
                    <span class="text-muted-foreground">Подраздел</span>
                    <select
                        class="border-input bg-background text-foreground focus-visible:ring-ring/50 focus-visible:outline-none w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-2"
                        bind:value={editSubsectionId}
                    >
                        <option value={null}>Без подраздела</option>
                        {#each currentSubsections() as sub (sub.id)}
                            <option value={sub.id}>{sub.title}</option>
                        {/each}
                        </select>
                </div>
            {/if}
            <label class="flex flex-col gap-1 text-sm">
                <span class="text-muted-foreground">Описание</span>
                <textarea
                    class="border-input bg-background text-foreground focus-visible:ring-ring/50 focus-visible:outline-none w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-2"
                    rows={3}
                    bind:value={editDescription}
                    placeholder="Краткое описание"
                />
            </label>
            <div class="flex flex-col gap-1 text-sm">
                <span class="text-muted-foreground">Теги</span>
                {#key editTarget?.id ?? "new"}
                    <TagsInput bind:value={editTags} placeholder="Введите тег и нажмите Enter" />
                {/key}
            </div>
            {#if saveError}
                <div class="text-destructive text-xs">{saveError}</div>
            {/if}
        </div>
        <Dialog.Footer>
            <div class="flex w-full items-center justify-end gap-2">
                <Button variant="outline" onclick={() => (editDialogOpen = false)} disabled={saving}>
                    Отмена
                </Button>
                <Button variant="default" onclick={submitEdit} disabled={saving || !editTarget}>
                    {saving ? "Сохраняем..." : "Сохранить"}
                </Button>
            </div>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>
