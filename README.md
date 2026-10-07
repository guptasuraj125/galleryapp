# ghumi.ghumi

A private, shared archive for photos, videos, and the moments around them. ghumi.ghumi is a self-hosted web app for a small invited group, with private media storage, a searchable gallery, and owner-managed membership.

## Contents

- [Features](#features)
- [Technology](#technology)
- [Requirements](#requirements)
- [Run locally](#run-locally)
- [Configuration](#configuration)
- [First-time setup](#first-time-setup)
- [Using the app](#using-the-app)
- [How uploads and storage work](#how-uploads-and-storage-work)
- [Routes](#routes)
- [Project layout](#project-layout)
- [Development and checks](#development-and-checks)
- [Deployment](#deployment)
- [Security and privacy](#security-and-privacy)
- [Troubleshooting](#troubleshooting)

## Features

- Private spaces with an owner and invited members.
- Password login with database-backed sessions.
- Photo and video upload, including folder selection and ZIP archives.
- A paginated gallery with search, image/video filters, favorites, and a media viewer.
- Video browsing, a date timeline, places, search, and On This Day.
- ImageKit storage and CDN delivery for new photos and videos.
- Backward-compatible delivery and deletion for older Cloudinary and Backblaze B2 assets.
- Server-side validation, per-user upload limits, upload progress, and retryable failures.
- Responsive layout and light/dark appearance.

## Technology

- Next.js App Router 16 and React 19
- TypeScript
- MongoDB with Mongoose
- ImageKit Node SDK and streaming multipart uploads
- Backblaze B2 S3-compatible API for legacy assets only
- Cloudinary SDK for legacy assets
- Tailwind CSS 4, Framer Motion, GSAP, and Lucide
- ZIP parsing in the browser with `@zip.js/zip.js`

## Requirements

- Node.js 20.19 or later
- npm
- A MongoDB deployment that supports transactions (MongoDB Atlas is recommended)
- ImageKit public key, private key, and URL endpoint
- Backblaze B2 credentials only if legacy B2 records remain in MongoDB
- Cloudinary credentials only if the database still contains Cloudinary-backed media

## Run locally

```powershell
git clone https://github.com/guptasuraj125/galleryapp.git
cd galleryapp
npm ci
Copy-Item .env.example .env.local
```

Edit `.env.local` and set the values described in [Configuration](#configuration). Then start the development server:

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The initial owner setup page is at `/setup`.

To create a strong random value for `AUTH_SECRET` and `INITIAL_SETUP_TOKEN`, run this command twice and use a different result for each:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Never commit `.env`, `.env.local`, or any file containing real credentials. `.env.example` is a template and is safe to copy; it is not a place to store working credentials.

## Configuration

Copy `.env.example` to `.env.local` and configure the following server-side variables:

| Variable | Required | Description |
| --- | --- | --- |
| `MONGODB_URI` | Yes | MongoDB connection string. The database user needs read/write access to the application database. |
| `AUTH_SECRET` | Yes | Random secret of at least 32 characters used to protect session token hashes. |
| `INITIAL_SETUP_TOKEN` | For first setup | One-time token of at least 32 characters required to create the first owner. Remove it from the runtime environment after setup. |
| `INITIAL_SPACE_NAME` | No | Name of the initial private space. Defaults to `ghumi.ghumi`. |
| `IMAGEKIT_PUBLIC_KEY` | Yes | ImageKit public key. Used only by server-side ImageKit configuration; never contains a secret. |
| `IMAGEKIT_PRIVATE_KEY` | Yes | ImageKit private key for server-side uploads, verification, and deletion. Never expose it to browser code. |
| `IMAGEKIT_URL_ENDPOINT` | Yes | ImageKit media-library URL endpoint used for CDN URLs. |
| `B2_APPLICATION_KEY_ID` | Only for legacy B2 assets | Legacy Backblaze B2 application key ID. Server-side only. |
| `B2_APPLICATION_KEY` | Only for legacy B2 assets | Legacy Backblaze B2 application secret. Server-side only. |
| `B2_BUCKET_NAME` | Only for legacy B2 assets | Name of the bucket that contains existing B2 objects. |
| `B2_ENDPOINT` | Only for legacy B2 assets | S3-compatible endpoint for the existing bucket. |
| `B2_REGION` | Only for legacy B2 assets | Region identifier for the existing B2 bucket. |
| `CLOUDINARY_CLOUD_NAME` | Only for legacy assets | Cloud name used by existing Cloudinary-backed media. |
| `CLOUDINARY_API_KEY` | Only for legacy asset operations | API key used for legacy Cloudinary verification/deletion. Server-side only. |
| `CLOUDINARY_API_SECRET` | Only for legacy asset operations | API secret used for legacy Cloudinary verification/deletion. Server-side only. |

The included `.env.example` has the expected variable names. New uploads require the three ImageKit values. Configure the B2 values only while legacy B2 media is still stored. Do not add a `NEXT_PUBLIC_` prefix to private credentials.

## First-time setup

1. Configure MongoDB, ImageKit, `AUTH_SECRET`, and `INITIAL_SETUP_TOKEN`.
2. Start the app and open `/setup`.
3. Enter the setup token and create the owner account.
4. Sign in and invite other people from the members area. Invitations expire after seven days.
5. Remove `INITIAL_SETUP_TOKEN` from the environment and restart/redeploy the app.

The setup route is intended for initial provisioning. It refuses to create another initial owner after a private space already exists.

## Using the app

| Page | Purpose |
| --- | --- |
| `/home` | Home page and media upload area. |
| `/gallery` | Searchable, paginated photo and video gallery. |
| `/videos` | Video-focused browsing. |
| `/timeline` | Browse memories by date. |
| `/places` | Browse memories associated with places. |
| `/favorites` | View favorited media. |
| `/search` | Search the private archive. |
| `/on-this-day` | Revisit memories from this date in earlier years. |
| `/members` | Owner tools for members and invitations. |
| `/login` | Sign in. |
| `/setup` | Initial owner creation. |

New uploads accept JPG, JPEG, PNG, WEBP, GIF, AVIF, HEIC, HEIF, MP4, MOV, and WEBM files up to 500 MB each. The upload interface also accepts ZIP archives. Folder uploads preserve their sanitized folder paths in ImageKit.

## How uploads and storage work

1. The signed-in browser asks the app to initiate an upload. The server validates the session, membership, file extension, MIME type, size, and rate limit.
2. The server creates an upload record containing the intended ImageKit path and a unique asset key.
3. The browser sends the raw file body to the authenticated upload route. That route streams a correctly encoded multipart `file` part to ImageKit with server-side authentication; ImageKit credentials never go to the browser.
4. The app verifies the returned ImageKit file ID, path, content type, and size, then records the asset and its memory metadata in MongoDB.
5. Images and videos are delivered directly from the ImageKit CDN using expiring signed URLs. ImageKit thumbnails and video posters are generated as transformed URLs; full-resolution assets are used in the viewer.

ZIP processing occurs in the browser. The client validates archive paths and entry metadata and extracts one file at a time. It skips unsupported, nested, encrypted, executable, and symlink entries. Current archive limits are 500 MB compressed, 2,000 entries, 100 MB per extracted entry, and 1 GB total extracted data.

New uploads use ImageKit. Existing Cloudinary and Backblaze B2 assets remain supported for rendering and deletion while they are present in the database. B2 assets use the authenticated same-origin media route, including byte-range support for video playback. Deleting media removes the storage object and then its database references; bulk deletion is scoped to the authenticated private space.

## Routes

### Application pages

See [Using the app](#using-the-app) for the page list.

### API routes

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/auth/login` | `POST` | Authenticate a user and start a session. |
| `/api/auth/logout` | `POST` | Revoke the current session. |
| `/api/auth/session` | `GET` | Return the current session state. |
| `/api/setup` | `GET`, `POST` | Check setup state and provision the first owner/space. |
| `/api/members` | `GET`, `POST`, `DELETE` | List members/invitations and manage them as the owner. |
| `/api/members/accept` | `POST` | Accept an invitation. |
| `/api/memories` | `GET`, `POST` | List and create memories and media metadata. |
| `/api/memories/[memoryId]` | `PATCH`, `DELETE` | Update or delete a memory. |
| `/api/media/[mediaId]` | `DELETE` | Delete one media asset. |
| `/api/media/bulk` | `DELETE` | Delete selected media assets in the private space. |
| `/api/uploads/initiate` | `POST` | Validate and prepare an ImageKit upload. |
| `/api/uploads/content/[itemId]` | `PUT` | Stream raw file bytes as multipart content to ImageKit. |
| `/api/uploads/complete` | `POST` | Verify the ImageKit asset and save MongoDB metadata. |
| `/api/uploads/fail` | `POST` | Record a failed upload and attempt storage cleanup. |

All APIs that read or modify private data require a valid session and enforce space membership. Mutating browser requests are checked for same-origin requests.

## Project layout

```text
app/                    Pages, layouts, and route handlers
  api/                  Authentication, media, memories, members, and upload APIs
src/components/         Client-side UI and upload/gallery components
src/lib/                Authentication, database, ImageKit, legacy providers, and shared helpers
src/models/             Mongoose schemas and indexes
public/brand/           Application brand assets
```

MongoDB connection reuse is handled in `src/lib/mongodb.ts`. The app uses MongoDB transactions for provisioning and upload finalization, so use a replica set (Atlas provides this by default).

## Development and checks

```powershell
npm run dev          # Start the local development server
npm run lint         # Run ESLint
npx tsc --noEmit     # Type-check without emitting files
npm run build        # Create an optimized production build
npm run start        # Serve the production build
```

There is no automated test runner configured at this time. End-to-end upload verification requires ImageKit credentials, MongoDB, an authenticated browser session, and test media files.

## Deployment

1. Install dependencies with `npm ci` and build with `npm run build`.
2. Configure all required environment variables in the hosting platform's secret/environment settings. Do not upload `.env.local` to the host or commit it.
3. Use MongoDB Atlas or another transaction-capable replica set and allow the application host to connect to it.
4. Configure the three ImageKit environment variables. Keep `IMAGEKIT_PRIVATE_KEY` server-side and configure legacy B2 credentials only if B2 media remains.
5. Configure `AUTH_SECRET` with a strong random value and remove `INITIAL_SETUP_TOKEN` after initial provisioning.
6. Serve the app over HTTPS so secure session cookies are used in production.
7. Confirm that `robots.txt` remains appropriate for your deployment; this app disallows indexing by search engines.

## Security and privacy

- Keep MongoDB URIs, ImageKit private keys, legacy storage keys, Cloudinary secrets, and auth secrets out of source control and client-side code.
- ImageKit media uses private assets and expiring signed CDN URLs delivered to authorized gallery clients. Keep application APIs authenticated; avoid logging signed media URLs.
- Keep production credentials in your hosting provider's secret store; rotate any credential that has been exposed.
- Use a database account limited to the app's database and a legacy B2 key limited to the existing bucket and necessary operations.
- This app is designed for a private group, not as a public media CDN or anonymous upload endpoint.

## Troubleshooting

### Setup says the token is invalid

Confirm that the running app has `INITIAL_SETUP_TOKEN` set to the same value entered in `/setup`. Restart the dev server after changing environment variables. The setup flow can only create the initial owner once.

### Login or APIs report an authentication error

Check that `MONGODB_URI` and `AUTH_SECRET` are present, that MongoDB is reachable, and that the session cookie is enabled in the browser. In production, serve the app over HTTPS.

### Uploads fail before transferring

Check the ImageKit values (`IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`, and `IMAGEKIT_URL_ENDPOINT`), file extension/type, file size, and upload rate limit. Restart the app after updating local environment files.

### Upload completes but media does not render

Verify the asset has provider `imagekit`, a valid ImageKit file ID/path, matching content type, and size. The upload route sends multipart content to ImageKit; the browser sends raw bytes only to the authenticated app route. If a request fails before upload completion, check the server's `upload-imagekit-content` log entry. Legacy B2 playback continues through `/api/media/content` when B2 environment variables are configured.

### MongoDB transaction errors

Transactions require a replica set. Use MongoDB Atlas or configure a local replica set instead of a standalone MongoDB server.

### Older Cloudinary media cannot be viewed or deleted

Confirm the database asset is marked as Cloudinary-backed and that the Cloudinary credentials match the environment that owns those assets. Cloudinary is retained for existing assets; new uploads are stored in ImageKit.
