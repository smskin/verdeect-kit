// Помощники unit-тестов /crypto (prd.md §3.6, AC-7.1–AC-7.5).
import { randomBytes } from 'node:crypto';
import { expect } from 'vitest';
import { createCipher, DecryptError, type DecryptErrorReason } from '../../../src/crypto/index.js';

/** Новый секрет 32 байта base64url. */
export function secret(): string {
    return randomBytes(32).toString('base64url');
}

/** Шифр с ключами `keys`; service и purpose по умолчанию — `svc-a`, `client-secret`. */
export function cipherOf(
    keys: readonly { readonly version: number; readonly secret: string }[],
    { service = 'svc-a', purpose = 'client-secret' }: { service?: string; purpose?: string } = {},
) {
    return createCipher({ service, keys, purpose });
}

/** Причина `DecryptError`, брошенной `fn`; другой исход — провал теста. */
export function reasonOf(fn: () => unknown): DecryptErrorReason {
    return errorOf(fn).reason;
}

/** `DecryptError`, брошенная `fn`; другой исход — провал теста. */
export function errorOf(fn: () => unknown): DecryptError {
    try {
        fn();
    } catch (error) {
        if (error instanceof DecryptError) {
            return error;
        }
        expect.fail(`ожидалась DecryptError, брошено: ${String(error)}`);
    }
    expect.fail('ожидалась DecryptError, исключения нет');
}

/** Части значения: 1 — iv, 2 — ct, 3 — tag. */
export type ValuePart = 'iv' | 'ct' | 'tag';

const PART_INDEX: Record<ValuePart, number> = { iv: 1, ct: 2, tag: 3 };

/** Меняет первый байт декодированной части и кодирует обратно; длина части сохраняется. */
export function flipByte(value: string, part: ValuePart): string {
    const parts = value.split(':');
    const index = PART_INDEX[part];
    const bytes = Buffer.from(parts[index] ?? '', 'base64url');
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    parts[index] = bytes.toString('base64url');

    return parts.join(':');
}
