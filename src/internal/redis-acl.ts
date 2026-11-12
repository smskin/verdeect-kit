// aclfile Redis (prd.md §3.7, UC-12): общий для CLI redis acl и startTestStack (как internal/rabbitmq-definitions). Пароли —
// sha256 hex (#<hash>), default off. Права сервиса — свои ключи и каналы <svc>:*, все команды кроме @dangerous (D3 плана
// E8). Без внешних пакетов: только node:crypto.
import { createHash } from 'node:crypto';
import { assertServiceName } from './service-name.js';

/** Формат хеша пароля в aclfile: sha256, 64 hex в нижнем регистре. */
export const REDIS_PASSWORD_HASH = /^[0-9a-f]{64}$/;

/** Пользователь сервиса в aclfile. */
export interface RedisAclUser {
    /** Имя сервиса = имя пользователя Redis. */
    readonly service: string;
    /** sha256 пароля, 64 hex. */
    readonly passwordHash: string;
}

/** Ключ окружения с хешем пароля сервиса: `REDIS_PASSWORD_HASH_<SVC>` (заглавные, `-` → `_`). */
export function redisPasswordHashKey(service: string): string {
    return `REDIS_PASSWORD_HASH_${service.toUpperCase().replaceAll('-', '_')}`;
}

/** sha256 пароля в формате aclfile. */
export function redisPasswordHash(password: string): string {
    return createHash('sha256').update(password, 'utf8').digest('hex');
}

/**
 * Правила пользователя сервиса: `on #<hash> ~<svc>:* &<svc>:* +@all -@dangerous` — строка aclfile и аргументы
 * `ACL SETUSER` внешнего Redis (§3.7, §3.8).
 */
export function redisUserRules(service: string, passwordHash: string): string[] {
    return ['on', `#${passwordHash}`, `~${service}:*`, `&${service}:*`, '+@all', '-@dangerous'];
}

/**
 * aclfile: первая строка `user default off`, далее по строке на сервис
 * `user <svc> on #<hash> ~<svc>:* &<svc>:* +@all -@dangerous`, затем `extra` (администратор теста); `\n` в конце.
 */
export function buildRedisAclFile(options: {
    readonly users: readonly RedisAclUser[];
    readonly extra?: readonly string[];
}): string {
    const lines = ['user default off'];
    for (const { service, passwordHash } of options.users) {
        assertServiceName(service, 'buildRedisAclFile');
        if (!REDIS_PASSWORD_HASH.test(passwordHash)) {
            throw new TypeError(`buildRedisAclFile: хеш пароля «${service}» — не 64 hex`);
        }
        lines.push(`user ${service} ${redisUserRules(service, passwordHash).join(' ')}`);
    }

    return `${[...lines, ...(options.extra ?? [])].join('\n')}\n`;
}
