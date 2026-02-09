```
┌─────────────────────────┐                     ┌────────────────────────────┐
│        Browser          │                     │         Netlify            │
│ (SvelteKit client)      │                     │  (Server/SSR + Functions)  │
└────────────┬────────────┘                     └───────────────┬────────────┘
             │                                                  │
             │ 1) Auth via Firebase Client (public config)      │
             │─────────────────────────────────────────────────▶│
             │                                                  │
             │ 2) Calls server APIs with Firebase ID token      │
             │   (/api/settings, /api/user/b2, /api/b2/*, etc.) │
             │─────────────────────────────────────────────────▶│
             │                                                  │
             │                     ┌────────────────────────────▼────────────┐
             │                     │      Server (SvelteKit endpoints)       │
             │                     │ - Verifies ID token (planned)           │
             │                     │ - Loads admin SDK                       │
             │                     │   (FIREBASE_ADMIN_CREDENTIALS env)      │
             │                     └───────────────┬─────────────────────────┘
             │                                      │
             │                                      │ 3) Firestore (admin) read/write
             │                                      │   - users/{uid}/settings/encryption
             │                                      │   - users/{uid}/settings/b2 (encrypted payload)
             │                                      │   - documents, sections
             │                                      │
             │                                      ▼
             │                           ┌───────────────────────┐
             │                           │      Firestore        │
             │                           │  (Rules enforce UID)  │
             │                           └─────────┬─────────────┘
             │                                      │
             │                                      │ 4) B2 creds stored encrypted with
             │                                      │    server master key (B2_MASTER_SECRET env)
             │                                      │
             │                                      ▼
             │                           ┌────────────────────────┐
             │                           │   B2 Creds (encrypted) │
             │                           └────────────────────────┘
             │
             │ 5) Upload flow:
             │    - Client encrypts file/thumbnail with user key (from Settings)
             │    - Calls /api/b2/upload-url (server fetches & decrypts B2 creds)
             │    - Server auth → returns upload URL/token
             │    - Client uploads file directly to B2
             │
             │ 6) Download flow:
             │    - Client fetches via /api/b2/file?name=...&userId=...
             │    - Server uses decrypted B2 creds to proxy file from B2
             │    - Client decrypts content with user key before viewing
             │
             │ Keys/secrets:
             │  - Public Firebase config: only in client (PUBLIC_* env)
             │  - Firebase admin creds: only in server env (FIREBASE_ADMIN_CREDENTIALS)
             │  - B2 master key: only in server env (B2_MASTER_SECRET)
             │  - User B2 creds: stored encrypted in Firestore, never returned after save
             │  - User encryption key/phrase: set once in Settings, cached locally; not stored server-side
```
