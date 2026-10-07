# ghumi.ghumi

A private memory space for a small invited group. Built with Next.js App Router, TypeScript, Tailwind CSS, MongoDB Atlas/Mongoose, Backblaze B2, GSAP, Framer Motion, Zod, and Lucide.

## Features

- First-owner setup with a one-time setup token, bcrypt password hashing, and database-backed sessions.
- Owner-created member invitations with expiring one-time links and role-checked member management.
- Private-space-scoped APIs for memory creation, search, editing, deletion, favorites, locations, and tags.
- Authenticated, streamed image and video uploads to a private Backblaze B2 bucket with upload progress and server-side metadata verification.
- Existing Cloudinary-backed media remains readable and deletable while new uploads use Backblaze B2.
- ZIP scanning in the browser with bounded archive size, entry count, per-entry output, path and symlink checks, encrypted/executable entry skipping, CRC validation, and per-file upload results.
- Editorial gallery, image/video lightbox, video page, date timeline, places list, search, favorites, Surprise Me, and On This Day.

## Local setup

1. Install Node.js 20.19+.
2. Run `npm install`.
3. Configure the existing `.env` file. Do not replace it with `.env.example` or paste real credentials into source code.
4. Create a MongoDB Atlas database and database user. Atlas transactions are used for setup and invitation acceptance.
5. Configure Backblaze B2 application-key credentials for the private bucket. Keep the application key server-side. Cloudinary credentials remain available for older media only.
6. Run `npm run dev`, open `/setup`, and create the first owner and private space.
7. Remove `INITIAL_SETUP_TOKEN` after owner setup. Invite other people from **Our people** in the private home.

## Environment variables

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection URI. |
| `AUTH_SECRET` | At least 32 random characters used to key session-token hashes. |
| `INITIAL_SETUP_TOKEN` | At least 32 random characters; only used for first-owner setup. |
| `INITIAL_SPACE_NAME` | Display name for the initial private space; defaults to `ghumi.ghumi`. |
| `B2_APPLICATION_KEY_ID` | Backblaze B2 application-key ID; server only. |
| `B2_APPLICATION_KEY` | Backblaze B2 application key; server only. |
| `B2_BUCKET_NAME` | Private Backblaze B2 bucket name. |
| `B2_ENDPOINT` | Backblaze S3-compatible endpoint. |
| `B2_REGION` | Backblaze bucket region. |
| `CLOUDINARY_CLOUD_NAME` | Retained for delivery and deletion of older Cloudinary media. |
| `CLOUDINARY_API_KEY` | Retained for older Cloudinary media; server only. |
| `CLOUDINARY_API_SECRET` | Retained for older Cloudinary media; server only. |

Do not prefix private values with `NEXT_PUBLIC_`. B2 uploads stream through authenticated server routes. Private B2 downloads use short-lived signed URLs; do not share them publicly.

## Architecture

- `src/lib/mongodb.ts` caches the Mongoose connection across Next.js development reloads. On Windows, it obtains the live Atlas SRV/TXT records through the Windows DNS client and builds a TLS-enabled standard seed-list URI, avoiding Node's failing loopback resolver without hardcoding Atlas hosts. Other platforms use the configured SRV URI directly.
- `src/models/` contains User, PrivateSpace, SpaceMember, Memory, MediaAsset, Location, Tag, UploadJob, UploadItem, Session, RateLimit, and Invitation models.
- `src/lib/auth.ts` owns bcrypt operations, HTTP-only cookie sessions, and membership lookup.
- `/api/uploads/initiate` checks auth, membership, MIME/extension, limits, and creates a unique B2 object key.
- The browser streams file bytes through `/api/uploads/content/[itemId]`; the server writes to the private B2 bucket without exposing credentials. `/api/uploads/complete` verifies B2 object metadata and transactionally records the asset and a starter memory.
- ZIPs stay in the browser. The client reads the central directory without copying the entire archive to an ArrayBuffer, validates entry paths and metadata, and extracts one file at a time before sending it through the normal upload pipeline. Nested archives, encrypted entries, symlinks, executables, and unsupported file types are skipped.
- Memories and media APIs scope reads and writes to the authenticated member's private space. B2 or Cloudinary deletion is confirmed before MongoDB references are removed.

## Development checks

```powershell
npm run lint
npx tsc --noEmit
npm run build
```

There is no automated test runner configured yet. Real B2 flow tests require valid B2 credentials, an available MongoDB Atlas cluster, and browser-selected test files.

## Deployment

Set all required environment variables in the deployment platform. Use MongoDB Atlas (replica-set transactions are required), deploy over HTTPS, and confirm Atlas network access and B2 endpoint/region configuration. `robots.txt` disallows indexing because this is a private application.
