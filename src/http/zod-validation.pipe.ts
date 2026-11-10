// ZodValidationPipe (prd.md §3.5, AC-3.1): ошибка схемы → 422 VALIDATION_FAILED, details.issues [{path, code}] без значений.
// Эталон — O zod-validation.pipe.ts (P — идентичен) и O validation-failed.error.ts (форма issues). По PRD:
// DomainError('VALIDATION_FAILED') вместо ValidationFailedError; 400/413/415 даёт парсер тела Fastify, отображает фильтр.
import { Injectable, Logger, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { DomainError } from './errors.js';

/**
 * Разбор тела, query или параметра запроса zod-схемой (§3.5). Успех — данные схемы (с умолчаниями); ошибка —
 * `DomainError('VALIDATION_FAILED', {issues})`, путь — через точку, без пути — `(body)`. Схема публична: по ней
 * построитель OpenAPI выводит схемы запроса.
 */
@Injectable()
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
    private readonly logger = new Logger(ZodValidationPipe.name);

    /** @param schema схема входа (читает построитель OpenAPI). */
    constructor(readonly schema: T) {}

    /** Данные схемы или 422 `VALIDATION_FAILED`. */
    transform(value: unknown): z.output<T> {
        const result = this.schema.safeParse(value);
        if (result.success) {
            return result.data;
        }
        const issues = result.error.issues.map((issue) => ({
            path: issue.path.map(String).join('.') || '(body)',
            code: issue.code,
        }));
        // Только пути и коды: значения ввода в лог не попадают (эталон O).
        this.logger.debug(
            { issues: issues.map((item) => `${item.path}:${item.code}`) },
            'запрос отклонён схемой',
        );
        throw new DomainError('VALIDATION_FAILED', { issues });
    }
}
