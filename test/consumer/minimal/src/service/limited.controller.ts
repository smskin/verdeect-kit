// Тестовый маршрут лимитера потребителя (AC-9.1, AC-8.4, UC-11; E8): GET /limited — RateLimiter.hit, при отказе
// throwRateLimited → 429 RATE_LIMITED + Retry-After. Без @Api: не контракт сервиса, снимок OpenAPI не меняется.
import { Controller, Get } from '@nestjs/common';
import { RateLimiter, throwRateLimited } from '@verdeect/kit/redis';

@Controller('limited')
export class LimitedController {
    constructor(private readonly limiter: RateLimiter) {}

    @Get()
    async handle(): Promise<{ remaining: number }> {
        const result = await this.limiter.hit('limited:all', { limit: 2, windowMs: 60_000 });
        if (!result.allowed) {
            throwRateLimited(result);
        }

        return { remaining: result.remaining };
    }
}
