# Media Storage Microservice

A robust microservice for uploading, storing, and serving media files with built-in image optimization, dynamic thumbnail generation, and SHA-256 deduplication.

## Features

- **Storage**: S3-compatible backend (supports AWS S3, MinIO, Garage, etc.).
- **Metadata**: PostgreSQL (via Prisma ORM) for fast searching and filtering.
- **Image Processing**:
  - Automatic optimization to WebP or AVIF.
  - On-the-fly dynamic thumbnail generation.
  - EXIF data extraction and storage.
  - Metadata stripping and auto-orientation.
- **Deduplication**: Content-addressable storage using SHA-256 checksums to save space.
- **Security**: Blocking of executable and archive file uploads by default. Granular file size limits by type.
- **Resilience**: Streaming uploads/downloads for low memory footprint and partial content support (Range requests).
- **Automated Cleanup**: Systematic removal of orphaned files, old thumbnails, and temporary objects.

---

## Quick Start

### Development Environment

The easiest way to start developing is to use the setup script:

```bash
# 1. Install dependencies
pnpm install

# 2. Run the automated setup script
# This script will:
# - Create .env.development
# - Start PostgreSQL and Garage (S3) in Docker
# - Initialize Garage buckets and generate keys
# - Output the keys to use in your .env
pnpm run setup:dev

# 3. Start the application
pnpm start:dev
```

If you prefer a manual setup:
1. Create `.env.development` from `.env.development.example`.
2. Start dependencies: `docker compose -f docker-compose.yml up -d postgres garage`.
3. Initialize Garage: `bash scripts/init-garage.sh`. **Note the Access Key and Secret Key output!**
4. Update `.env.development` with the generated keys.
5. Run the app: `pnpm start:dev`.

### Production Deployment

#### Using Docker Compose (Recommended)

1. Create a production environment file:
   ```bash
   cp .env.production.example .env.production
   ```
2. Edit `.env.production` and provide your credentials (PostgreSQL and S3).
   - If you are using the bundled Garage service, you perform the setup first (see below).
3. Start the services:
   ```bash
   docker compose -f docker/docker-compose.yml up -d
   ```
4. Check health:
   ```bash
   curl http://localhost:8080/api/v1/health
   ```

**Default API Base URL**: `http://localhost:8080/api/v1`
**Utility UI**: `http://localhost:8080/ui`

---

## Storage Configuration (Garage/S3)

This service uses **Garage**, a lightweight S3-compatible object storage, but works with any S3 provider (AWS, MinIO, etc.).

### Generating Keys for Garage

If you are using the bundled Garage container (e.g., via `docker-compose.yml`), you need to generate access keys.

**Automatic Generation (Development):**
Running `pnpm run setup:dev` or `bash scripts/init-garage.sh` automatically ensures a bucket exists, creates a key (`media-storage-app`), and prints the credentials.

**Manual Generation (Production/Custom):**
If running in production with the bundled Garage:
1. Start the Garage container:
   ```bash
   docker compose -f docker/docker-compose.yml up -d garage
   ```
   ```
   **Note**: In some production setups, you might use an external managed S3 (like AWS S3 or MinIO) instead of the bundled Garage. In that case, skip step 2 and just configure `.env.production`.

2. **Initialize Garage (If using bundled Garage):**
   Run the initialization script from your **Host Machine** (not inside the container).
   
   *Requirement: You must have the `scripts/` folder from the repository on your host.*

   ```bash
   bash scripts/init-garage.sh
   ```
   (This script automatically detects the running `media-storage-garage` container and sets up buckets/keys).

   **Tip: If you don't have the source code on the Host (Docker only):**
   You can run the script directly from the image by piping it to your host's bash:
   ```bash
   export GARAGE_CONTAINER_NAME=your_garage_container_name
   docker exec media-storage-microservice cat scripts/init-garage.sh | bash
   ```

   **Alternative: Running fully inside the container:**
   If you really want to run it *inside* the microservice container (e.g. for CI/CD or automated setups), you must mount the Docker socket in your `docker-compose.yml`:
   ```yaml
   volumes:
     - /var/run/docker.sock:/var/run/docker.sock
   ```
   Then you can run it normally: `docker exec media-storage-microservice bash scripts/init-garage.sh`.

3. **Configure Keys:**
   **Copy the `Access Key ID` and `Secret Access Key`** from the script output.
   Add them to your `.env.production` file:
   ```env
   S3_ACCESS_KEY_ID=GKxxx...
   S3_SECRET_ACCESS_KEY=xxxx...
   ```
4. **Apply Changes:**
   Restart the microservice to apply changes:
   ```bash
   docker compose -f docker/docker-compose.yml restart microservice
   ```

### Connecting Manually (AWS CLI / Tools)

You can connect to the local Garage instance using any S3-compatible tool (AWS CLI, Cyberduck, S3 Browser).

- **Endpoint**: `http://localhost:3900`
- **Region**: `garage` (or any string)
- **Bucket**: `media-files`
- **Path Style**: Forced (`true`)

**Example AWS CLI Profile:**
```ini
[profile garage]
region = garage
endpoint_url = http://localhost:3900
aws_access_key_id = <your_key_id>
aws_secret_access_key = <your_secret_key>
```

## Configuration

The service is configured via environment variables. See `.env.production.example` for the full list.

### 1. Basic Settings
| Variable | Description | Default |
|----------|-------------|---------|
| `LISTEN_PORT` | Port for the service | `8080` |
| `LISTEN_HOST` | Host for the service | `0.0.0.0` |
| `BASE_PATH`| URL prefix for API/UI (e.g. `/media`) | (empty) |
| `LOG_LEVEL` | Logging level (pino) | `warn` |
| `TZ` | Application timezone | `UTC` |

### 2. Database & Storage
| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `S3_ENDPOINT` | S3 API endpoint | Required |
| `S3_REGION` | S3 region | `us-east-1` |
| `S3_BUCKET` | S3 bucket name | Required |
| `S3_FORCE_PATH_STYLE` | Use path-style S3 URLs | `true` |

### 3. External Image Processing
| Variable | Description | Default |
|----------|-------------|---------|
| `IMAGE_PROCESSING_BASE_URL` | URL of the image-processing-microservice | Required |
| `IMAGE_PROCESSING_REQUEST_TIMEOUT_SECONDS` | Timeout for processing requests | `60` |

### 4. File Upload Limits
| Variable | Description | Default |
|----------|-------------|---------|
| `IMAGE_MAX_BYTES_MB` | Max size for images | `25` |
| `VIDEO_MAX_BYTES_MB` | Max size for videos | `100` |
| `AUDIO_MAX_BYTES_MB` | Max size for audio | `50` |
| `DOCUMENT_MAX_BYTES_MB` | Max size for documents | `50` |
| `BLOCK_EXECUTABLE_UPLOADS` | Reject executable files | `true` |
| `BLOCK_ARCHIVE_UPLOADS` | Reject archive files | `true` |

### 5. Cleanup Job
| Variable | Description | Default |
|----------|-------------|---------|
| `CLEANUP_ENABLED` | Enable automated cleanup | `true` |
| `CLEANUP_CRON` | Cron schedule for cleanup | `0 */6 * * *` |
| `CLEANUP_BAD_STATUS_TTL_DAYS` | TTL for failed/missing files | `1` |
| `CLEANUP_TMP_TTL_DAYS` | TTL for temporary S3 objects | `2` |
| `CLEANUP_ORIGINALS_TTL_DAYS` | TTL for original images | `14` |
| `THUMBNAIL_MAX_AGE_DAYS` | TTL for unused thumbnails | `90` |

### 6. Upload From URL
| Variable | Description | Default |
|----------|-------------|---------|
| `URL_UPLOAD_BLOCK_UNSAFE_CONNECTIONS` | Block local/unsafe URLs | `true` |
| `URL_UPLOAD_TIMEOUT_MS` | External download timeout | `15000` |
| `URL_UPLOAD_MAX_BYTES_MB` | Max size (0 = max of above) | `0` |

---

## API Documentation

Base Path: `/api/v1`

### 1. File Upload

#### POST `/files`
Upload a file using `multipart/form-data`.

**Fields:**
- `file` (Required): The binary file to upload.
- `optimize` (Optional): JSON string containing `Optimization Parameters`.
- `metadata` (Optional): JSON string with custom key-value pairs.
- `appId` (Optional): String to group files by application.
- `userId` (Optional): String to associate file with a user.
- `purpose` (Optional): String to categorize file use (e.g., `avatar`, `post`).

**Example:**
```bash
curl -X POST http://localhost:8080/api/v1/files \
  -F "file=@./photo.jpg" \
  -F 'optimize={"format":"webp","quality":80}' \
  -F 'appId=my-app'
```

**Response (JSON):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "photo.jpg",
  "appId": "my-app",
  "userId": "user-123",
  "purpose": "avatar",
  "mimeType": "image/webp",
  "size": 45000,
  "originalSize": 120000,
  "checksum": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "uploadedAt": "2023-10-27T10:00:00.000Z",
  "statusChangedAt": "2023-10-27T10:00:05.000Z",
  "status": "ready",
  "metadata": {
    "alt": "User Profile Picture"
  },
  "originalMimeType": "image/jpeg",
  "optimizationStatus": "ready",
  "url": "/api/v1/files/550e8400-e29b-41d4-a716-446655440000/download",
  "exif": {
    "Make": "Canon",
    "Model": "Canon EOS 5D Mark IV"
  }
}
```

#### POST `/files/from-url`
Upload a file by providing a remote URL.

**Body (JSON):**
- `url` (Required): Remote URL of the file.
- `filename` (Optional): Override the filename.
- `metadata`, `appId`, `userId`, `purpose`, `optimize`: Same as above.

---

### 2. Optimization Parameters (`optimize` object)

When uploading images, you can control the optimization process:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `format` | string | `webp` | Target output format (`webp`, `avif`). |
| `quality` | number | 80 | Compression quality (1-100). |
| `maxDimension` | number | 3840 | Resize if width or height exceeds this value. |
| `lossless` | boolean | false | Use lossless compression (WebP only). |
| `stripMetadata` | boolean | false | Remove EXIF and other metadata. |
| `autoOrient` | boolean | true | Rotate image based on EXIF Orientation. |
| `flatten` | string | - | Remove transparency and fill with hex color (e.g., `#ffffff`). |
| `chromaSubsampling` | string | `4:2:0` | AVIF chroma subsampling (`4:2:0`, `4:4:4`). |
| `effort` | number | 6 | CPU effort (0-9, higher is slower but better). |

---

### 3. File Retrieval & Management

#### GET `/files/:id`
Retrieve file metadata (JSON).

**Response (JSON):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "photo.jpg",
  "mimeType": "image/webp",
  "size": 45000,
  "url": "/api/v1/files/550e8400-e29b-41d4-a716-446655440000/download",
  "checksum": "sha256:...",
  "status": "ready",
  "metadata": {},
  "originalMimeType": "image/jpeg",
  "optimizationStatus": "ready"
}
```

#### GET `/files/:id/download`
Download the raw file. Supports `Range` headers for partial downloads and `If-None-Match` for caching.

#### GET `/files/:id/exif`
Retrieve extracted EXIF data from the image.

**Response (JSON):**
```json
{
  "exif": {
    "Make": "Canon",
    "Model": "Canon EOS 5D Mark IV",
    "DateTimeOriginal": "2023:10:21 14:30:00",
    "GPSLatitude": 35.6895,
    "GPSLongitude": 139.6917
  }
}
```

#### DELETE `/files/:id`
Mark a file as deleted (Soft Delete).

#### POST `/files/bulk-delete`
Mark multiple files as deleted based on tags. **Requires at least one filter.**

**Body (JSON):**
- `appId` (Optional): Filter by Application ID.
- `userId` (Optional): Filter by User ID.
- `purpose` (Optional): Filter by Purpose.

#### POST `/files/:id/reprocess`
Reprocess an existing image with new optimization settings.

**Body (JSON):**
Accepts `Optimization Parameters` (see section 2).

**Example:**
```bash
curl -X POST http://localhost:8080/api/v1/files/abc-123/reprocess \
  -H "Content-Type: application/json" \
  -d '{"format":"avif", "quality":60, "maxDimension":2048}'
```

**Response (JSON):**
Returns the updated file metadata (same format as `GET /files/:id`).

**Behavior:**
- Uses the original source image for maximum quality if it's still available in storage (see `CLEANUP_ORIGINALS_TTL_DAYS`).
- If the original is gone (already optimized and deleted), falls back to the current optimized version as the source.
- Automatically deduplicates: returns an existing file if the same result has already been generated.
- Creates a new file record and **deletes the old file record (soft delete)** upon success, as the replaced version is no longer needed.

---

### 4. Dynamic Thumbnails

#### GET `/files/:id/thumbnail`
Generate and cache a thumbnail for an image.

**Query Parameters:**
- `width` (Required): Width in pixels (10-4096).
- `height` (Required): Height in pixels (10-4096).
- `quality` (Optional): 1-100 (default 80).
- `fit` (Optional): How the image should fit the dimensions:
  - `cover` (Default): Crop to fit.
  - `contain`: Add letterboxing.
  - `fill`: Stretch.
  - `inside`: Resize to be within dimensions.
  - `outside`: Resize to cover dimensions.

**Example:**
```bash
<img src="http://localhost:8080/api/v1/files/abc-123/thumbnail?width=300&height=300&fit=cover" />
```

---

### 5. File Listing

#### GET `/files`
Search and filter files.

**Query Parameters:**
- `limit` (default 50), `offset` (default 0).
- `sortBy`: `uploadedAt`, `size`, `filename`.
- `order`: `asc`, `desc`.
- `q`: Search by filename or original name.
- `mimeType`: Filter by MIME type.
- `appId`, `userId`, `purpose`: Filter by tags provided during upload.

**Response (JSON):**
```json
{
  "items": [
    {
      "id": "file-1",
      "filename": "photo.jpg",
      "size": 1024,
      "url": "..."
    }
  ],
  "total": 50,
  "limit": 10,
  "offset": 0
}
```

---

## Development

### Requirements
- Node.js 22+
- pnpm 10+
- Docker (for database and storage)

### Testing
- `pnpm test:unit` - Run unit tests.
- `pnpm test:e2e` - Run end-to-end tests.

## License

MIT

