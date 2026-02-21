# Загрузка файлов в Backblaze B2 через Presigned URLs
### Netlify Functions + B2 — как это работает и как реализовать

---

## Содержание

1. [Глоссарий](#глоссарий)
2. [Почему не хранить креды в Firebase](#почему-не-хранить-креды-в-firebase)
3. [Как работают Presigned URLs](#как-работают-presigned-urls)
4. [Полная схема загрузки и скачивания](#полная-схема)
5. [Реализация](#реализация)
6. [Конфигурация](#конфигурация)

---

## Глоссарий

**B2 Application Key** — credentials для доступа к Backblaze B2. Состоят из `keyId` и `applicationKey`. Аналог логина и пароля, но для API. Бывают master (полный доступ) и restricted (ограниченный — только конкретный bucket, только запись и т.д.). Никогда не должны попадать в браузер.

**Presigned URL (pre-authorized URL)** — временная ссылка, в которую уже встроены credentials и разрешения. Тот, кто получил эту ссылку, может выполнить ровно одно разрешённое действие (например, загрузить файл) без знания настоящих credentials. Ссылка действует ограниченное время (обычно минуты или часы), после чего становится недействительной.

**Netlify Functions** — serverless-функции, которые живут в твоём репозитории в папке `netlify/functions/`. Деплоятся автоматически вместе с сайтом. Вызываются как обычные HTTP-эндпоинты (`/.netlify/functions/имя`). Имеют доступ к переменным окружения Netlify, которые недоступны браузеру.

**Serverless** — модель выполнения кода, при которой сервер не работает постоянно. Функция запускается только при входящем запросе, выполняется и останавливается. Ты платишь только за время выполнения. Netlify Functions — реализация serverless поверх AWS Lambda.

**Environment Variables (переменные окружения)** — способ передать секреты в приложение без хардкода в коде. В Netlify задаются в настройках проекта (Site Settings → Environment Variables). Доступны только серверному коду (Functions), но не попадают в JS-бандл.

**Firebase Auth Token (ID Token)** — JWT-токен, который Firebase выдаёт пользователю после аутентификации. Подписан Firebase, содержит uid и другие данные. Netlify Function может проверить его валидность, чтобы убедиться, что запрос пришёл от аутентифицированного пользователя.

**b2_get_upload_url** — метод B2 API, который возвращает временный URL и токен для загрузки одного файла. Именно его вызывает Netlify Function и возвращает браузеру.

**b2_get_download_authorization** — аналогичный метод для скачивания из приватного bucket. Возвращает токен, который добавляется к URL скачивания.

**Bucket** — контейнер для файлов в B2. Аналог папки верхнего уровня или отдельного диска. Может быть публичным (любой может скачать) или приватным (нужен токен). Для личного хранилища — приватный.

---

## Почему не хранить креды в Firebase

Интуитивно кажется удобным: положил B2 credentials в Firestore, защитил правилами, клиент забирает по необходимости. Но у этого подхода есть фундаментальная проблема.

**Правила Firestore защищают от анонимного доступа, но не от аутентифицированного пользователя.** Ты — единственный пользователь, значит правило `allow read: if request.auth.uid == userId` даёт тебе полный доступ к этому документу. И это же означает, что если твой Firebase-аккаунт будет скомпрометирован (угнан токен, XSS в приложении, утечка сессии) — атакующий получит B2 credentials и сможет работать с B2 напрямую, минуя твоё приложение полностью: читать, удалять, заливать произвольные файлы.

С Netlify Function картина другая:

| | Firebase хранение | Netlify Function |
|---|---|---|
| Где живут B2 credentials | Firestore (доступен клиенту) | Переменные окружения Netlify (недоступны клиенту физически) |
| Что получает атакующий при угоне сессии | B2 credentials напрямую | Только presigned URL на один файл, действующий несколько минут |
| Может ли клиент обратиться к B2 напрямую | Да | Нет |
| Сложность реализации | Проще | 20 строк кода в Function |

---

## Как работают Presigned URLs

### Концепция

Обычный запрос к B2 выглядит так:
```
PUT /file/my-bucket/file.bin
Authorization: Basic <B2_KEY_ID>:<B2_APP_KEY>
```

Presigned URL переносит авторизацию в саму ссылку:
```
POST https://upload.backblazeb2.com/b2api/v2/b2_upload_file
X-Bz-Upload-Url: <временный url>
Authorization: <временный токен>
```

Временный токен выдан B2, действует ограниченное время, разрешает строго одно действие. Браузер использует его, не зная настоящих credentials.

### Жизненный цикл

```
                    ┌─────────────────────────────────────┐
                    │         NETLIFY FUNCTION             │
                    │                                      │
B2_KEY_ID      ────►│                                      │
B2_APP_KEY     ────►│  b2_authorize_account()              │
(env vars)          │         ↓                            │
                    │  b2_get_upload_url()                 │
                    │         ↓                            │
                    │  { uploadUrl, uploadAuthToken }  ────┼──► браузер
                    │                                      │   (живёт ~24ч)
                    └─────────────────────────────────────┘

Браузер получил uploadUrl + uploadAuthToken
         ↓
PUT напрямую в B2 (без участия Netlify)
         ↓
Файл в B2. Netlify больше не участвует.
```

---

## Полная схема

### Загрузка файла

```
Браузер (Svelte)              Netlify Function              Backblaze B2
       │                      /get-upload-url                     │
       │                             │                            │
       │  1. Шифруем файл            │                            │
       │     локально                │                            │
       │     (DEK + AES-GCM)         │                            │
       │                             │                            │
       │  2. POST /get-upload-url    │                            │
       │     { filename, uid }       │                            │
       │     Authorization: Bearer   │                            │
       │     <Firebase ID Token>     │                            │
       │────────────────────────────►│                            │
       │                             │  3. Проверяем              │
       │                             │     Firebase ID Token      │
       │                             │                            │
       │                             │  4. b2_authorize_account() │
       │                             │─────────────────────────► │
       │                             │◄──────────────────────────│
       │                             │     accountAuthToken       │
       │                             │                            │
       │                             │  5. b2_get_upload_url()    │
       │                             │─────────────────────────► │
       │                             │◄──────────────────────────│
       │                             │  { uploadUrl,              │
       │                             │    uploadAuthToken }       │
       │                             │                            │
       │◄────────────────────────────│                            │
       │  { uploadUrl,               │                            │
       │    uploadAuthToken,         │                            │
       │    b2Key }                  │                            │
       │                             │                            │
       │  6. PUT зашифрованный файл  │                            │
       │     напрямую в B2           │                            │
       │─────────────────────────────────────────────────────── ►│
       │◄───────────────────────────────────────────────────────  │
       │  200 OK                     │                            │
       │                             │                            │
       │  7. Сохраняем метаданные    │                            │
       │     в Firestore             │                            │
       │     (b2Key, encryptedDEK,   │                            │
       │      fileIV, dekIV...)      │                            │
```

### Скачивание файла

```
Браузер (Svelte)              Netlify Function              Backblaze B2
       │                      /get-download-url                   │
       │                             │                            │
       │  1. Берём метаданные        │                            │
       │     из Firestore            │                            │
       │     (b2Key, encryptedDEK,   │                            │
       │      fileIV, dekIV)         │                            │
       │                             │                            │
       │  2. POST /get-download-url  │                            │
       │     { b2Key }               │                            │
       │     Authorization: Bearer   │                            │
       │     <Firebase ID Token>     │                            │
       │────────────────────────────►│                            │
       │                             │  3. Проверяем токен        │
       │                             │                            │
       │                             │  4. b2_get_download_       │
       │                             │     authorization()        │
       │                             │─────────────────────────► │
       │                             │◄──────────────────────────│
       │                             │     downloadAuthToken      │
       │                             │                            │
       │◄────────────────────────────│                            │
       │  { downloadUrl }            │                            │
       │  (URL с токеном внутри)     │                            │
       │                             │                            │
       │  5. GET напрямую из B2      │                            │
       │─────────────────────────────────────────────────────── ►│
       │◄───────────────────────────────────────────────────────  │
       │  зашифрованный blob         │                            │
       │                             │                            │
       │  6. Расшифровываем          │                            │
       │     локально                │                            │
       │     (DEK → AES-GCM)         │                            │
```

---

## Реализация

### Структура проекта

```
my-app/
  netlify/
    functions/
      get-upload-url.mts      ← выдаёт presigned URL для загрузки
      get-download-url.mts    ← выдаёт presigned URL для скачивания
  src/
    lib/
      b2.ts                   ← клиентский код работы с B2
  netlify.toml
```

### netlify/functions/get-upload-url.mts

```typescript
import type { Context } from "@netlify/functions";

// B2 credentials живут только здесь, в переменных окружения
const B2_KEY_ID      = process.env.B2_KEY_ID!;
const B2_APP_KEY     = process.env.B2_APP_KEY!;
const B2_BUCKET_ID   = process.env.B2_BUCKET_ID!;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID!;

// ─── Проверка Firebase ID Token ──────────────────────────────────────────────

async function verifyFirebaseToken(idToken: string): Promise<string> {
  // Используем публичный Firebase endpoint для верификации токена
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) throw new Error("Invalid Firebase token");
  const data = await res.json();
  return data.users[0].localId; // uid
}

// ─── B2 API ──────────────────────────────────────────────────────────────────

async function b2Authorize() {
  const credentials = btoa(`${B2_KEY_ID}:${B2_APP_KEY}`);
  const res = await fetch("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (!res.ok) throw new Error("B2 auth failed");
  return res.json(); // { apiUrl, authorizationToken }
}

async function b2GetUploadUrl(apiUrl: string, authToken: string, bucketId: string) {
  const res = await fetch(`${apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: "POST",
    headers: {
      Authorization: authToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ bucketId }),
  });
  if (!res.ok) throw new Error("b2_get_upload_url failed");
  return res.json(); // { uploadUrl, authorizationToken }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // 1. Проверяем Firebase токен
    const authHeader = req.headers.get("Authorization") ?? "";
    const idToken = authHeader.replace("Bearer ", "");
    const uid = await verifyFirebaseToken(idToken);

    // 2. Генерируем ключ файла
    const { filename } = await req.json();
    const uuid = crypto.randomUUID();
    const b2Key = `files/${uid}/${uuid}.bin`;

    // 3. Получаем upload URL от B2
    const { apiUrl, authorizationToken } = await b2Authorize();
    const { uploadUrl, authorizationToken: uploadAuthToken } = await b2GetUploadUrl(
      apiUrl, authorizationToken, B2_BUCKET_ID
    );

    return new Response(
      JSON.stringify({ uploadUrl, uploadAuthToken, b2Key }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error(e);
    return new Response("Unauthorized", { status: 401 });
  }
};

export const config = { path: "/get-upload-url" };
```

### netlify/functions/get-download-url.mts

```typescript
import type { Context } from "@netlify/functions";

const B2_KEY_ID    = process.env.B2_KEY_ID!;
const B2_APP_KEY   = process.env.B2_APP_KEY!;
const B2_BUCKET_NAME = process.env.B2_BUCKET_NAME!;

async function verifyFirebaseToken(idToken: string): Promise<string> {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) throw new Error("Invalid token");
  const data = await res.json();
  return data.users[0].localId;
}

async function b2Authorize() {
  const credentials = btoa(`${B2_KEY_ID}:${B2_APP_KEY}`);
  const res = await fetch("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", {
    headers: { Authorization: `Basic ${credentials}` },
  });
  return res.json();
}

async function b2GetDownloadAuth(apiUrl: string, authToken: string, b2Key: string) {
  const res = await fetch(`${apiUrl}/b2api/v2/b2_get_download_authorization`, {
    method: "POST",
    headers: { Authorization: authToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      bucketId: process.env.B2_BUCKET_ID,
      fileNamePrefix: b2Key,
      validDurationInSeconds: 3600, // ссылка действует 1 час
    }),
  });
  return res.json(); // { authorizationToken, fileNamePrefix, bucketName }
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const uid = await verifyFirebaseToken(authHeader.replace("Bearer ", ""));

    const { b2Key } = await req.json();

    // Проверяем, что файл принадлежит этому пользователю
    if (!b2Key.startsWith(`files/${uid}/`)) {
      return new Response("Forbidden", { status: 403 });
    }

    const { downloadUrl, authorizationToken } = await b2Authorize();
    const { authorizationToken: downloadToken } = await b2GetDownloadAuth(
      downloadUrl, authorizationToken, b2Key
    );

    const signedUrl = `${downloadUrl}/file/${B2_BUCKET_NAME}/${b2Key}?Authorization=${downloadToken}`;

    return new Response(
      JSON.stringify({ downloadUrl: signedUrl }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response("Unauthorized", { status: 401 });
  }
};

export const config = { path: "/get-download-url" };
```

### src/lib/b2.ts — клиентский код

```typescript
import { auth } from "./firebase";

async function getIdToken(): Promise<string> {
  const token = await auth.currentUser!.getIdToken();
  return token;
}

// ─── Загрузка ─────────────────────────────────────────────────────────────────

export async function uploadEncryptedFile(
  encryptedBuffer: ArrayBuffer,
  filename: string
): Promise<string> {
  const idToken = await getIdToken();

  // 1. Просим Function выдать presigned URL
  const res = await fetch("/.netlify/functions/get-upload-url", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ filename }),
  });

  const { uploadUrl, uploadAuthToken, b2Key } = await res.json();

  // 2. Загружаем напрямую в B2 — Netlify больше не участвует
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: uploadAuthToken,
      "Content-Type": "application/octet-stream",
      "X-Bz-File-Name": encodeURIComponent(b2Key),
      "X-Bz-Content-Sha1": "do_not_verify", // или считаем sha1 для integrity
    },
    body: encryptedBuffer,
  });

  if (!uploadRes.ok) throw new Error("B2 upload failed");

  return b2Key; // сохраняем в Firestore
}

// ─── Скачивание ───────────────────────────────────────────────────────────────

export async function downloadEncryptedFile(b2Key: string): Promise<ArrayBuffer> {
  const idToken = await getIdToken();

  // 1. Просим Function выдать presigned download URL
  const res = await fetch("/.netlify/functions/get-download-url", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ b2Key }),
  });

  const { downloadUrl } = await res.json();

  // 2. Скачиваем напрямую из B2
  const fileRes = await fetch(downloadUrl);
  if (!fileRes.ok) throw new Error("B2 download failed");

  return fileRes.arrayBuffer();
}
```

---

## Конфигурация

### netlify.toml

```toml
[build]
  command = "npm run build"
  publish = "dist"
  functions = "netlify/functions"

[functions]
  node_bundler = "esbuild"
```

### Переменные окружения в Netlify

Netlify Dashboard → Site Settings → Environment Variables:

```
B2_KEY_ID          = 00a1b2c3d4e5f6...
B2_APP_KEY         = K00xxxxxxxxxxxxx...
B2_BUCKET_ID       = e73xxxxxxxxxxxxxxx
B2_BUCKET_NAME     = my-storage-files
FIREBASE_PROJECT_ID = my-project-id
FIREBASE_API_KEY   = AIzaSy...
```

> B2 Application Key лучше создать **restricted** — только для конкретного bucket, только операции `readFiles` и `writeFiles`. Тогда даже если ключ утечёт, атакующий не сможет удалить bucket или изменить настройки.

### Как создать restricted B2 key

В консоли Backblaze B2: App Keys → Add a New Application Key:

```
Name of Key:        netlify-function-key
Allow access to:    [выбрать конкретный bucket]
Type of access:     Read and Write
File name prefix:   (оставить пустым)
Duration (seconds): (оставить пустым — бессрочный)
```
```

---

*B2 credentials физически не существуют в JS-бандле и не передаются в браузер ни при каких обстоятельствах. Netlify Function — единственная точка, где они используются, и она выполняется только на сервере Netlify.*
