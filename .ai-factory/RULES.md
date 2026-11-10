# Правила проекта

> Короткие обязательные правила и соглашения проекта. Загружаются автоматически в /aif-implement.

## Правила

- На Fastify в middleware (pino-http, `autoLogging.ignore`, `customLogLevel`) путь запроса брать из `req.originalUrl ?? req.url`: middie подменяет `req.url` путём относительно точки монтирования.
