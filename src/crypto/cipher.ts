// Шифр секретов /crypto (prd.md §3.6, UC-10, AC-7.1–AC-7.5). Эталон — B identity-client session-cipher.ts (версия ключа
// v<N>, AAD, версия из значения без перебора) + HKDF-SHA256 и строгие длины IV/тега из O private-key-cipher.ts
// (OR-102 п. 7). Старые форматы не читаются (P0, N9).
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { encryptionKeysSchema } from '../config/fragments.js';
import { assertServiceName } from '../internal/service-name.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const MIN_SECRET_BYTES = 32;
const PURPOSE_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
const VALUE_PATTERN = /^v([1-9]\d*):([A-Za-z0-9_-]+):([A-Za-z0-9_-]*):([A-Za-z0-9_-]+)$/;

/** Причина отказа `decrypt`: формат значения, версия ключа не в `keys`, проверка подлинности GCM. */
export type DecryptErrorReason = 'format' | 'unknown_version' | 'auth';

/** Опции `createCipher` (§3.6). */
export interface KitCipherOptions {
    /** Имя сервиса `^[a-z][a-z0-9-]{1,31}$`; входит в `info` HKDF. */
    readonly service: string;
    /** Ключи `[{version, secret}]` (как `ENCRYPTION_KEYS`); первый шифрует, остальные только читаются. */
    readonly keys: readonly {
        /** Версия ключа, целое ≥ 1; попадает в префикс значения `v<N>`. */
        readonly version: number;
        /** Секрет base64url без `=`, не короче 32 байт. */
        readonly secret: string;
    }[];
    /** Назначение `^[a-z][a-z0-9-]{1,31}$`; разные назначения — разные ключи. */
    readonly purpose: string;
}

/** Шифр одного назначения (§3.6). */
export interface KitCipher {
    /** Шифрует текст ключом `keys[0]`; результат — `v<N>:<iv>:<ct>:<tag>` (base64url). `aad` обязателен. */
    encrypt(
        plaintext: string,
        opts: {
            /** Привязка значения к записи, обычно `<purpose>:<id записи>`; непустая. */
            readonly aad: string;
        },
    ): string;
    /**
     * Расшифровывает значение ключом его версии.
     * @throws {DecryptError} `'format'`, `'unknown_version'` или `'auth'`.
     */
    decrypt(
        value: string,
        opts: {
            /** Тот же `aad`, что при шифровании. */
            readonly aad: string;
        },
    ): string;
    /**
     * `true`, если версия значения не совпадает с версией `keys[0]`.
     * @throws {DecryptError} `'format'` — значение вне формата.
     */
    needsReencrypt(value: string): boolean;
}

const DECRYPT_MESSAGES: Readonly<Record<DecryptErrorReason, string>> = {
    format: 'значение шифра в неверном формате',
    unknown_version: 'версии ключа значения нет в ENCRYPTION_KEYS',
    auth: 'значение шифра не прошло проверку подлинности',
};

/** Отказ расшифровки; текст и поля без открытого текста, `aad`, значения и ключей (NFR-4). */
export class DecryptError extends Error {
    /** Причина отказа. */
    readonly reason: DecryptErrorReason;

    /** @param reason причина отказа. */
    constructor(reason: DecryptErrorReason) {
        super(DECRYPT_MESSAGES[reason]);
        this.name = 'DecryptError';
        this.reason = reason;
    }
}

interface ParsedValue {
    readonly version: number;
    readonly iv: Buffer;
    readonly ct: Buffer;
    readonly tag: Buffer;
}

/** Строгое декодирование части: только каноничный base64url (лишний символ или хвостовые биты — 'format'; KT-26 п. 2). */
function decodePart(part: string): Buffer {
    const bytes = Buffer.from(part, 'base64url');
    if (bytes.toString('base64url') !== part) {
        throw new DecryptError('format');
    }

    return bytes;
}

function parse(value: string): ParsedValue {
    const match = VALUE_PATTERN.exec(value);
    if (match === null) {
        throw new DecryptError('format');
    }
    const [, version = '', iv = '', ct = '', tag = ''] = match;
    const parsed = {
        version: Number(version),
        iv: decodePart(iv),
        ct: decodePart(ct),
        tag: decodePart(tag),
    };
    if (parsed.iv.length !== IV_BYTES || parsed.tag.length !== TAG_BYTES) {
        throw new DecryptError('format');
    }

    return parsed;
}

function assertAad(aad: string, where: string): void {
    if (typeof aad !== 'string' || aad.length === 0) {
        throw new TypeError(`${where}: aad обязателен — непустая строка`);
    }
}

/**
 * Создаёт шифр AES-256-GCM для назначения `purpose` сервиса `service`. Ключ каждой версии — HKDF-SHA256 от
 * декодированных байт секрета, соль пустая, `info = verdeect-<service>:<purpose>`, 32 байта; выводится один раз.
 * `aad` значения — `<purpose>:<id записи>`: значение одной записи не расшифровывается в другой.
 *
 * Смена ключа (UC-10): 1) `verdeect-kit crypto generate-secret`; 2) новая версия первой в `ENCRYPTION_KEYS`, старая
 * остаётся; 3) перезапуск всех реплик; 4) задача под `runExclusive` перешифровывает значения с
 * `needsReencrypt(value) === true`; 5) старая версия убирается, когда значений под ней не осталось.
 * @throws {TypeError} `service`, `purpose` вне формата или `keys` не по схеме `ENCRYPTION_KEYS` (пути без значений).
 */
export function createCipher(options: KitCipherOptions): KitCipher {
    const { service, purpose } = options;
    assertServiceName(service, 'createCipher');
    if (!PURPOSE_PATTERN.test(purpose)) {
        throw new TypeError(
            `createCipher: purpose «${purpose}» вне формата ^[a-z][a-z0-9-]{1,31}$`,
        );
    }
    const checked = encryptionKeysSchema.safeParse(options.keys);
    if (!checked.success) {
        const paths = checked.error.issues.map((issue) =>
            ['keys', ...issue.path.map(String)].join('.'),
        );
        throw new TypeError(`createCipher: неверные keys: ${[...new Set(paths)].join(', ')}`);
    }
    const info = `verdeect-${service}:${purpose}`;
    const keys = new Map(
        checked.data.map(({ version, secret }) => [
            version,
            Buffer.from(
                hkdfSync(
                    'sha256',
                    Buffer.from(secret, 'base64url'),
                    Buffer.alloc(0),
                    info,
                    KEY_BYTES,
                ),
            ),
        ]),
    );
    const [current] = checked.data;
    const currentKey = current === undefined ? undefined : keys.get(current.version);
    if (current === undefined || currentKey === undefined) {
        // Недостижимо: схема требует min(1); проверка — для noUncheckedIndexedAccess.
        throw new TypeError('createCipher: неверные keys: keys');
    }

    return {
        encrypt(plaintext, { aad }) {
            assertAad(aad, 'encrypt');
            const iv = randomBytes(IV_BYTES);
            const cipher = createCipheriv(ALGORITHM, currentKey, iv, { authTagLength: TAG_BYTES });
            cipher.setAAD(Buffer.from(aad, 'utf8'));
            const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
            const tag = cipher.getAuthTag();

            return `v${current.version}:${iv.toString('base64url')}:${ct.toString('base64url')}:${tag.toString('base64url')}`;
        },
        decrypt(value, { aad }) {
            assertAad(aad, 'decrypt');
            const parsed = parse(value);
            const key = keys.get(parsed.version);
            if (key === undefined) {
                throw new DecryptError('unknown_version');
            }
            const decipher = createDecipheriv(ALGORITHM, key, parsed.iv, {
                authTagLength: TAG_BYTES,
            });
            decipher.setAAD(Buffer.from(aad, 'utf8'));
            decipher.setAuthTag(parsed.tag);
            try {
                return Buffer.concat([decipher.update(parsed.ct), decipher.final()]).toString(
                    'utf8',
                );
            } catch {
                throw new DecryptError('auth');
            }
        },
        needsReencrypt(value) {
            return parse(value).version !== current.version;
        },
    };
}

/**
 * Новый секрет для `ENCRYPTION_KEYS`: `bytes` случайных байт в base64url без `=`.
 * @param bytes длина в байтах, целое ≥ 32 (по умолчанию 32).
 * @throws {RangeError} `bytes` не целое или меньше 32.
 */
export function generateSecret(bytes = MIN_SECRET_BYTES): string {
    if (!Number.isInteger(bytes) || bytes < MIN_SECRET_BYTES) {
        throw new RangeError('generateSecret: bytes — целое не меньше 32');
    }

    return randomBytes(bytes).toString('base64url');
}
