# PDF Vault — актуальная спецификация

Источники архитектуры (read-only):
- `docs/encryption-architecture.md`
- `docs/presigned-urls-netlify.md`

## 1. Текущий стек
- SvelteKit 2 + Svelte 5 (runes), `@sveltejs/adapter-netlify`.
- Firebase Auth (клиент).
- Firestore через Firebase Admin SDK (серверные маршруты).
- Backblaze B2 (бинарные файлы).
- PDF.js (`pdfjs-dist`) для генерации thumbnail.

## 2. Что реализовано сейчас

### Аутентификация и сервер
- Все `documents/sections` API используют `Authorization: Bearer <Firebase ID token>`.
- `uid` берется только из проверенного токена (`src/lib/server/auth.ts`), а не из query/body.
- Legacy маршруты удалены: `/api/b2/*`, `/api/user/b2`, `/api/settings`.

### Presigned B2
- `netlify/functions/get-upload-url.mjs`: выдает `uploadUrl`, `uploadAuthToken`, `fileName` вида `files/{uid}/{uuid}.{ext}`.
- `netlify/functions/get-download-url.mjs`: проверяет ownership (`files/{uid}/...`) и выдает signed URL.
- Клиент использует `/.netlify/functions/*` и fallback `/get-*` на случай несовпадения роутинга платформы.

### Шифрование
- Клиент шифрует PDF и thumbnail перед upload (`AES-GCM-256`, DEK на файл, DEK шифруется master key).
- В Firestore хранятся `encryption.encryptedDEK`, `encryption.dekIV`, `encryption.fileIV`, `encryption.algorithm`, `mimeType`.
- В B2 хранятся только зашифрованные bytes.
- Расшифровка PDF/thumbnail выполняется только на клиенте.

### Ключи
- Master key хранится на устройстве в IndexedDB (wrapped через device key).
- Есть create/restore flow через backup phrase.
- В UI есть повторный показ backup phrase и подтверждение сохранения.

### UI
- Header: `PDF`, `Upload`, `Settings`, тема, логин/аватар, поиск.
- Sidebar: section/subsection CRUD.
- Главная: список документов, локальный поиск/фильтрация, edit metadata, delete.
- Upload: выбор раздела + upload с шифрованием (блокируется без ключа/подтвержденной backup phrase).
- Settings: create/restore master key, показ backup phrase, подтверждение сохранения phrase.

## 3. Текущая модель данных (Firestore)
- `documents`:
  - `userId`, `title`, `description`, `tags`, `uploadedAt`, `fileSize`
  - `files.pdf`, `files.thumbnail` (`{name,id}` или legacy string)
  - `metadata.fileName`
  - `sectionId`, `subsectionId`
  - `encryption`, `encrypted`
  - `searchTokens`
- `sections`:
  - `userId`, `title`, `parentId`, `order`, `createdAt`

## 4. Переменные окружения
- `B2_KEY_ID`, `B2_APP_KEY`, `B2_BUCKET_ID`, `B2_BUCKET_NAME`
- `B2_ENDPOINT` (опционально; сейчас не используется для download URL)
- `FIREBASE_ADMIN_CREDENTIALS` или `FIREBASE_ADMIN_CREDENTIALS_PATH`
- `PUBLIC_FIREBASE_*`

## 5. Сверка с docs/*

### Что совпадает с планом
- Client-side encryption перед upload.
- Presigned URLs через Netlify Functions.
- Проверка Firebase ID token перед выдачей URL.
- Запрет на хранение B2 кредов в клиенте/Firestore.
- Удаление файла удаляет B2 blob и метаданные.

### Что пока отличается от идеальной схемы в docs
- Нет отдельной структуры `users/{uid}/files/*`; используется коллекция `documents`.
- Нет полей `users/{uid}.masterKeySetup/backupVerified` в Firestore.

## 6. Инварианты безопасности
- Нельзя отправлять в B2 незашифрованный пользовательский контент.
- Master key не должен уходить на сервер в открытом виде.
- Все серверные операции выполняются в контексте `uid` из валидного токена.
- Любая выдача signed URL должна проверять принадлежность файла пользователю.

## 7. Дальнейшая работа
- Детальный план: `PLANS.md`
- Открытые задачи: `TODO.md`
