// @Idempotent (prd.md §3.3а, AC-4.14). Эталон — O IDEMPOTENT/SetMetadata; ключ метаданных — internal/metadata.ts (его
// читает OpenAPI /http без импорта idempotency). Без pg.
import { SetMetadata } from '@nestjs/common';
import { IDEMPOTENT_METADATA, type KitIdempotentOptions } from '../internal/metadata.js';

/**
 * Маршрут принимает `Idempotency-Key` (§3.3а): повтор с тем же ключом и телом — сохранённый ответ и
 * `Idempotent-Replayed: true`. Только на маршрутах с `VerdeectAuthGuard`: без проверенного принципала — 500.
 * @throws {TypeError} `tenantFromBody` — пустая строка или путь с пустым сегментом.
 */
export function Idempotent(options: KitIdempotentOptions = {}): MethodDecorator {
    const path = options.tenantFromBody;
    if (path !== undefined && path.split('.').some((segment) => segment === '')) {
        throw new TypeError(
            '@Idempotent: tenantFromBody — путь поля через точку без пустых сегментов',
        );
    }

    return SetMetadata(IDEMPOTENT_METADATA, options);
}
