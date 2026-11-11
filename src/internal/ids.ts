// ulid, newId (prd.md §3.3, AC-4.9). Эталон — O ids.ts: алфавит Crockford, 10 знаков времени, 16 случайных;
// по PRD — проверка префикса ^[a-z]{2,5}$, без монотонности внутри миллисекунды.
import { randomBytes } from 'node:crypto';

/** Алфавит Crockford base32 (без I, L, O, U). */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Наибольшее время ULID — 48 бит миллисекунд. */
const MAX_TIME = 2 ** 48 - 1;

/** Формат префикса идентификатора `newId`: 2–5 строчных латинских букв (реестр префиксов — README). */
export const ID_PREFIX = /^[a-z]{2,5}$/;

/**
 * ULID: 10 знаков времени (`now`, мс, по умолчанию `Date.now()`) и 16 случайных знаков Crockford base32.
 * Сортировка строк совпадает с порядком по времени до миллисекунды.
 * @throws {RangeError} `now` не целое, отрицательное или больше 2^48 − 1.
 */
export function ulid(now: number = Date.now()): string {
    if (!Number.isInteger(now) || now < 0 || now > MAX_TIME) {
        throw new RangeError('ulid: время вне диапазона');
    }
    let time = '';
    let rest = now;
    for (let index = 0; index < 10; index += 1) {
        time = CROCKFORD.charAt(rest % 32) + time;
        rest = Math.floor(rest / 32);
    }
    let random = '';
    // 256 делится на 32 без остатка — взятие по модулю не смещает распределение (O).
    for (const byte of randomBytes(16)) {
        random += CROCKFORD.charAt(byte % 32);
    }

    return time + random;
}

/**
 * Идентификатор сущности `<prefix>_<ULID>`, например `fil_01J…` (AC-4.9).
 * @throws {TypeError} префикс вне формата `^[a-z]{2,5}$`.
 */
export function newId(prefix: string): string {
    if (!ID_PREFIX.test(prefix)) {
        throw new TypeError(`newId: префикс «${prefix}» вне формата ^[a-z]{2,5}$`);
    }

    return `${prefix}_${ulid()}`;
}
