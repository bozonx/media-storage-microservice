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
- **Security**: Blocking of executable and archive file uploads by default.
- **Resilience**: Streaming uploads/downloads for low memory footprint and partial content support (Range requests).

---

## Quick Start

### Docker Compose (Recommended)

1. Create a production environment file:
   ```bash
   cp .env.production.example .env.production
   ```
2. Edit `.env.production` and provide your credentials (PostgreSQL and S3).
3. Start the services:
   ```bash
   docker compose -f docker/docker-compose.yml up -d
   ```
4. Check health:
   ```bash
   curl http://localhost:8080/api/v1/health
   ```

Default API Base URL: `http://localhost:8080/api/v1`
Utility UI: `http://localhost:8080/ui`

---

## Configuration

The service is configured via environment variables. See `.env.production.example` for the full list.

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `S3_ENDPOINT` | S3 API endpoint | Required |
| `S3_REGION` | S3 region | `us-east-1` |
| `S3_BUCKET` | S3 bucket name | Required |
| `LISTEN_PORT` | Port for the service | `8080` |
| `LISTEN_HOST` | Host for the service | `0.0.0.0` |
| `BASE_PATH`| URL prefix for API/UI | (empty) |
| `BLOCK_EXECUTABLE_UPLOADS` | Reject executables | `true` |
| `BLOCK_ARCHIVE_UPLOADS` | Reject archives | `true` |

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

#### POST `/files/from-url`
Upload a file by providing a remote URL.

**Body (JSON):**
- `url` (Required): Remote URL of the file.
- `filename` (Optional): Override the filename.
- `metadata`, `appId`, `userId`, `purpose`, `optimize`: Same as above.

---

### 2. Optimization Parameters (`optimize` object)

When uploading images, you can control the optimization process:

| Parameter | Type | Range | Description |
|-----------|------|-------|-------------|
| `format` | string | `webp`, `avif` | Target output format. |
| `quality` | number | 1-100 | Compression quality (default ~80). |
| `maxDimension` | number | 1-8192 | Resize the image if its width or height exceeds this value. |
| `lossless` | boolean | - | Use lossless compression (WebP only). |
| `stripMetadata` | boolean | - | Remove EXIF and other metadata from the binary. |
| `autoOrient` | boolean | - | Automatically rotate image based on EXIF Orientation tag. |
| `removeAlpha` | boolean | - | Remove transparency channel (useful for conversion to JPEG). |
| `effort` | number | 0-9 | CPU effort for compression (higher is slower but better). |

---

### 3. File Retrieval & Management

#### GET `/files/:id`
Retrieve file metadata (JSON).

#### GET `/files/:id/download`
Download the raw file. Supports `Range` headers for partial downloads and `If-None-Match` for caching.

#### GET `/files/:id/exif`
Retrieve extracted EXIF data from the image.

#### DELETE `/files/:id`
Mark a file as deleted (Soft Delete).

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

---

## Development

### Requirements
- Node.js 22+
- pnpm 10+
- Docker (for database and storage)

### Local Setup
```bash
pnpm install
cp .env.development.example .env.development
# Start DB and Garage (S3)
docker compose up -d
# Initialize storage buckets
bash scripts/init-garage.sh
# Run NestJS
pnpm start:dev
```

### Testing
- `pnpm test:unit` - Run unit tests.
- `pnpm test:e2e` - Run end-to-end tests.

## License

MIT

