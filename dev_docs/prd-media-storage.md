# PRD: Микросервис хранения медиафайлов

## Обзор

Микросервис для хранения, получения и управления медиафайлами (изображения, видео, документы и т.д.) с неограниченным сроком хранения до явного удаления. Построен на стеке NestJS + Fastify + TypeScript.

## Цели

### Основные цели
- Надежная загрузка и хранение файлов
- Получение файлов по уникальным идентификаторам
- Явное удаление файлов
- Обеспечение персистентности и целостности данных
- Поддержка всех типов файлов без ограничений
- Оптимизация файлов при загрузке (сжатие, изменение размера)

### Будущие цели (v2+)
- Динамическая генерация миниатюр для изображений и видео на основе query-параметров
- Автоматический сервис очистки старых/неиспользуемых миниатюр
- Контроль доступа через токены (опционально)
- Интеграция с CDN для быстрой доставки
- Горизонтальное масштабирование (несколько инстансов)

### Вне области (Out of Scope)
- Редактирование файлов (кроме оптимизации при загрузке и миниатюр)
- Аутентификация/авторизация пользователей (делегируется API gateway)
- Версионирование файлов
- Совместное редактирование
- Синхронизация в реальном времени

## Архитектурный обзор

### Стратегия хранения
**Используется: Прямое S3 API (Garage)**

Причины выбора S3 API:
1. **Нативные S3 возможности**: Multipart uploads, presigned URLs, метаданные, ACL
2. **Лучший контроль ошибок**: Прямое управление retry, timeout, обработкой ошибок
3. **Масштабируемость**: Нет bottleneck файловой системы, лучший concurrent доступ
4. **Портативность**: Легкая миграция между S3-провайдерами
5. **Производительность**: Нет FUSE overhead, прямой network I/O
6. **Мониторинг**: Нативные S3 метрики и логирование

**Альтернатива**: Можно использовать утилиту `garage` напрямую через CLI для административных задач (создание bucket, управление ключами), но для операций с файлами рекомендуется S3 API через AWS SDK.

### Стратегия использования БД
**База данных обязательна**

Назначение:
1. **Хранение метаданных файлов**:
   - File ID (UUID)
   - Оригинальное имя файла
   - MIME тип
   - Размер файла
   - Timestamp загрузки
   - S3 object key/path
   - Checksum (SHA-256)
   - Статус (uploading, ready, deleting, deleted)
   - Параметры оптимизации (compression, max resolution)

2. **Возможности запросов**:
   - Список файлов по дате загрузки
   - Поиск по имени или MIME типу
   - Статистика использования хранилища
   - Обнаружение orphan-файлов

3. **Отслеживание миниатюр (v2)**:
   - Кэш сгенерированных миниатюр
   - Статус генерации
   - Last access timestamp для cleanup
   - Связь с родительским файлом

4. **Токены доступа (v2)**:
   - Хранение токенов для контроля доступа
   - Валидация при скачивании
   - Срок действия токенов

5. **Операционные преимущества**:
   - Audit trail
   - Soft deletes с периодом хранения
   - Batch операции
   - Аналитика и отчетность

**БД**: PostgreSQL 17 (основная поддерживаемая версия)
- Поддержка JSONB для гибких метаданных
- Сильная консистентность
- Отличная производительность для read-heavy нагрузок
- Нативная поддержка UUID
- Транзакционность для минимизации orphan-файлов

### Транзакционность и минимизация orphan-файлов

**Стратегия загрузки файлов (двухфазный подход)**:

1. **Фаза 1: Создание записи в БД**
   ```
   BEGIN TRANSACTION
   - Создать запись с status='uploading'
   - Сгенерировать UUID и S3 key
   - Зафиксировать транзакцию
   COMMIT
   ```

2. **Фаза 2: Загрузка в S3**
   ```
   - Загрузить файл в S3 по сгенерированному ключу
   - При успехе: UPDATE status='ready'
   - При ошибке: UPDATE status='failed' или DELETE запись
   ```

**Стратегия удаления файлов (обратный порядок)**:

1. **Фаза 1: Пометка в БД**
   ```
   BEGIN TRANSACTION
   - UPDATE status='deleting', deletedAt=NOW()
   COMMIT
   ```

2. **Фаза 2: Удаление из S3**
   ```
   - Удалить объект из S3
   - При успехе: UPDATE status='deleted' или DELETE запись
   - При ошибке: логировать, повторить позже через cleanup job
   ```

**Cleanup Job для orphan-файлов**:
- Периодическая задача (cron) для поиска несоответствий
- Файлы в БД со status='uploading' старше N минут → удалить
- Файлы в БД со status='deleting' старше N минут → повторить удаление из S3
- Файлы в S3 без записи в БД → логировать для ручной проверки
- Файлы в БД без объекта в S3 (status='ready') → пометить как 'missing'

## API спецификация

### Base Path
`/api/v1/files`

### Endpoints

#### 1. Загрузка файла
```
POST /api/v1/files
Content-Type: multipart/form-data

Request:
- file: binary data (required)
- optimize: JSON string (optional)
  {
    "compress": true,           // сжатие изображения
    "quality": 85,              // качество JPEG/WebP (1-100)
    "maxDimension": 1920,       // максимальная длина стороны
    "format": "webp"            // конвертация формата (jpeg, png, webp)
  }
- metadata: JSON string (optional)
  {
    "description": "Описание файла",
    "tags": ["invoice", "2024"]
  }

Response: 201 Created
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "document.pdf",
  "mimeType": "application/pdf",
  "size": 1048576,
  "originalSize": 2097152,      // если была оптимизация
  "checksum": "sha256:abc123...",
  "uploadedAt": "2024-01-15T12:00:00Z",
  "url": "/api/v1/files/550e8400-e29b-41d4-a716-446655440000"
}

Errors:
- 400: Invalid file or missing data
- 413: File too large
- 507: Insufficient storage
```

#### 2. Получение метаданных файла
```
GET /api/v1/files/:id

Response: 200 OK
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "document.pdf",
  "mimeType": "application/pdf",
  "size": 1048576,
  "checksum": "sha256:abc123...",
  "uploadedAt": "2024-01-15T12:00:00Z",
  "url": "/api/v1/files/550e8400-e29b-41d4-a716-446655440000/download"
}

Errors:
- 404: File not found
```

#### 3. Скачивание файла
```
GET /api/v1/files/:id/download
GET /api/v1/files/:id/download?token=<access_token>  // v2: с токеном доступа

Response: 200 OK
Content-Type: <original mime type>
Content-Disposition: attachment; filename="document.pdf"
Content-Length: 1048576

<binary data>

Errors:
- 404: File not found
- 410: File deleted
- 403: Invalid or expired token (v2)
```

#### 4. Скачивание с миниатюрой (v2)
```
GET /api/v1/files/:id/download?width=300&height=200&format=webp&quality=85
GET /api/v1/files/:id/thumbnail?width=150&height=150&fit=cover

Query параметры:
- width: ширина в пикселях
- height: высота в пикселях
- format: webp, jpeg, png
- quality: 1-100 (для JPEG/WebP)
- fit: cover, contain, fill, inside, outside (Sharp resize modes)

Response: 200 OK
Content-Type: image/webp
Cache-Control: public, max-age=31536000

<binary data>

Примечание: Миниатюры генерируются динамически при первом запросе,
затем кэшируются в S3 и БД для последующих запросов.

Errors:
- 404: File not found
- 400: Invalid parameters
- 415: Unsupported media type (не изображение/видео)
```

#### 5. Удаление файла
```
DELETE /api/v1/files/:id

Response: 204 No Content

Errors:
- 404: File not found
- 409: File already deleted
```

#### 6. Список файлов (с пагинацией)
```
GET /api/v1/files?limit=50&offset=0&sortBy=uploadedAt&order=desc

Response: 200 OK
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "filename": "document.pdf",
      "mimeType": "application/pdf",
      "size": 1048576,
      "uploadedAt": "2024-01-15T12:00:00Z"
    }
  ],
  "total": 150,
  "limit": 50,
  "offset": 0
}
```

#### 7. Health Check
```
GET /api/v1/health

Response: 200 OK
{
  "status": "ok",
  "timestamp": "2024-01-15T12:00:00Z",
  "storage": {
    "s3": "connected",
    "database": "connected"
  }
}
```

## Модель данных

### File Entity (PostgreSQL)

```typescript
{
  id: UUID (PK),
  filename: VARCHAR(255),
  mimeType: VARCHAR(100),
  size: BIGINT,
  originalSize: BIGINT (nullable),        // размер до оптимизации
  checksum: VARCHAR(64),
  s3Key: VARCHAR(500),
  s3Bucket: VARCHAR(100),
  status: ENUM('uploading', 'ready', 'deleting', 'deleted', 'failed', 'missing'),
  optimizationParams: JSONB (nullable),   // параметры оптимизации
  metadata: JSONB (nullable),             // пользовательские метаданные
  accessToken: VARCHAR(64) (nullable),    // v2: токен доступа
  tokenExpiresAt: TIMESTAMP (nullable),   // v2: срок действия токена
  uploadedAt: TIMESTAMP,
  deletedAt: TIMESTAMP (nullable),
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP
}

Indexes:
- PRIMARY KEY (id)
- INDEX (status, uploadedAt)
- INDEX (mimeType)
- INDEX (checksum)
- INDEX (s3Key)
- INDEX (accessToken) WHERE accessToken IS NOT NULL  // v2: partial index
```

### Thumbnail Entity (v2)

```typescript
{
  id: UUID (PK),
  fileId: UUID (FK -> File.id),
  s3Key: VARCHAR(500),
  size: BIGINT,
  width: INTEGER,
  height: INTEGER,
  format: VARCHAR(10),              // webp, jpg, png
  quality: INTEGER,                 // 1-100
  fit: VARCHAR(20),                 // cover, contain, etc.
  paramsHash: VARCHAR(64),          // hash параметров для уникальности
  lastAccessedAt: TIMESTAMP,
  createdAt: TIMESTAMP
}

Indexes:
- PRIMARY KEY (id)
- FOREIGN KEY (fileId) ON DELETE CASCADE
- UNIQUE INDEX (fileId, paramsHash)  // предотвращение дубликатов
- INDEX (lastAccessedAt)             // для cleanup
```

## Техническая реализация

### Технологический стек
- **Runtime**: Node.js 22+
- **Framework**: NestJS 11+
- **HTTP Server**: Fastify 5+
- **Language**: TypeScript 5+
- **Database**: PostgreSQL 17 (via TypeORM или Prisma)
- **Object Storage**: Garage S3-compatible API
- **S3 Client**: AWS SDK v3 (@aws-sdk/client-s3)
- **Image Processing**: External Image Processing microservice (NestJS + Sharp)
- **Video Processing**: FFmpeg (для видео миниатюр, v2)
- **Validation**: class-validator, class-transformer
- **Logging**: Pino (via nestjs-pino)
- **Testing**: Jest
- **Queue**: BullMQ (для фоновой обработки миниатюр, v2)

### Структура модулей

```
src/
├── modules/
│   ├── files/
│   │   ├── files.module.ts
│   │   ├── files.controller.ts
│   │   ├── files.service.ts
│   │   ├── entities/
│   │   │   └── file.entity.ts
│   │   ├── dto/
│   │   │   ├── upload-file.dto.ts
│   │   │   ├── optimize-params.dto.ts
│   │   │   ├── file-response.dto.ts
│   │   │   └── list-files.dto.ts
│   │   └── interfaces/
│   │       └── file-metadata.interface.ts
│   ├── storage/
│   │   ├── storage.module.ts
│   │   ├── storage.service.ts           // S3 операции
│   │   └── interfaces/
│   │       └── storage-config.interface.ts
│   ├── optimization/
│   │   ├── optimization.module.ts
│   │   ├── image-optimizer.service.ts   // Delegates to external image processing service
│   │   └── interfaces/
│   │       └── optimization-options.interface.ts
│   ├── thumbnails/ (v2)
│   │   ├── thumbnails.module.ts
│   │   ├── thumbnails.controller.ts
│   │   ├── thumbnails.service.ts
│   │   ├── thumbnail-generator.service.ts
│   │   ├── thumbnail-cleanup.service.ts
│   │   └── entities/
│   │       └── thumbnail.entity.ts
│   ├── cleanup/
│   │   ├── cleanup.module.ts
│   │   └── orphan-cleanup.service.ts    // Cron job для orphan-файлов
│   └── health/
│       └── (existing health check)
├── common/
│   ├── filters/
│   ├── interceptors/
│   └── validators/
└── config/
    ├── app.config.ts
    ├── database.config.ts
    ├── storage.config.ts
    └── optimization.config.ts
```

### Переменные окружения

```bash
# Existing
NODE_ENV=production
LISTEN_HOST=0.0.0.0
LISTEN_PORT=8080
BASE_PATH=
LOG_LEVEL=warn
TZ=UTC

# Database
DATABASE_URL=postgresql://media_user:<secret>@localhost:5432/media_storage

# S3 Storage (Garage)
S3_ENDPOINT=https://s3.garage.example.com
S3_REGION=garage
S3_ACCESS_KEY_ID=<access_key>
S3_SECRET_ACCESS_KEY=<secret_key>
S3_BUCKET=media-files
S3_FORCE_PATH_STYLE=true

# File Upload Limits
MAX_FILE_SIZE_MB=100  # 100MB in megabytes
BLOCK_EXECUTABLE_UPLOADS=true
BLOCK_ARCHIVE_UPLOADS=true
ALLOWED_MIME_TYPES=*  # or comma-separated list

# Image Processing Microservice
IMAGE_PROCESSING_BASE_URL=http://localhost:8080/api/v1
IMAGE_PROCESSING_REQUEST_TIMEOUT_SECONDS=60

# Thumbnails (v2)
THUMBNAIL_MAX_AGE_DAYS=365
THUMBNAIL_FORMAT=webp
THUMBNAIL_QUALITY=80
THUMBNAIL_EFFORT=6

# Cleanup Job
CLEANUP_ENABLED=true
CLEANUP_CRON=0 */6 * * *  # каждые 6 часов
CLEANUP_ORPHAN_TIMEOUT_MINUTES=30  # файлы в статусе uploading старше 30 минут

# Access Tokens (v2)
ACCESS_TOKEN_ENABLED=false
ACCESS_TOKEN_DEFAULT_TTL=86400  # 24 hours in seconds
```

## Фазы реализации

### Фаза 1: Базовая функциональность (MVP)
**Длительность**: 2-3 недели

1. **Setup & Configuration** (2-3 дня)
   - Настройка PostgreSQL 17 + TypeORM/Prisma
   - Конфигурация S3 клиента (AWS SDK v3)
   - Валидация environment variables
   - Docker compose с PostgreSQL и Garage

2. **Загрузка файлов с оптимизацией** (4-5 дней)
   - Multipart file upload endpoint
   - Интеграция Sharp для оптимизации изображений
   - Транзакционная загрузка (БД → S3 → UPDATE status)
   - Stream upload в S3
   - Checksum валидация
   - Обработка ошибок с rollback

3. **Получение файлов** (2-3 дня)
   - Endpoint метаданных файла
   - Endpoint скачивания (stream из S3)
   - Правильные content-type и headers
   - Range request support (опционально)

4. **Удаление файлов** (2 дня)
   - Delete endpoint
   - Транзакционное удаление (UPDATE status → S3 delete → UPDATE/DELETE)
   - Soft delete в БД

5. **Cleanup Job** (2-3 дня)
   - Cron задача для поиска orphan-файлов
   - Очистка файлов со status='uploading' старше N минут
   - Повторная попытка удаления для status='deleting'
   - Логирование несоответствий БД ↔ S3

6. **Список файлов** (2 дня)
   - Пагинация
   - Сортировка и фильтрация
   - Оптимизация запросов

7. **Тестирование** (3-4 дня)
   - Unit тесты для сервисов
   - E2E тесты для всех endpoints
   - Integration тесты с S3 mock (LocalStack)
   - Тесты транзакционности и cleanup job
   - Load testing

8. **Документация** (2 дня)
   - API документация (OpenAPI/Swagger)
   - Обновление README
   - Deployment guide

### Фаза 2: Миниатюры и токены доступа (Будущее)
**Длительность**: 3-4 недели

1. **Динамическая генерация миниатюр**
   - Обработка изображений (Sharp)
   - Извлечение кадров из видео (FFmpeg)
   - Генерация на основе query параметров
   - Кэширование в S3 и БД
   - Lazy generation при первом запросе

2. **Thumbnail Serving**
   - Endpoint для миниатюр с query параметрами
   - Cache headers (max-age: 1 year)
   - Проверка существования в кэше
   - Асинхронная генерация через очередь (BullMQ)

3. **Cleanup Service для миниатюр**
   - Отслеживание lastAccessedAt
   - Scheduled cleanup job
   - Удаление миниатюр старше N дней без доступа
   - Оптимизация хранилища

4. **Токены доступа**
   - Генерация токенов при загрузке (опционально)
   - Валидация токенов при скачивании
   - TTL для токенов
   - Endpoint для обновления токена

5. **Оптимизация производительности**
   - CDN интеграция
   - Response caching
   - Оптимизация БД запросов
   - Connection pooling tuning

### Фаза 3: Масштабирование (Будущее)
**Длительность**: 2-3 недели

1. **Горизонтальное масштабирование**
   - Поддержка нескольких инстансов
   - Shared state через Redis
   - Distributed locks для cleanup jobs
   - Load balancing

2. **Мониторинг и метрики**
   - Prometheus metrics
   - Grafana dashboards
   - Alerting rules

## Оценка идеи токенов доступа (v2)

### Плюсы
✅ **Контроль доступа**: Возможность ограничить доступ к файлам  
✅ **Временные ссылки**: Можно создавать ссылки с ограниченным сроком действия  
✅ **Аудит**: Отслеживание кто и когда скачивал файлы  
✅ **Безопасность**: Защита от несанкционированного доступа  
✅ **Гибкость**: Разные уровни доступа для разных пользователей  

### Минусы
❌ **Сложность**: Дополнительная логика валидации и управления токенами  
❌ **Performance**: Дополнительный запрос в БД при каждом скачивании  
❌ **Кэширование**: Сложнее кэшировать файлы на CDN  
❌ **UX**: Пользователям нужно передавать токен в URL  

### Рекомендация
**Имеет смысл для определенных use cases:**

1. **Приватные файлы**: Когда нужен контроль доступа на уровне приложения
2. **Временные ссылки**: Для шаринга файлов с ограниченным сроком
3. **Платный контент**: Когда доступ к файлам платный

**Альтернативы:**
- **S3 Presigned URLs**: Garage поддерживает presigned URLs, которые работают аналогично токенам, но на уровне S3
- **API Gateway**: Делегировать аутентификацию на уровень API gateway
- **Комбинированный подход**: Публичные файлы без токенов, приватные с токенами

**Вывод**: Функция полезна, но должна быть опциональной (флаг при загрузке файла). Для MVP можно обойтись без нее, добавить в v2.

## Безопасность

1. **Валидация входных данных**
   - Ограничение размера файла
   - Валидация MIME типа
   - Санитизация имени файла
   - Проверка параметров оптимизации
   - Malware scanning (опционально)

2. **Контроль доступа**
   - Аутентификация через API gateway (внешняя)
   - Rate limiting
   - CORS конфигурация
   - Токены доступа (v2)

3. **Защита данных**
   - Шифрование S3 storage (server-side encryption)
   - Безопасные соединения с БД (SSL/TLS)
   - Управление секретами (environment variables, vault)
   - Checksum для целостности файлов

4. **Аудит и мониторинг**
   - Access logs
   - Метрики загрузки/скачивания
   - Отслеживание ошибок
   - Мониторинг использования хранилища

## Требования к производительности

- **Загрузка**: Поддержка файлов до 100MB (конфигурируемо)
- **Throughput**: Обработка 100 одновременных загрузок
- **Latency**: 
  - Получение метаданных: < 100ms (p95)
  - Начало скачивания: < 200ms (p95)
  - Генерация миниатюры: < 2s (p95, v2)
- **Availability**: 99.9% uptime
- **Storage**: Масштабируемость до TB данных
- **Масштабирование**: Один инстанс в MVP, горизонтальное масштабирование в v3

## Мониторинг и наблюдаемость

### Метрики
- Upload success/failure rate
- Среднее время загрузки по размеру файла
- Download request rate
- Использование хранилища (общий размер, количество файлов)
- Database connection pool usage
- S3 API latency
- Количество orphan-файлов
- Thumbnail cache hit rate (v2)

### Логи
- Все API запросы (access logs)
- Операции загрузки/скачивания
- Ошибки и исключения
- S3 операции
- Cleanup job выполнение

### Алерты
- Высокий error rate (> 5%)
- Превышение квоты хранилища (> 90%)
- Проблемы с подключением к БД
- Проблемы с подключением к S3
- Большое количество orphan-файлов (> 100)

## Стратегия тестирования

### Unit тесты
- Логика сервисного слоя
- DTO валидация
- Утилиты
- Mock S3 и БД
- Оптимизация изображений

### Integration тесты
- S3 операции с LocalStack/Garage
- Операции с БД (test database)
- Транзакционные сценарии
- Cleanup job

### E2E тесты
- Полные API workflows
- Сценарии ошибок
- Edge cases (большие файлы, concurrent uploads)
- Rollback при ошибках

### Load тесты
- Производительность одновременных загрузок
- Throughput скачивания
- Производительность БД запросов под нагрузкой

## Deployment

### Docker
- Multi-stage build
- PostgreSQL 17 контейнер
- Garage для локальной разработки
- Health checks
- Volume mounts для разработки

### Production
- Один инстанс в MVP
- Database migrations
- Environment-specific configs
- Backup стратегия
- Disaster recovery plan
- Kubernetes deployment (v3, для масштабирования)

## Метрики успеха

### Фаза 1 (MVP)
- [ ] Все базовые endpoints реализованы и протестированы
- [ ] 90%+ test coverage
- [ ] API документация завершена
- [ ] Успешная загрузка/скачивание файлов до 100MB
- [ ] Обработка 50 одновременных запросов
- [ ] Нулевая потеря данных
- [ ] Транзакционность: < 1% orphan-файлов
- [ ] Cleanup job работает корректно
- [ ] Оптимизация изображений работает

### Фаза 2 (Миниатюры и токены)
- [ ] Генерация миниатюр для изображений и видео
- [ ] < 2s время генерации миниатюры (p95)
- [ ] Cleanup service уменьшает хранилище на 20%+
- [ ] Динамические параметры через query string
- [ ] Токены доступа работают (опционально)
- [ ] Cache hit rate для миниатюр > 80%

### Фаза 3 (Масштабирование)
- [ ] Поддержка нескольких инстансов
- [ ] Линейное масштабирование производительности
- [ ] Distributed locks работают корректно

## Открытые вопросы

1. **Политика хранения**: Нужно ли автоматическое удаление после X дней неактивности?
2. **Дедупликация**: Нужно ли дедуплицировать файлы по checksum?
3. **Квоты**: Per-user или глобальные квоты хранилища?
4. **Backup стратегия**: S3 versioning, cross-region replication, или отдельный backup сервис?
5. **CDN интеграция**: Какой CDN провайдер? CloudFlare, AWS CloudFront, или custom?
6. **Формат миниатюр**: Всегда WebP или поддержка оригинального формата?
7. **Очередь задач**: Нужна ли очередь для оптимизации больших файлов?

## Ссылки

- [Garage Documentation](https://garagehq.deuxfleurs.fr/)
- [AWS SDK for JavaScript v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)
- [NestJS Documentation](https://docs.nestjs.com/)
- [Fastify Documentation](https://www.fastify.io/)
- [Sharp Documentation](https://sharp.pixelplumbing.com/)
- [PostgreSQL 17 Documentation](https://www.postgresql.org/docs/17/)


---

## Замечания разработчика

- Используем S3-совместимое хранилище (Garage).
- Сервис должен быть адаптирован для использования за кэширующим прокси типа Cloudflare (Cache-Control, ETag).
- Реализовано мягкое удаление (soft delete) с возможностью окончательной очистки через Cleanup Service.
