// workerScope (prd.md §3.8 v1.14, UC-14): E4 — tenant; rabbitmq (E5), redisPrefix (E8) — позже. Записей в таблицы не
// создаёт (N2, CE-4).
import { randomBytes } from 'node:crypto';

/** Слаг компании: формат claim `tenant` (01 §5.2; TENANT_SLUG O без ведущего `_` служебных компаний). */
const TENANT_SLUG = /^[a-z0-9][a-z0-9-]{0,48}$/;

/** Область воркера Vitest (§3.8). */
export interface KitWorkerScope {
    /**
     * Слаг компании воркера `w<VITEST_POOL_ID>-<8 hex>` — значение `DbContext.tenant` и claim `tenant` токена. Строку
     * компании, если нужна, создаёт фабрика сервиса; `tenantId` — фабрика сервиса.
     */
    readonly tenant: string;
}

let scope: KitWorkerScope | undefined;

/** Область текущего воркера: одно значение на воркер, разные воркеры — разные. */
export function workerScope(): KitWorkerScope {
    if (scope !== undefined) {
        return scope;
    }
    const tenant = `w${process.env.VITEST_POOL_ID ?? '0'}-${randomBytes(4).toString('hex')}`;
    if (!TENANT_SLUG.test(tenant)) {
        throw new Error(`workerScope: tenant «${tenant}» вне формата ${TENANT_SLUG.source}`);
    }
    scope = { tenant };

    return scope;
}
