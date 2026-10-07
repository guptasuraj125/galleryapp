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
- Private Backblaze B2 storage for new uploads and signed URLs for viewing media.
- Backward-compatible delivery and deletion of older Cloudinary assets.
- Server-side validation, per-user upload limits, upload progress, and retryable failures.
- Responsive layout and light/dark appearance.

## Technology

- Next.js App Router 16 and React 19
- TypeScript
- MongoDB with Mongoose
- Backblaze B2 through its S3-compatible API and the AWS SDK
- Cloudinary SDK for legacy assets
- Tailwind CSS 4, Framer Motion, GSAP, and Lucide
- ZIP parsing in the browser with `@zip.js/zip.js`

## Requirements

- Node.js 20.19 or later
- npm
- A MongoDB deployment that supports transactions (MongoDB Atlas is recommended)
- A private Backblaze B2 bucket and application key
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
| `B2_APPLICATION_KEY_ID` | Yes for new uploads | Backblaze B2 application key ID. Keep it server-side. |
| `B2_APPLICATION_KEY` | Yes for new uploads | Backblaze B2 application key/secret. Keep it server-side. |
| `B2_BUCKET_NAME` | Yes for new uploads | Name of the private B2 bucket. |
| `B2_ENDPOINT` | Yes for new uploads | S3-compatible endpoint for the bucket's region, for example `https://s3.us-east-005.backblazeb2.com`. |
| `B2_REGION` | Yes for new uploads | B2 region identifier, such as `us-east-005`. |
| `CLOUDINARY_CLOUD_NAME` | Only for legacy assets | Cloud name used by existing Cloudinary-backed media. |
| `CLOUDINARY_API_KEY` | Only for legacy asset operations | API key used for legacy Cloudinary verification/deletion. Server-side only. |
| `CLOUDINARY_API_SECRET` | Only for legacy asset operations | API secret used for legacy Cloudinary verification/deletion. Server-side only. |

The included `.env.example` has the expected variable names. Confirm its B2 bucket and region values match your own deployment before using them. Do not add a `NEXT_PUBLIC_` prefix to private credentials.

## First-time setup

1. Configure MongoDB, B2, `AUTH_SECRET`, and `INITIAL_SETUP_TOKEN`.
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

New uploads accept JPG, JPEG, PNG, WEBP, GIF, AVIF, HEIC, HEIF, MP4, MOV, and WEBM files up to 500 MB each. The upload interface also accepts ZIP archives. Folder uploads preserve folder paths as metadata; they do not create public B2 folders.

## How uploads and storage work

1. The signed-in browser asks the app to initiate an upload. The server validates the session, membership, file extension, MIME type, size, and rate limit.
2. The server creates an upload record and a unique object key in the private B2 bucket.
3. The browser streams the file through an authenticated application route. B2 credentials never go to the browser.
4. The app checks the stored object's metadata, then records the asset and its memory metadata in MongoDB.
5. When media is requested, the server checks access and returns a short-lived signed B2 URL. The bucket itself remains private.

ZIP processing occurs in the browser. The client validates archive paths and entry metadata and extracts one file at a time. It skips unsupported, nested, encrypted, executable, and symlink entries. Current archive limits are 500 MB compressed, 2,000 entries, 100 MB per extracted entry, and 1 GB total extracted data.

New uploads use B2. Existing Cloudinary assets remain supported for rendering and deletion while they are present in the database. Deleting media removes the storage object and then its database references; bulk deletion is scoped to the authenticated private space.

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
| `/api/uploads/initiate` | `POST` | Validate and prepare a B2 upload. |
| `/api/uploads/content/[itemId]` | `PUT` | Stream file content into B2. |
| `/api/uploads/complete` | `POST` | Verify the B2 object and save MongoDB metadata. |
| `/api/uploads/fail` | `POST` | Record a failed upload and attempt storage cleanup. |

All APIs that read or modify private data require a valid session and enforce space membership. Mutating browser requests are checked for same-origin requests.

## Project layout

```text
app/                    Pages, layouts, and route handlers
  api/                  Authentication, media, memories, members, and upload APIs
src/components/         Client-side UI and upload/gallery components
src/lib/                Authentication, database, B2, Cloudinary, and shared helpers
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

There is no automated test runner configured at this time. End-to-end upload verification requires a configured B2 bucket, MongoDB, an authenticated browser session, and test media files.

## Deployment

1. Install dependencies with `npm ci` and build with `npm run build`.
2. Configure all required environment variables in the hosting platform's secret/environment settings. Do not upload `.env.local` to the host or commit it.
3. Use MongoDB Atlas or another transaction-capable replica set and allow the application host to connect to it.
4. Use a private B2 bucket and a B2 application key limited to the required bucket operations. Set the matching endpoint and region.
5. Configure `AUTH_SECRET` with a strong random value and remove `INITIAL_SETUP_TOKEN` after initial provisioning.
6. Serve the app over HTTPS so secure session cookies are used in production.
7. Confirm that `robots.txt` remains appropriate for your deployment; this app disallows indexing by search engines.

## Security and privacy

- Keep MongoDB URIs, B2 keys, Cloudinary secrets, and auth secrets out of source control and client-side code.
- Do not make the B2 bucket public. Signed media URLs grant temporary access and should not be posted or logged.
- Keep production credentials in your hosting provider's secret store; rotate any credential that has been exposed.
- Use a database account limited to the app's database and a B2 key limited to the app's bucket and necessary operations.
- This app is designed for a private group, not as a public media CDN or anonymous upload endpoint.

## Troubleshooting

### Setup says the token is invalid

Confirm that the running app has `INITIAL_SETUP_TOKEN` set to the same value entered in `/setup`. Restart the dev server after changing environment variables. The setup flow can only create the initial owner once.

### Login or APIs report an authentication error

Check that `MONGODB_URI` and `AUTH_SECRET` are present, that MongoDB is reachable, and that the session cookie is enabled in the browser. In production, serve the app over HTTPS.

### Uploads fail before transferring

Check the B2 variables (`B2_APPLICATION_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_NAME`, `B2_ENDPOINT`, and `B2_REGION`), bucket access, file extension/type, file size, and upload rate limit. Restart the app after updating local environment files.

### Upload completes but media does not render

Confirm the bucket is private but accessible to the configured B2 application key, and verify that the saved asset has the correct storage provider, object key, content type, and size. Backblaze media is streamed through the authenticated same-origin `/api/media/content` endpoint; the browser does not receive B2 credentials or signed URLs. Keep the session cookie enabled, and check the server logs for `media-proxy-b2` errors. Video playback supports byte-range requests.

### MongoDB transaction errors

Transactions require a replica set. Use MongoDB Atlas or configure a local replica set instead of a standalone MongoDB server.

### Older Cloudinary media cannot be viewed or deleted

Confirm the database asset is marked as Cloudinary-backed and that the Cloudinary credentials match the environment that owns those assets. Cloudinary is retained for existing assets; new uploads are stored in B2.
