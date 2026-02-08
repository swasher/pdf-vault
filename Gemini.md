# PDF Vault – заметки по текущей реализации

## Навигация и разделы
- Сайдбар теперь на `sidebar-03` (shadcn-svelte). Данные разделов приходят из Firestore через `/api/sections`.
- Редактирование разделов: кнопка Edit внизу. В режиме редактирования у верхнего уровня есть `+` (создать подраздел) и `–` (удалить раздел с вложенными документами), у подразделов только `–`.
- Создание раздела/подраздела открывает модальное окно на компонентах shadcn Dialog (`Dialog.*`, `Button`).
- Удаление подтверждается через `ConfirmDeleteDialog` (shadcn-svelte-extras). Глобальный компонент `<ConfirmDeleteDialog />` смонтирован в `app-sidebar.svelte`, вызов через `confirmDelete({ title, description, onConfirm })`.
- API секций:
  - `GET /api/sections?userId=...` — дерево (верхний + children), сортируется по `order`.
  - `POST /api/sections` — создать (поля: `userId`, `title`, optional `parentId`). `order` вычисляется по siblings.
  - `DELETE /api/sections/:id?userId=...` — удаляет секцию/подсекцию, связанные документы (через существующий delete docs API) и сами секции.

## Документы и загрузка
- PDF загружаются на `/upload`: клиент генерирует превью (PDF.js, динамический worker из `pdfjs-dist/build/pdf.worker.min.mjs?url`), отправляет `FormData` в `/api/b2/upload-url` (`file`, `thumbnail`, `thumbnailName`, `title`, `userId`).
- После загрузки API сохраняет документ в Firestore с `files.pdf/thumbnail` (name + fileId), `fileSize`, `title`, `metadata.fileName`.
- Главная `/`: тянет документы через `/api/documents?userId=...`, показывает карточки с миниатюрами (через `/api/b2/file?name=...`). Есть кнопка удаления документа с AlertDialog.
- API документов: `POST/GET /api/documents` (создание/список), `DELETE /api/documents/:id` (удаляет PDF/thumbnail в B2 и запись в Firestore).

## Технологии и окружение
- SvelteKit, shadcn-svelte, Firebase Auth (клиент), Firestore (admin SDK на серверных маршрутах), Backblaze B2.
- PDF.js (`pdfjs-dist`), ConfirmDeleteDialog (shadcn-svelte-extras), Dialog (shadcn-svelte).
- Env: `BLACKBAZE_*`, `FIREBASE_ADMIN_CREDENTIALS_PATH`, публичные `PUBLIC_FIREBASE_*`.
- Фреймворк: Svelte 5 (runes) с новым синтаксисом событий (`onclick`, `onchange` и т.п.).

## Важные детали реализации
- Сортировка документов сейчас в коде (по `uploadedAt`), без индекса Firestore.
- `sections` имеют только один уровень вложенности (parentId либо null). Документы пока не привязаны к секциям в UI; поля для этого можно добавить в `documents` (например, `sectionId`, `subsectionId`) при доработке формы загрузки/списка.
- Удаление секций каскадно удаляет связанные документы и файлы в B2.
- UI без лишних контролов по умолчанию; Edit-тоггл показывает кнопки управления.

## TODO
[ ] Валидация авторизации на сервере: проверять Firebase ID token и получать userId на бэке, не доверять userId из query/body во всех API (`/api/documents`, `/api/sections`).
[ ] Порядок секций: поле `order` не обновляется и не редактируется в UI. Добавить эндпоинт/перетаскивание в сайдбаре для перестановки разделов/подразделов.
[x] Загрузка с привязкой к разделам: на `/upload` нет выбора section/subsection, новые документы оказываются “без раздела”. Добавить селекторы и прокидывать `sectionId/subsectionId` в `/api/documents`.
[ ] Редактирование метаданных документов: диалог редактирования меняет только title/section. Добавить поля для `description`/`tags` и PATCH-логику.
[ ] Фильтрация на стороне API: сейчас `/api/documents` возвращает все документы пользователя, а фильтрация по разделу в UI — клиентская. Добавить фильтры (`sectionId`, `subsectionId`, поисковая строка) и соответствующие индексы Firestore.
[ ] Поиск по токенам: `searchTokens` сохраняются, но не используются. Добавить поиск (параметр `q`) или отдельный endpoint, который ищет по токенам.
[ ] Полный список и пагинация: Добавить постраничный список/инфинит-скролл с `limit/startAfter` для снижения объёма выборки.
