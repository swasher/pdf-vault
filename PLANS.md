# План рефакторинга под новую схему шифрования

Цель: перевести проект на понятную и воспроизводимую архитектуру `client-side AES-GCM + presigned B2 URLs + серверная валидация Firebase token`, убрать конфликтующие legacy-ветки.

## Входные условия

- Хранилище Backblaze B2: пустое (рабочих данных нет).
- Firestore: пустой с точки зрения production-данных (имеющиеся данные считаем тестовыми).
- Проект готовится к первой выкладке, поэтому миграции legacy-данных не требуются.
- Любые переходные слои (`dual-read`, скрипты переноса) исключаем из scope.

## 1. Что выкидываем

### Полностью удалить (после переходного этапа)
- `src/lib/server/b2-creds.ts`
  - убрать хранение per-user B2 credentials в Firestore.
  - убрать fallback на `BLACKBAZE_*`.
- `src/routes/api/user/b2/+server.ts`
  - endpoint для сохранения B2 ключей пользователем больше не нужен.
- `src/routes/api/b2/list/+server.ts`
  - debug/legacy endpoint, не нужен в новой модели.
- `src/routes/api/settings/+server.ts`
  - legacy `encryptionKeyHash` поток не соответствует новой архитектуре.

### Удалить/заменить legacy B2 прокси-логику
- `src/routes/api/b2/upload-url/+server.ts`
  - убрать серверную загрузку контента в B2.
  - убрать создание ссылок `/api/b2/file?...`.
- `src/routes/api/b2/file/+server.ts`
  - убрать проксирование файлов через SvelteKit endpoint.

### Удалить куски UI, связанные с legacy B2 creds/key hash
- `src/routes/settings/+page.svelte`
  - удалить форму сохранения B2 credentials.
  - удалить остатки legacy key-hash flow.

## 2. Что обновляем

### Авторизация и безопасность API (обязательно)
- `src/lib/firebase/server.ts`
  - оставить единый источник admin SDK, использовать для verify ID token.
- `src/routes/api/documents/+server.ts`
  - убрать `userId` из доверенного input.
  - извлекать `uid` только из `Authorization: Bearer <idToken>`.
- `src/routes/api/documents/[id]/+server.ts`
  - для `PATCH/DELETE` использовать `uid` из токена.
  - удалить зависимость от `BLACKBAZE_*` в delete-потоке (удаление через новый серверный B2-клиент).
- `src/routes/api/sections/+server.ts`
  - убрать доверие к `userId` из query/body.
- `src/routes/api/sections/[id]/+server.ts`
  - убрать `userId` из query/body, валидация только по токену.

### Клиентский поток загрузки/скачивания
- `src/routes/upload/+page.svelte`
  - убрать сломанный флаг `hasKey`.
  - добавить клиентское шифрование файла/thumbnail перед upload.
  - заменить отправку в `/api/b2/upload-url` на новый endpoint выдачи presigned URL.
- `src/routes/+page.svelte`
  - заменить открытие PDF/thumbnail через `/api/b2/file` на поток:
    - получить signed download URL
    - скачать шифрованный blob
    - расшифровать в браузере
    - показать файл/превью.
- `src/lib/components/nav-menu.svelte`
  - исправить `keepfocus` -> `keepFocus`.
- `src/routes/+page.svelte`
  - поправить тип `DocumentItem` (`description`) и некорректный self-closing `textarea`.

### Конфиги/infra
- `svelte.config.js`
  - проверить совместимость с Netlify Functions и текущим adapter-netlify.
- `.env.example`
  - обновить список env под новую схему (`B2_*`, firebase admin credentials).

## 3. Что добавляем

### Крипто-слой (клиент)
- `src/lib/crypto/crypto.ts`
  - генерация/импорт ключей, AES-GCM encrypt/decrypt, wrap/unwrap DEK.
  - base64/ArrayBuffer утилиты.
- `src/lib/crypto/key-storage.ts`
  - IndexedDB storage для `masterKey`/device state.
- `src/lib/crypto/master-key.ts`
  - init flow: first login, recovery flow, backup phrase.

### Серверный B2 presign слой
- `netlify/functions/get-upload-url.mts`
  - verify Firebase token.
  - получить B2 upload URL/token.
  - вернуть `uploadUrl + uploadAuthToken + b2Key`.
- `netlify/functions/get-download-url.mts`
  - verify Firebase token.
  - проверить ownership по `b2Key`.
  - выдать signed download URL с TTL.
- `src/lib/server/auth.ts`
  - единая функция verify ID token для серверных маршрутов/функций.
- `src/lib/server/b2.ts`
  - общий B2 helper для serverless функций (authorize, get upload/download auth, delete).

### Новые API для метаданных файлов
- `src/routes/api/files/+server.ts`
  - CRUD метаданных файла (без передачи бинарника).
- `src/routes/api/files/[id]/+server.ts`
  - update/delete метаданных и cleanup B2 по `b2Key`.

## 4. Фазы выполнения

## Фаза 0. Подготовка и совместимость
- Зафиксировать типы и минимальные багфиксы (`svelte-check` должен пройти).
- Добавить слой verify token, не ломая текущий UI.
- Результат: проект компилируется и типчек зеленый.

## Фаза 1. Серверная аутентификация
- Перевести `documents/sections` API на `uid` из токена.
- На клиенте добавить передачу `Authorization` в fetch-запросы.
- Результат: ни один write endpoint не зависит от `userId` из body/query.

## Фаза 2. Presigned URLs
- Добавить Netlify Functions для upload/download URL.
- Подключить их в клиентский слой.
- Результат: браузер загружает/скачивает файл напрямую в/из B2 без раскрытия B2 credentials.

## Фаза 3. Крипто-ядро
- Реализовать `Master Key` + `DEK` + AES-GCM утилиты.
- Реализовать хранение ключа в IndexedDB и recovery flow.
- Результат: на B2 отправляются только зашифрованные bytes.

## Фаза 4. Переключение UI на новый поток
- Переписать `upload/+page.svelte` и чтение файлов на `+page.svelte`.
- Убрать legacy `api/b2/file` зависимость.
- Результат: просмотр/скачивание работают только через decrypt на клиенте.

## Фаза 5. Очистка legacy
- Удалить `api/user/b2`, `api/settings`, `api/b2/*` legacy.
- Удалить `b2-creds.ts` и неиспользуемые env.
- Результат: один путь загрузки/скачивания, без дублирования.

## 5. Критерии готовности

- `pnpm run check` без ошибок.
- `pnpm run build` без ошибок.
- Нет маршрутов, где `userId` берется из клиентского payload как источник истины.
- Файлы в B2 невозможно открыть как plaintext.
- С нового устройства доступ восстанавливается через backup flow.
- Удаление файла удаляет и B2 blob, и метаданные.
- Нет кода миграции/dual-read для legacy-структур.

## 6. Риски и контроль

- Риск: XSS утечет ключ из памяти.
  - Контроль: CSP, минимизация сторонних скриптов, strict sanitization.
- Риск: несовместимость Netlify Function runtime.
  - Контроль: локальная проверка функций и отдельный smoke-test после deploy.

## 7. Порядок старта (следующий шаг)

1. Исправить compile/type ошибки и внедрить серверный verify token слой.
2. Ввести presigned upload/download endpoints.
3. Перевести upload на client-side encryption и новый upload flow.
