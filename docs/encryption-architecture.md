# Архитектура шифрования для личного файлового хранилища
### Svelte + Backblaze B2 + Firebase — полное руководство

---

## Содержание

1. [Глоссарий — «справочник для тупых»](#глоссарий)
2. [Общая архитектура](#общая-архитектура)
3. [Почему именно такая схема](#почему-именно-такая-схема)
4. [Что где хранится](#что-где-хранится)
5. [Структуры данных](#структуры-данных)
6. [UX-флоу: первый вход, обычный вход, новое устройство](#ux-флоу)
7. [Реализация на WebCrypto API](#реализация-на-webcrypto-api)
8. [Как расшифровать файлы вручную](#как-расшифровать-файлы-вручную)
9. [Чеклист надёжности](#чеклист-надёжности)

---

## Глоссарий

Прежде чем читать дальше — разберём термины, которые будут встречаться повсюду.

### Ключи

**Master Key** — твой главный секрет. 256-битное случайное число, которое генерируется один раз при создании аккаунта. Все остальные ключи в системе защищены им. Никогда не покидает твои устройства в открытом виде.

**KEK (Key Encryption Key)** — «ключ для шифрования ключей». В нашей схеме это и есть Master Key. Термин подчёркивает роль: этот ключ не шифрует файлы напрямую, он шифрует другие ключи.

**DEK (Data Encryption Key)** — «ключ для шифрования данных». Уникальный ключ на каждый файл. Генерируется случайно в момент загрузки файла. Именно им шифруется содержимое файла. Сам DEK хранится в Firebase в зашифрованном виде (зашифрован Master Key'ем).

**Derived Key / derivedKey** — ключ, выведенный из пароля или другой строки через специальную функцию (PBKDF2). Не хранится нигде — каждый раз вычисляется заново из исходной строки. Использовался бы для защиты Master Key, если бы мы хранили мастер-ключ в Firebase (в нашей схеме — не используется).

### Алгоритмы

**AES-GCM (Advanced Encryption Standard — Galois/Counter Mode)** — симметричный алгоритм шифрования. «Симметричный» значит: один и тот же ключ шифрует и расшифровывает. GCM — режим работы, который дополнительно проверяет целостность данных (если файл был испорчен или подменён — расшифровка провалится с ошибкой). Мы используем AES-GCM-256 (256-битный ключ).

**PBKDF2 (Password-Based Key Derivation Function 2)** — функция, которая превращает пароль (или любую строку) в криптографический ключ. Намеренно медленная: делает перебор паролей атакующим дорогостоящим. Параметр `iterations: 600_000` означает, что функция хэширует данные 600 тысяч раз.

**SHA-256** — криптографическая хэш-функция. Из любых данных получает 256-битный «отпечаток». Необратима: по отпечатку нельзя восстановить исходные данные. Используется внутри PBKDF2.

### Примитивы

**IV (Initialization Vector) / Nonce** — случайное число, которое генерируется заново при каждой операции шифрования. Гарантирует, что один и тот же файл, зашифрованный одним и тем же ключом дважды, даст разный результат. **Не секретный** — хранится в открытом виде рядом с зашифрованными данными. Без IV расшифровка невозможна.

**Salt (соль)** — случайное число для PBKDF2. Гарантирует, что одинаковые пароли дают разные ключи у разных пользователей. Не секретный — хранится рядом с зашифрованным мастер-ключом.

**Base64** — способ закодировать бинарные данные (байты) в текстовую строку. Используется для хранения ключей и зашифрованных данных в JSON/Firestore.

**WebCrypto API** — встроенный в браузер (и Node.js) криптографический модуль. Не требует установки библиотек. Реализует все нужные нам алгоритмы. **Ключевое преимущество:** стандартный, аудированный, воспроизводимый — можно расшифровать данные в любом окружении, которое поддерживает WebCrypto.

**IndexedDB** — встроенная в браузер база данных. Персистентна между сессиями (в отличие от sessionStorage/localStorage более вместительна и надёжна для бинарных данных). Используется для хранения Master Key на устройстве.

---

## Общая архитектура

```
┌─────────────────────────────────────────────────────────────────────┐
│                         УСТРОЙСТВО ПОЛЬЗОВАТЕЛЯ                      │
│                                                                       │
│   ┌────────────────┐      ┌──────────────────────────────────────┐   │
│   │   IndexedDB    │      │              Память браузера          │   │
│   │                │      │                                      │   │
│   │  Master Key ◄──┼──────┼── загружается при старте сессии     │   │
│   │  (зашифрован   │      │                                      │   │
│   │   deviceKey)   │      │   Master Key (в памяти, не на диске) │   │
│   └────────────────┘      └──────────┬───────────────────────────┘   │
│                                      │                                │
│                            ┌─────────▼──────────┐                    │
│                            │   Svelte App       │                    │
│                            │                    │                    │
│                            │  Encrypt / Decrypt │                    │
│                            └────────┬──────┬────┘                    │
└─────────────────────────────────────┼──────┼─────────────────────────┘
                                      │      │
              ┌───────────────────────┘      └──────────────────┐
              │                                                  │
              ▼                                                  ▼
┌─────────────────────────┐                    ┌────────────────────────┐
│         FIREBASE         │                    │      BACKBLAZE B2      │
│                          │                    │                        │
│  /users/{uid}            │                    │  /files/{uid}/         │
│    encryptedMasterKey    │                    │    {uuid}.bin          │
│    masterKeyIV           │                    │    (зашифрованный      │
│    deviceKeySalt         │                    │     бинарный blob)     │
│                          │                    │                        │
│  /users/{uid}/files/     │                    │  Никаких метаданных.   │
│    {fileId}              │                    │  Только байты.         │
│      name                │                    └────────────────────────┘
│      size                │
│      mimeType            │
│      encryptedDEK        │
│      dekIV               │
│      fileIV              │
│      b2Key               │
│      uploadedAt          │
└─────────────────────────-┘
```

### Принцип минимального доверия

- **Backblaze видит:** зашифрованные байты без каких-либо метаданных. Бесполезно без ключей.
- **Firebase видит:** зашифрованные DEK-и, зашифрованный Master Key, имена файлов (можно тоже зашифровать), размеры. Master Key зашифрован deviceKey, который никогда не покидает устройство.
- **Устройство знает:** Master Key в памяти во время сессии, deviceKey в IndexedDB.
- **Ты знаешь:** строку бэкапа (Backup Phrase), которая позволяет восстановить Master Key на новом устройстве.

---

## Почему именно такая схема

### Почему два уровня ключей (Master Key → DEK), а не один?

Если бы мы шифровали все файлы напрямую Master Key'ем:
- Смена Master Key = перешифровать все файлы заново (гигабайты данных)
- Скомпрометирован один файл = потенциально скомпрометированы все

С DEK на каждый файл:
- Смена Master Key = перешифровать только DEK-и в Firestore (килобайты, мгновенно)
- Компрометация одного DEK = только один файл под угрозой

### Почему Master Key не хранится в Firebase в открытом виде?

Потому что тогда шифрование файлов теряет смысл: любой, кто получит доступ к Firebase (утечка, баг в правилах безопасности, взлом аккаунта Google), автоматически получит Master Key и расшифрует всё.

### Почему IndexedDB, а не sessionStorage или localStorage?

- **localStorage** — строки только, синхронный, медленный для больших данных, легко читается через XSS
- **sessionStorage** — то же самое, но очищается при закрытии вкладки (неудобно)
- **IndexedDB** — бинарные данные, асинхронный, поддерживает `CryptoKey` объекты напрямую (без конвертации в base64), персистентен между сессиями

### Почему WebCrypto, а не noble/ciphers или другие библиотеки?

WebCrypto встроен в браузер и Node.js — нет внешних зависимостей, нет проблем с цепочками поставок, стандартный и аудированный код. Главное: через 5 лет, когда твоё приложение умрёт, ты всё равно сможешь написать скрипт на любом языке с теми же алгоритмами и расшифровать файлы вручную. Noble — тоже хорошая библиотека, аудированная, но для AES-GCM + PBKDF2 нативного WebCrypto достаточно.

### Почему не используется пароль для защиты Master Key?

Потому что ты один, и место хранения пароля и места хранения строки-бэкапа — одно и то же (менеджер паролей). Дополнительный слой пароля только усложняет UX без реального прироста безопасности. Вместо этого Master Key защищён deviceKey — ключом, привязанным к конкретному устройству/браузеру.

---

## Что где хранится

| Данные | Где хранится | Зашифровано? | Чем зашифровано |
|--------|-------------|--------------|-----------------|
| Master Key (в памяти) | RAM браузера | Нет | — (живёт только во время сессии) |
| Master Key (на диске) | IndexedDB | Да | deviceKey |
| deviceKey | IndexedDB | Нет | — (это и есть ключ шифрования) |
| encryptedMasterKey | Firebase Firestore | Да | deviceKey |
| DEK каждого файла | Firebase Firestore | Да | Master Key |
| Содержимое файла | Backblaze B2 | Да | DEK файла |
| Backup Phrase | У тебя (менеджер паролей) | — | — |
| IV, Salt | Firebase Firestore | Нет | — (публичные параметры) |
| Имя файла, размер, MIME | Firebase Firestore | Нет* | — |

> *Имя файла можно зашифровать Master Key'ем — тогда Firebase вообще не будет знать ничего полезного. Но это усложняет поиск и фильтрацию.

---

## Структуры данных

### Firebase Firestore

```
users/
  {uid}/
    masterKeySetup:     true
    encryptedMasterKey: "base64..."    // Master Key, зашифрованный deviceKey
    masterKeyIV:        "base64..."    // IV для расшифровки encryptedMasterKey
    deviceKeySalt:      "base64..."    // соль для деривации deviceKey из uid
    createdAt:          timestamp
    backupVerified:     true           // пользователь подтвердил, что сохранил Backup Phrase

    files/
      {fileId}/
        name:           "photo.jpg"
        size:           2048576
        mimeType:       "image/jpeg"
        uploadedAt:     timestamp
        b2Key:          "files/{uid}/a3f9c2d1-....bin"  // путь в Backblaze
        encryption/
          encryptedDEK: "base64..."    // DEK файла, зашифрованный Master Key'ем
          dekIV:        "base64..."    // IV для расшифровки DEK
          fileIV:       "base64..."    // IV для расшифровки самого файла
          algorithm:    "AES-GCM-256"
```

### IndexedDB (в браузере)

```
DB: "storage-app"
  Store: "keys"
    {
      id:          "masterKey",
      key:         CryptoKey,           // объект WebCrypto, не экспортируемый
      algorithm:   "AES-GCM",
      extractable: false
    }
    {
      id:          "deviceKey",
      key:         CryptoKey,           // используется для wrap/unwrap masterKey
      algorithm:   "AES-GCM",
      extractable: false
    }
    {
      id:          "masterKeyBackup",
      encryptedKey: ArrayBuffer,        // зашифрованный мастер-ключ (резерв)
      iv:           ArrayBuffer
    }
```

### Backblaze B2

```
Bucket: "my-storage-files"
  files/
    {uid}/
      a3f9c2d1-8b4e-4f2a-9c1d-7e3f5a2b8c4d.bin   // просто байты, никаких метаданных
      b7e1f4a2-...bin
      ...
```

Имя файла в B2 — случайный UUID. Никакой связи с реальным именем файла. Метаданные B2 не используются.

---

## UX-флоу

### Сценарий 1: Первый вход (новый аккаунт)

```
1. Пользователь логинится через Firebase Auth (Google / email)
   ↓
2. Приложение проверяет Firestore: /users/{uid}/masterKeySetup
   → поле отсутствует → это первый вход
   ↓
3. Генерируем случайный Master Key (256 бит):
   masterKey = crypto.getRandomValues(new Uint8Array(32))
   ↓
4. Генерируем deviceKey (привязан к этому браузеру):
   deviceKey = await crypto.subtle.generateKey({name: "AES-GCM", length: 256}, false, ["wrapKey", "unwrapKey"])
   ↓
5. Шифруем Master Key deviceKey'ем:
   { encryptedMasterKey, masterKeyIV } = wrapKey(masterKey, deviceKey)
   ↓
6. Сохраняем в Firestore:
   encryptedMasterKey, masterKeyIV
   ↓
7. Сохраняем в IndexedDB:
   masterKey (как CryptoKey объект)
   deviceKey (как CryptoKey объект)
   ↓
8. Генерируем Backup Phrase из Master Key (base58 или base32, ~43 символа)
   ↓
9. Показываем пользователю экран:
   "Сохрани эту строку. Если потеряешь — файлы исчезнут навсегда."
   [XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX]
   [Я сохранил] ← только после нажатия пускаем дальше
   ↓
10. Записываем в Firestore: masterKeySetup: true, backupVerified: true
    ↓
11. Готово. Пользователь в приложении.
```

### Сценарий 2: Обычный вход (тот же браузер)

```
1. Пользователь логинится через Firebase Auth
   ↓
2. Проверяем IndexedDB: есть ли masterKey?
   → есть → загружаем в память
   ↓
3. Готово. Пользователь в приложении. Ничего не спрашивали.
```

### Сценарий 3: Новое устройство / очищен браузер

```
1. Пользователь логинится через Firebase Auth
   ↓
2. Проверяем IndexedDB: есть ли masterKey?
   → нет → смотрим Firestore: masterKeySetup = true
   → значит аккаунт есть, но ключа на устройстве нет
   ↓
3. Показываем экран:
   "Введи Backup Phrase для восстановления доступа"
   [_________________________________________]
   ↓
4. Пользователь вводит Backup Phrase
   → восстанавливаем Master Key из строки
   ↓
5. Генерируем новый deviceKey для этого устройства
   → шифруем Master Key новым deviceKey
   → сохраняем в IndexedDB (masterKey + deviceKey)
   → обновляем encryptedMasterKey в Firestore (опционально,
     или можем хранить несколько записей для разных устройств)
   ↓
6. Готово.
```

### Сценарий 4: Загрузка файла

```
1. Пользователь выбирает файл
   ↓
2. Генерируем случайный DEK:
   dek = crypto.getRandomValues(new Uint8Array(32))
   ↓
3. Шифруем файл DEK'ом (AES-GCM):
   fileIV = crypto.getRandomValues(new Uint8Array(12))
   encryptedFile = AES-GCM-Encrypt(file.bytes, dek, fileIV)
   ↓
4. Шифруем DEK Master Key'ем:
   dekIV = crypto.getRandomValues(new Uint8Array(12))
   encryptedDEK = AES-GCM-Encrypt(dek, masterKey, dekIV)
   ↓
5. Загружаем encryptedFile в Backblaze B2 → получаем b2Key
   ↓
6. Сохраняем метаданные в Firestore:
   { name, size, mimeType, b2Key, encryptedDEK, dekIV, fileIV }
   ↓
7. Готово.
```

### Сценарий 5: Скачивание файла

```
1. Пользователь кликает на файл
   ↓
2. Из Firestore читаем метаданные: encryptedDEK, dekIV, fileIV, b2Key
   ↓
3. Расшифровываем DEK Master Key'ем:
   dek = AES-GCM-Decrypt(encryptedDEK, masterKey, dekIV)
   ↓
4. Скачиваем зашифрованный файл из Backblaze B2
   ↓
5. Расшифровываем файл DEK'ом:
   file.bytes = AES-GCM-Decrypt(encryptedFile, dek, fileIV)
   ↓
6. Отдаём пользователю (download или preview).
```

---

## Реализация на WebCrypto API

### utils/crypto.ts

```typescript
// ─── Генерация ключей ────────────────────────────────────────────────────────

/** Генерирует случайный 256-битный ключ */
export async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,  // extractable: нужно для wrapKey
    ['encrypt', 'decrypt']
  );
}

/** Генерирует deviceKey — не экспортируемый, живёт только в IndexedDB */
export async function generateDeviceKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,  // не экспортируемый — привязан к браузеру
    ['wrapKey', 'unwrapKey']
  );
}

// ─── Backup Phrase ───────────────────────────────────────────────────────────

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Конвертирует Master Key (32 байта) в читаемую строку */
export async function masterKeyToPhrase(masterKey: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', masterKey);
  const bytes = new Uint8Array(raw);
  // Простая кодировка: hex с разделителями для читаемости
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  // Разбиваем на группы по 8 символов
  return hex.match(/.{1,8}/g)!.join('-').toUpperCase();
  // Пример: A3F9C2D1-8B4E4F2A-9C1D7E3F-5A2B8C4D-...
}

/** Восстанавливает Master Key из строки */
export async function phraseToMasterKey(phrase: string): Promise<CryptoKey> {
  const hex = phrase.replace(/-/g, '').toLowerCase();
  if (hex.length !== 64) throw new Error('Неверная длина Backup Phrase');
  const bytes = new Uint8Array(hex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
  return crypto.subtle.importKey(
    'raw', bytes,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

// ─── Wrap / Unwrap (шифрование ключей) ──────────────────────────────────────

/** Шифрует Master Key deviceKey'ем для хранения в IndexedDB/Firestore */
export async function wrapMasterKey(
  masterKey: CryptoKey,
  deviceKey: CryptoKey
): Promise<{ encryptedKey: ArrayBuffer; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedKey = await crypto.subtle.wrapKey('raw', masterKey, deviceKey, {
    name: 'AES-GCM',
    iv,
  });
  return { encryptedKey, iv };
}

/** Расшифровывает Master Key deviceKey'ем */
export async function unwrapMasterKey(
  encryptedKey: ArrayBuffer,
  iv: Uint8Array,
  deviceKey: CryptoKey
): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    'raw',
    encryptedKey,
    deviceKey,
    { name: 'AES-GCM', iv },
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

// ─── DEK (ключи файлов) ──────────────────────────────────────────────────────

/** Шифрует DEK мастер-ключом для хранения в Firestore */
export async function encryptDEK(
  dek: CryptoKey,
  masterKey: CryptoKey
): Promise<{ encryptedDEK: ArrayBuffer; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const rawDEK = await crypto.subtle.exportKey('raw', dek);
  const encryptedDEK = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    masterKey,
    rawDEK
  );
  return { encryptedDEK, iv };
}

/** Расшифровывает DEK мастер-ключом */
export async function decryptDEK(
  encryptedDEK: ArrayBuffer,
  iv: Uint8Array,
  masterKey: CryptoKey
): Promise<CryptoKey> {
  const rawDEK = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    masterKey,
    encryptedDEK
  );
  return crypto.subtle.importKey(
    'raw', rawDEK,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ─── Шифрование файлов ───────────────────────────────────────────────────────

/** Шифрует файл DEK'ом. Возвращает зашифрованные байты и IV */
export async function encryptFile(
  fileBuffer: ArrayBuffer,
  dek: CryptoKey
): Promise<{ encrypted: ArrayBuffer; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    dek,
    fileBuffer
  );
  return { encrypted, iv };
}

/** Расшифровывает файл DEK'ом */
export async function decryptFile(
  encryptedBuffer: ArrayBuffer,
  iv: Uint8Array,
  dek: CryptoKey
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    dek,
    encryptedBuffer
  );
}

// ─── Утилиты конвертации ─────────────────────────────────────────────────────

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach(b => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
```

### utils/keyStorage.ts

```typescript
const DB_NAME = 'storage-app';
const DB_VERSION = 1;
const STORE_NAME = 'keys';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveMasterKey(masterKey: CryptoKey, deviceKey: CryptoKey): Promise<void> {
  const { encryptedKey, iv } = await wrapMasterKey(masterKey, deviceKey);
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put({ id: 'masterKey', encryptedKey, iv });
  tx.objectStore(STORE_NAME).put({ id: 'deviceKey', key: deviceKey });
}

export async function loadMasterKey(): Promise<CryptoKey | null> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);

  const [masterKeyRecord, deviceKeyRecord] = await Promise.all([
    idbGet(store, 'masterKey'),
    idbGet(store, 'deviceKey'),
  ]);

  if (!masterKeyRecord || !deviceKeyRecord) return null;

  return unwrapMasterKey(
    masterKeyRecord.encryptedKey,
    masterKeyRecord.iv,
    deviceKeyRecord.key
  );
}

function idbGet(store: IDBObjectStore, key: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
```

### Полный флоу загрузки файла

```typescript
// stores/files.ts

export async function uploadFile(file: File, masterKey: CryptoKey) {
  // 1. Генерируем DEK
  const dek = await generateKey();

  // 2. Шифруем файл
  const fileBuffer = await file.arrayBuffer();
  const { encrypted: encryptedFile, iv: fileIV } = await encryptFile(fileBuffer, dek);

  // 3. Шифруем DEK
  const { encryptedDEK, iv: dekIV } = await encryptDEK(dek, masterKey);

  // 4. Загружаем в Backblaze B2
  const b2Key = `files/${auth.currentUser!.uid}/${crypto.randomUUID()}.bin`;
  await uploadToB2(b2Key, encryptedFile);  // твоя функция загрузки в B2

  // 5. Сохраняем метаданные в Firestore
  const fileId = doc(collection(db, `users/${auth.currentUser!.uid}/files`)).id;
  await setDoc(doc(db, `users/${auth.currentUser!.uid}/files/${fileId}`), {
    name: file.name,
    size: file.size,
    mimeType: file.type,
    uploadedAt: serverTimestamp(),
    b2Key,
    encryption: {
      encryptedDEK: arrayBufferToBase64(encryptedDEK),
      dekIV: arrayBufferToBase64(dekIV),
      fileIV: arrayBufferToBase64(fileIV),
      algorithm: 'AES-GCM-256',
    }
  });
}
```

---

## Как расшифровать файлы вручную

Если приложение умерло, а файлы нужны — вот скрипт на Node.js. Нужно знать Backup Phrase и иметь доступ к Firestore и Backblaze (через их API или консоль).

```python
# decrypt-manual.py
#
# зависимости:
# pip install cryptography

import base64
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# ─── Параметры (заполнить вручную) ──────────────────────────────────────────

BACKUP_PHRASE      = "A3F9C2D1-8B4E4F2A-9C1D7E3F-5A2B8C4D-..."

ENCRYPTED_DEK_B64  = "base64строка..."
DEK_IV_B64         = "base64строка..."
FILE_IV_B64        = "base64строка..."

ENCRYPTED_FILE     = Path("./downloaded_file.bin")
OUTPUT_FILE        = Path("./decrypted_file.jpg")

# ─── Логика ──────────────────────────────────────────────────────────────────

def phrase_to_master_key(phrase: str) -> bytes:
    hex_str = phrase.replace("-", "").lower()
    assert len(hex_str) == 64, f"Неверная длина Backup Phrase: {len(hex_str)} символов, ожидается 64"
    return bytes.fromhex(hex_str)

def b64(s: str) -> bytes:
    return base64.b64decode(s)

def aes_gcm_decrypt(key: bytes, iv: bytes, ciphertext: bytes) -> bytes:
    return AESGCM(key).decrypt(iv, ciphertext, associated_data=None)

def main():
    print("1. Восстанавливаем Master Key из Backup Phrase...")
    master_key = phrase_to_master_key(BACKUP_PHRASE)

    print("2. Расшифровываем DEK...")
    dek = aes_gcm_decrypt(master_key, b64(DEK_IV_B64), b64(ENCRYPTED_DEK_B64))

    print("3. Читаем зашифрованный файл...")
    encrypted_file = ENCRYPTED_FILE.read_bytes()

    print("4. Расшифровываем файл...")
    decrypted = aes_gcm_decrypt(dek, b64(FILE_IV_B64), encrypted_file)

    OUTPUT_FILE.write_bytes(decrypted)
    print(f"✓ Готово. Файл сохранён: {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
```

**Что нужно для ручного восстановления:**
1. Backup Phrase (строка из менеджера паролей)
2. Данные из Firestore (encryptedDEK, dekIV, fileIV) — экспортировать через консоль Firebase
3. Зашифрованный файл из Backblaze B2 — скачать через консоль B2
4. Node.js (версия 18+, WebCrypto встроен)

---

## Чеклист надёжности

### При разработке

- [ ] Backup Phrase показывается только один раз и не сохраняется в коде/логах
- [ ] Master Key никогда не передаётся на сервер в открытом виде
- [ ] Каждый файл имеет уникальный DEK
- [ ] Каждая операция шифрования использует новый IV (никогда не переиспользовать!)
- [ ] IV и зашифрованные данные хранятся вместе (без IV нельзя расшифровать)
- [ ] `algorithm: "AES-GCM-256"` записывается в метаданные файла — на будущее

### Памятка (сохрани в README проекта)

```
СХЕМА ШИФРОВАНИЯ
================
Алгоритм:        AES-256-GCM
Размер ключей:   256 бит (32 байта)
Размер IV:       96 бит (12 байт)

ИЕРАРХИЯ КЛЮЧЕЙ
===============
Backup Phrase (у меня) 
  → Master Key (IndexedDB, зашифрован deviceKey)
    → DEK файла (Firestore, зашифрован Master Key)
      → Содержимое файла (Backblaze B2)

ГДЕ БРАТЬ ДАННЫЕ ДЛЯ ВОССТАНОВЛЕНИЯ
=====================================
Master Key:     из Backup Phrase (строка в менеджере паролей)
encryptedDEK:   Firestore → users/{uid}/files/{fileId}/encryption/encryptedDEK
dekIV:          Firestore → users/{uid}/files/{fileId}/encryption/dekIV
fileIV:         Firestore → users/{uid}/files/{fileId}/encryption/fileIV
b2Key:          Firestore → users/{uid}/files/{fileId}/b2Key
Файл:           Backblaze B2 → скачать по b2Key

СКРИПТ ВОССТАНОВЛЕНИЯ
======================
decrypt-manual.mjs — лежит в корне репозитория
Требует: Node.js 18+
```

### Угрозы и защита

| Угроза | Защита в нашей схеме |
|--------|----------------------|
| Утечка Backblaze | Без Master Key — просто байты |
| Утечка Firestore | DEK-и зашифрованы, без Master Key бесполезны |
| Взлом аккаунта Firebase | Аналогично — данные зашифрованы |
| Потеря браузера/устройства | Backup Phrase → восстановление на новом устройстве |
| Потеря Backup Phrase | Нет доступа к файлам. Решение: хранить в надёжном менеджере паролей |
| Ошибка в коде приложения | Данные в Backblaze и Firestore не меняются — можно расшифровать вручную |

---

*Вся криптография построена на нативном WebCrypto API, доступном в любом современном браузере и Node.js 18+. Никаких внешних зависимостей для шифрования не требуется.*
