# Media Storage Microservice

Микросервис для хранения, получения и управления медиафайлами с поддержкой оптимизации изображений, S3-совместимого хранилища и PostgreSQL.

## Возможности (Phase 1 MVP)

- 📁 **Загрузка файлов** с поддержкой multipart/form-data
- 🖼️ **Оптимизация изображений** с использованием Sharp (сжатие, изменение размера, конвертация форматов)
- 💾 **S3-совместимое хранилище** (Garage, MinIO, AWS S3)
- 🗄️ **PostgreSQL 17** с Prisma ORM для хранения метаданных файлов
- 🔄 **Транзакционная загрузка/удаление** для минимизации orphan-файлов
- 🚀 **Streaming upload/download** для эффективной работы с большими файлами
- 🔒 **Блокировка исполняемых файлов** для безопасности
- 🌐 **CDN-friendly** с поддержкой ETag и условных запросов (304 Not Modified)
- 🧹 **Автоматическая очистка** orphan-файлов через cron job
- 📊 **Пагинация и фильтрация** списка файлов
- 🏥 **Health check** с проверкой S3 и БД
- 📝 **Логирование** через Pino
- 🐳 **Docker Compose** с PostgreSQL и MinIO

## Требования

- Node.js 22+
- pnpm 10+
- Docker & Docker Compose (для локальной разработки)

## Быстрый старт (Development)

```bash
# Автоматическая настройка окружения
pnpm setup:dev

# Запуск приложения
pnpm start:dev
```

Скрипт `setup:dev` автоматически:
- Создаст `.env.development` из примера
- Запустит PostgreSQL и MinIO в Docker
- Установит зависимости
- Выполнит миграции Prisma
- Создаст bucket в MinIO

### Ручная настройка

```bash
# 1. Установка зависимостей
pnpm install

# 2. Настройка окружения
cp .env.development.example .env.development

# 3. Запуск PostgreSQL и MinIO
docker compose -f docker/docker-compose.yml up -d postgres minio

# 4. Выполнение миграций Prisma
pnpm prisma migrate deploy

# 5. Инициализация MinIO bucket
bash scripts/init-minio.sh

# 6. Запуск приложения
pnpm start:dev
```

API доступен по адресу: `http://localhost:8080/api/v1`

### Доступ к сервисам

- **API**: http://localhost:8080/api/v1
- **MinIO Console**: http://localhost:9001 (minioadmin/minioadmin)
- **PostgreSQL**: localhost:5432 (media_user/media_password)

## API Endpoints

### Files

#### Upload File
```bash
POST /api/v1/files
Content-Type: multipart/form-data

# Простая загрузка
curl -X POST http://localhost:8080/api/v1/files \
  -F "file=@image.jpg"

# С оптимизацией
curl -X POST http://localhost:8080/api/v1/files \
  -F "file=@image.jpg" \
  -F 'optimize={"quality":85,"maxWidth":1920,"format":"webp"}'

# С метаданными
curl -X POST http://localhost:8080/api/v1/files \
  -F "file=@document.pdf" \
  -F 'metadata={"description":"Invoice","tags":["2024","invoice"]}'
```

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "image.jpg",
  "mimeType": "image/webp",
  "size": 45678,
  "originalSize": 123456,
  "checksum": "sha256:abc123...",
  "uploadedAt": "2024-01-15T12:00:00Z",
  "url": "/api/v1/files/550e8400-e29b-41d4-a716-446655440000/download"
}
```

#### Get File Metadata
```bash
GET /api/v1/files/:id

curl http://localhost:8080/api/v1/files/550e8400-e29b-41d4-a716-446655440000
```

#### Download File
```bash
GET /api/v1/files/:id/download

curl -O http://localhost:8080/api/v1/files/550e8400-e29b-41d4-a716-446655440000/download
```

#### Delete File
```bash
DELETE /api/v1/files/:id

curl -X DELETE http://localhost:8080/api/v1/files/550e8400-e29b-41d4-a716-446655440000
```

#### List Files
```bash
GET /api/v1/files?limit=50&offset=0&sortBy=uploadedAt&order=desc&q=search&mimeType=image/jpeg

# Базовый запрос
curl "http://localhost:8080/api/v1/files?limit=10&sortBy=size&order=asc"

# С фильтрацией
curl "http://localhost:8080/api/v1/files?q=invoice&mimeType=application/pdf"
```

**Query параметры:**
- `limit` — количество записей (по умолчанию 50)
- `offset` — смещение для пагинации (по умолчанию 0)
- `sortBy` — поле сортировки: `uploadedAt`, `size`, `filename` (по умолчанию `uploadedAt`)
- `order` — порядок: `asc`, `desc` (по умолчанию `desc`)
- `q` — поиск по имени файла (case-insensitive)
- `mimeType` — фильтр по MIME типу

**Response:**
```json
{
  "items": [...],
  "total": 150,
  "limit": 50,
  "offset": 0
}
```

### Health Check
```bash
GET /api/v1/health

curl http://localhost:8080/api/v1/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T12:00:00Z",
  "storage": {
    "s3": "connected",
    "database": "connected"
  }
}
```

## Переменные окружения

См. `.env.production.example` для полного списка переменных.

### Основные настройки
- `NODE_ENV` — окружение (production/development)
- `LISTEN_HOST` — хост (0.0.0.0 для Docker, localhost для локальной разработки)
- `LISTEN_PORT` — порт (по умолчанию 8080)
- `LOG_LEVEL` — уровень логирования

### База данных (Prisma)
- `DATABASE_URL` — строка подключения PostgreSQL (формат: `postgresql://user:password@host:port/dbname`)
- Альтернативно можно использовать отдельные переменные:
  - `DATABASE_HOST` — хост PostgreSQL
  - `DATABASE_PORT` — порт PostgreSQL (5432)
  - `DATABASE_NAME` — имя БД
  - `DATABASE_USER` — пользователь
  - `DATABASE_PASSWORD` — пароль

### S3 Storage
- `S3_ENDPOINT` — URL S3 API
- `S3_REGION` — регион
- `S3_ACCESS_KEY_ID` — ключ доступа
- `S3_SECRET_ACCESS_KEY` — секретный ключ
- `S3_BUCKET` — имя bucket
- `S3_FORCE_PATH_STYLE` — использовать path-style URLs (true для MinIO/Garage)

### Загрузка файлов
- `MAX_FILE_SIZE` — максимальный размер файла в байтах (по умолчанию 104857600 = 100MB)
- `BLOCK_EXECUTABLE_UPLOADS` — блокировать загрузку исполняемых файлов (по умолчанию true)
- `BLOCKED_MIME_TYPES` — дополнительные MIME типы для блокировки (через запятую)

### Оптимизация
- `OPTIMIZATION_ENABLED` — включить оптимизацию (true/false)
- `OPTIMIZATION_DEFAULT_QUALITY` — качество по умолчанию (1-100)
- `OPTIMIZATION_MAX_WIDTH` — максимальная ширина (px)
- `OPTIMIZATION_MAX_HEIGHT` — максимальная высота (px)

### Cleanup Job
- `CLEANUP_ENABLED` — включить cleanup job (true/false)
- `CLEANUP_CRON` — расписание cron (по умолчанию: каждые 6 часов)
- `CLEANUP_ORPHAN_TIMEOUT_MINUTES` — таймаут для orphan-файлов (минуты)

## Production Deployment

### Через Docker Compose

```bash
# 1. Сборка приложения
pnpm build

# 2. Настройка окружения
cp .env.production.example .env.production
# Отредактируйте .env.production

# 3. Сборка и запуск через Docker Compose
docker compose -f docker/docker-compose.yml build
docker compose -f docker/docker-compose.yml up -d

# 4. Проверка health check
curl http://localhost:8080/api/v1/health
```

**Примечание:** Docker entrypoint автоматически выполняет `prisma migrate deploy` при старте контейнера.

### Миграции базы данных

```bash
# Создание новой миграции (development)
pnpm prisma migrate dev --name migration_name

# Применение миграций (production)
pnpm prisma migrate deploy

# Генерация Prisma Client
pnpm prisma generate

# Просмотр статуса миграций
pnpm prisma migrate status
```

## Архитектура

### Streaming Upload (без оптимизации)
1. Создание записи в БД со статусом `uploading`
2. Загрузка файла в S3 через stream с вычислением checksum и size on-the-fly
3. Копирование из временного ключа в финальный (content-addressed storage)
4. Обновление статуса на `ready` при успехе

### Buffer Upload (с оптимизацией)
1. Создание записи в БД со статусом `uploading`
2. Оптимизация изображения в памяти (Sharp)
3. Загрузка оптимизированного файла в S3
4. Обновление статуса на `ready` при успехе

### Транзакционное удаление файлов
1. Обновление статуса на `deleting` в БД
2. Удаление файла из S3
3. Обновление статуса на `deleted` при успехе

### Cleanup Job
Автоматическая очистка orphan-файлов:
- Файлы со статусом `uploading` старше N минут → удаление
- Файлы со статусом `deleting` старше N минут → повторная попытка удаления

### Оптимизация изображений
- Автоматическое сжатие и изменение размера
- Конвертация форматов (JPEG, PNG, WebP)
- Настраиваемое качество и максимальные размеры

### CDN Support
- **ETag** на основе SHA256 checksum файла
- **304 Not Modified** при совпадении `If-None-Match`
- **Cache-Control** headers для долгосрочного кеширования
- **Content-addressed storage** для иммутабельности файлов

### Безопасность
- Блокировка загрузки исполняемых файлов (exe, sh, bat, jar и др.)
- Настраиваемый черный список MIME типов
- Лимит размера файла на уровне Fastify и multipart
- Валидация DTO для всех входных параметров

## Тестирование

```bash
# Unit тесты
pnpm test:unit

# E2E тесты
pnpm test:e2e

# Все тесты с coverage
pnpm test:cov
```

## Структура проекта

```
src/
├── config/              # Конфигурация
│   ├── app.config.ts
│   ├── database.config.ts
│   ├── storage.config.ts
│   ├── optimization.config.ts
│   └── cleanup.config.ts
├── modules/
│   ├── prisma/         # Prisma ORM
│   ├── files/          # Управление файлами
│   ├── storage/        # S3 интеграция
│   ├── optimization/   # Оптимизация изображений
│   ├── cleanup/        # Cleanup job
│   └── health/         # Health check
└── common/             # Общие компоненты
prisma/
├── schema.prisma       # Prisma schema
└── migrations/         # Миграции БД
```

## Roadmap

### Phase 2 (Planned)
- Динамическая генерация миниатюр
- Токены доступа для файлов
- Cleanup service для миниатюр

### Phase 3 (Planned)
- Горизонтальное масштабирование
- Prometheus метрики
- Rate limiting

## Лицензия

MIT

