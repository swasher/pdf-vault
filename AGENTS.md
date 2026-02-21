# PDF Vault — актуальная спецификация (as-is + to-be)

Документ объединяет прежние заметки (`Gemini.md`) и рабочую спецификацию, плюс фиксирует целевую архитектуру шифрования и работы с B2.

Источник целевой архитектуры:
- `docs/encryption-architecture.md`
- `docs/presigned-urls-netlify.md`

## 1. Текущее состояние проекта (as-is)

### Стек
- SvelteKit 2 + Svelte 5 (runes), `@sveltejs/adapter-netlify`.
- UI: shadcn-svelte + shadcn-svelte-extras.
- Firebase Auth на клиенте.
- Firestore через Firebase Admin SDK на серверных маршрутах SvelteKit.
- Backblaze B2 для хранения файлов.
- PDF.js (`pdfjs-dist`) для генерации thumbnail на клиенте.

### Навигация и UI
- Header (`src/lib/components/nav-menu.svelte`): `PDF`, `Upload`, `Settings`, тема, логин/аватар, поиск по `q`.
- Sidebar (`src/lib/components/app-sidebar.svelte`): разделы/подразделы, edit-mode, создание/переименование/удаление разделов.
- Главная (`src/routes/+page.svelte`): карточки документов, редактирование метаданных, удаление.
- Upload (`src/routes/upload/+page.svelte`): drag&drop PDF, генерация thumbnail, выбор section/subsection.
- Settings (`src/routes/settings/+page.svelte`): информационная страница по текущей схеме хранения/шифрования.

### API (as-is)
- Документы:
  - `GET/POST /api/documents`
  - `PATCH/DELETE /api/documents/[id]`
- Разделы:
  - `GET/POST /api/sections`
  - `PATCH/DELETE /api/sections/[id]`
- Netlify Functions:
  - `POST /.netlify/functions/get-upload-url`
  - `POST /.netlify/functions/get-download-url`

### Данные Firestore (as-is)
- Коллекция `documents`: `title`, `description`, `tags`, `files.pdf/thumbnail`, `metadata.fileName`, `sectionId`, `subsectionId`, `uploadedAt`, `encrypted`.
- Коллекция `sections`: `title`, `parentId`, `order`, `userId`.

### Известные проблемы as-is
- Проверить smoke-тестом после deploy, что Netlify Functions получают все обязательные env (`B2_*`, `FIREBASE_ADMIN_CREDENTIALS*`).
- Добавить e2e-проверку сценария восстановления доступа через backup phrase на новом устройстве.

## 2. Целевая архитектура (to-be)

### Криптография файлов
- Только client-side encryption перед отправкой в B2.
- Алгоритм: AES-GCM-256.
- Иерархия ключей:
  - `Master Key` (у пользователя/устройства)
  - `DEK` на каждый файл
  - файл шифруется `DEK`, `DEK` шифруется `Master Key`.
- `Master Key` хранится на устройстве (IndexedDB), поддерживается recovery через Backup Phrase.
- В B2 хранятся только зашифрованные blobs (`.bin`), без открытых метаданных.

### Доступ к B2
- B2 credentials живут только на сервере Netlify (Environment Variables).
- Клиент никогда не получает `keyId/applicationKey`.
- Загрузка/скачивание идут через presigned/pre-authorized URL, выдаваемые серверной функцией.
- Проверка пользователя перед выдачей URL: Firebase ID token.

### Серверная модель
- Единый принцип: сервер получает `uid` из валидного Firebase ID token, не из payload.
- Минимальное доверие к клиенту.
- Явное разделение:
  - выдача upload/download URL
  - CRUD метаданных в Firestore
  - клиентская криптография

## 3. Целевая модель данных

Рекомендованная структура:
- `users/{uid}`:
  - `masterKeySetup`
  - `backupVerified`
  - поля для зашифрованного состояния master key (по итоговой реализации device flow)
- `users/{uid}/files/{fileId}`:
  - `name`, `size`, `mimeType`, `uploadedAt`
  - `b2Key`
  - `encryption.encryptedDEK`, `encryption.dekIV`, `encryption.fileIV`, `encryption.algorithm`
  - `sectionId`, `subsectionId`, `tags`, `description` (если сохраняем текущую UX-модель)

Допустим временный переходный слой для чтения legacy `documents` до миграции.

## 4. Переменные окружения

### Текущие (используются в коде)
- `B2_KEY_ID`, `B2_APP_KEY`, `B2_BUCKET_ID`, `B2_BUCKET_NAME`, `B2_ENDPOINT`
- `FIREBASE_ADMIN_CREDENTIALS` или `FIREBASE_ADMIN_CREDENTIALS_PATH`
- `PUBLIC_FIREBASE_*`

### Целевые (для новой схемы)
- `B2_KEY_ID`, `B2_APP_KEY`, `B2_BUCKET_ID`, `B2_BUCKET_NAME`
- `FIREBASE_API_KEY` (для token lookup в функции, если выбран этот путь)
- `FIREBASE_ADMIN_CREDENTIALS` (предпочтительно для Netlify)
- Публичные `PUBLIC_FIREBASE_*`

Legacy aliases `BLACKBAZE_*` и `B2_MASTER_SECRET` удалены из runtime-кода.

## 5. Правила безопасности и инварианты

- Незашифрованные пользовательские файлы не должны отправляться в B2.
- `Master Key` не отправляется на сервер в открытом виде.
- Любая выдача URL в B2 выполняется только после проверки Firebase ID token.
- Вся работа с `uid` на сервере должна брать `uid` из проверенного токена.
- Любая операция удаления/обновления должна проверять принадлежность ресурса пользователю.

## 6. Практические договоренности по кодовой базе

- Legacy маршруты `/api/b2/*`, `/api/user/b2`, `/api/settings` удалены.
- Новые изменения проектировать вокруг client crypto + presigned URL.
- Для поиска по репозиторию использовать `rg`/`rg --files` (и `fd`, `ast-grep` при необходимости).
- Стараться не использовать медленный Get-Content

## 7. Scope разделов/навигации

Остается в проекте:
- Иерархия section/subsection (один уровень вложенности).
- CRUD секций, редактирование документа, фильтрация по разделам и поиску.

Подлежит рефакторингу только слой хранения/доставки файла и auth-валидация серверных маршрутов.

## 8. План реализации

Пошаговый технический план вынесен в `PLANS.md`.
