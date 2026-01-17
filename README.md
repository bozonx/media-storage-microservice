# Media Storage Microservice

Микросервис для загрузки, хранения и выдачи медиафайлов.

Хранение бинарных данных: S3-совместимое хранилище.

Метаданные: PostgreSQL (Prisma).

Дополнительно для изображений:
- Оптимизация (WebP/AVIF)
- Динамические миниатюры
- Дедупликация по checksum

## Требования

- Docker & Docker Compose

## Быстрый старт (Docker Compose)

1. Создайте `.env.production` на основе примера:

```bash
cp .env.production.example .env.production
```

2. Отредактируйте `.env.production`:
- Укажите `DATABASE_URL` для PostgreSQL
- Укажите `S3_*` для вашего S3 (или Garage из compose)

3. Запустите сервис:

```bash
docker compose -f docker/docker-compose.yml up -d
```

4. Проверьте доступность:

```bash
curl http://localhost:8080/api/v1/health
```

По умолчанию API доступен по адресу:
`http://localhost:8080/api/v1`

UI (простая страница для проверки):
`http://localhost:8080/ui`

## Конфигурация

Полный список переменных окружения см. в `.env.production.example` (источник истины).

Минимально необходимое:
- `DATABASE_URL`
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_BUCKET`

Часто используемое:
- `LISTEN_HOST` (для Docker обычно `0.0.0.0`)
- `LISTEN_PORT` (по умолчанию `8080`)
- `BASE_PATH` (префикс для API и UI, например `media`)

## API Endpoints

Базовый префикс: `/api/v1`.

Основные эндпоинты:
- `POST /files` — загрузка файла (multipart)
- `POST /files/from-url` — загрузка по URL
- `GET /files/:id` — метаданные
- `GET /files/:id/download` — скачать файл
- `GET /files/:id/thumbnail` — миниатюра (для изображений)
- `DELETE /files/:id` — удаление (soft delete)
- `GET /health` — проверка состояния

Минимальные примеры:

```bash
curl -X POST http://localhost:8080/api/v1/files \
  -F "file=@./image.jpg"
```

```bash
curl -O http://localhost:8080/api/v1/files/<file-id>/download
```

## Development

Требования:
- Node.js 22+
- pnpm 10+

Быстрый запуск dev-окружения (PostgreSQL + Garage через Docker):

```bash
pnpm setup:dev
pnpm start:dev
```

Альтернатива (вручную):

```bash
pnpm install
cp .env.development.example .env.development
docker compose -f docker-compose.yml up -d
bash scripts/init-garage.sh
pnpm start:dev
```

Тесты:

```bash
pnpm test:unit
pnpm test:e2e
pnpm test:cov
```

## Лицензия

MIT
