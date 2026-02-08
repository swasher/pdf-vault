# PDF Vault — рабочая спецификация

Обновлено после внедрения клиентской генерации превью, загрузки в Backblaze B2 и хранения метаданных в Firestore через SvelteKit API.

## Текущий стек
- SvelteKit + shadcn-svelte UI.
- Firebase Auth (клиент).
- Firestore (через admin SDK на серверных маршрутах SvelteKit).
- Backblaze B2 для хранения PDF и миниатюр.
- PDF.js (`pdfjs-dist`) с динамическим worker из пакета.

## Переменные окружения
- `BLACKBAZE_KEYID`, `BLACKBAZE_APPLICATIONKEY`, `BLACKBAZE_BUCKETID`, `BLACKBAZE_BUCKETNAME`, `BLACKBAZE_ENDPOINT`.
- `FIREBASE_ADMIN_CREDENTIALS_PATH=./config/firebase-admin.json` (service account, в .gitignore).
- Публичные Firebase конфиги для клиента: `PUBLIC_FIREBASE_API_KEY`, `PUBLIC_FIREBASE_AUTH_DOMAIN`, `PUBLIC_FIREBASE_PROJECT_ID`, `PUBLIC_FIREBASE_STORAGE_BUCKET`, `PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `PUBLIC_FIREBASE_APP_ID`.

## Структура данных (Firestore)
Коллекция `documents`:
```json
{
  "userId": "firebase-uid",
  "title": "File title (без расширения)",
  "description": "",
  "uploadedAt": Timestamp,
  "fileSize": 123456,
  "tags": [],
  "files": {
    "pdf": { "name": "some.pdf", "id": "b2_file_id" },
    "thumbnail": { "name": "some.jpg", "id": "b2_file_id" }
  },
  "metadata": {
    "fileName": "original-name.pdf",
    "pages": null
  },
  "searchTokens": ["file", "title"],
  "section": null
}
```
Примечание: для старых записей `files.*` может быть строкой (имя файла).

## Потоки
### Загрузка (страница `/upload`)
- Требуется вход в Firebase Auth.
- В браузере PDF.js генерирует thumbnail (JPEG ~300px, качество 0.85) с dynamic import (`pdfjs-dist/build/pdf.worker.min.mjs?url`).
- Отправка `FormData` в `/api/b2/upload-url` с полями: `file`, `thumbnail`, `thumbnailName`, `title` (имя без расширения), `userId`.
- Сервер:
  - Авторизуется в B2, получает upload URL, загружает PDF и thumbnail (использует sha1).
  - Сохраняет документ в Firestore (структура выше).
  - Возвращает локальные пути `/api/b2/file?name=...` для PDF и превью.

### Отображение (главная `/`)
- После логина запрашивает `/api/documents?userId=...&limit=50`.
- Сервер возвращает документы, сортирует по `uploadedAt` в коде (без индексов).
- Карточки: превью через `/api/b2/file?name=thumbnail`, ссылка на PDF через тот же маршрут.
- Кнопка удаления с подтверждением (`AlertDialog`).

### Удаление
- Клик по корзине → `AlertDialog`.
- `DELETE /api/documents/[id]`: находит документ в Firestore, удаляет PDF/thumbnail в B2 (использует fileId, при отсутствии пытается найти по имени), затем удаляет документ.

### Вспомогательные маршруты
- `GET /api/b2/file?name=...` — прокси с авторизацией в B2, возвращает файл (PDF/thumbnail).
- `POST /api/documents` — создание записи (используется внутри upload).
- `GET /api/documents` — список по `userId`, сортировка в коде.
- `GET /api/b2/list` — вспомогательный листинг файлов (пока не используется в UI).
- `GET/POST /api/settings` — хранит хеш ключа шифрования пользователя (однократно). GET (`?userId=...`) → `{ exists, encryptionKeyHash? }`; POST `{ userId, encryptionKeyHash }`, 409 если ключ уже установлен.

## Навигация
- Header: кнопки `PDF` (главная), `Upload`, `Settings`, переключатель темы, логин/аватар. Поиск в header (только на `/`): `q` в URL, фильтрация на клиенте.
- Sidebar — демо, не основная навигация.

## Ограничения и валидаторы
- Только PDF, максимум 200MB (валидация в upload UI).
- Без индексов Firestore: сортировка по `uploadedAt` делается в приложении (индекс можно включить позже).
- Требуется аутентификация для загрузки и просмотра своих документов.

## UI/UX, состояния
- Upload: спиннер на генерации/отправке, превью до загрузки, ошибки отображаются в карточке.
- Главная: скелет/текстовые состояния при загрузке/ошибке/пустом списке.
- Удаление: подтверждение через AlertDialog, показ ошибки при неудаче.
- Поиск: клиентский (до ~500 доков), фильтрация по title/description/tags/metadata.fileName; debounce 250мс; `q` из URL; блок “Результаты поиска” при активном запросе.
- Кэш превью: `/api/b2/file` возвращает `Cache-Control: public, max-age=31536000, immutable` и `ETag`, поэтому превью/файлы не перетягиваются повторно при неизменных именах.

## Дальнейшие улучшения (по запросу)
- Индексы Firestore (userId + uploadedAt, tags).
- Редактирование title/description/tags.
- Поиск/фильтры в Firestore вместо локального списка.
- Signed download URLs с TTL вместо прямого прокси.
- Папки/sections: хранить в `files` путях и в поле `section`.
- Toasts для успеха/ошибок, пагинация/виртуализация.

## Ключ шифрования, загрузка и гейт
- `/settings`: ввод ключа (видимый текст), генерация (BIP39 слова). Ключ задаётся один раз; если уже есть документы и ключа нет — ввод/сохранение блокируются, чтобы не потерять доступ. Хранится хеш в Firestore (`users/{uid}/settings/encryption`) и копия в localStorage (`pdf-vault:key`). Смена/очистка не поддерживаются.
- Если документов нет и ключ не задан — загрузка запрещена (гейт): пользователь должен сначала задать ключ.
