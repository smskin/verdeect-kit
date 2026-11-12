// Минимальный клиент S3 тестов (AC-1.12): запрос с подписью AWS SigV4 на node:crypto — создать бакет, PutObject с
// заголовками, GetObject. Только для тестов пакета: клиент S3 сервиса — в сервисе (N8), в пакет не тянется.
// ponytail: три операции и region us-east-1 — для большего — @aws-sdk/client-s3 точной версией в devDependencies.
import { createHash, createHmac } from 'node:crypto';

const REGION = 'us-east-1';

function sha256(data: string | Buffer): string {
    return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
    return createHmac('sha256', key).update(data).digest();
}

/** Доступ к S3-совместимому хранилищу. */
export interface S3Access {
    readonly endpoint: string;
    readonly accessKey: string;
    readonly secretKey: string;
}

/** Запрос `method path` с телом и заголовками `x-amz-*`, подписанный SigV4 (path-style). */
export async function s3Request(
    access: S3Access,
    method: 'GET' | 'PUT',
    path: string,
    body: Buffer = Buffer.alloc(0),
    headers: Readonly<Record<string, string>> = {},
): Promise<Response> {
    const url = new URL(path, access.endpoint);
    const now = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
    const day = now.slice(0, 8);
    const payloadHash = sha256(body);
    const signed: Record<string, string> = {
        host: url.host,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': now,
        ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    };
    const names = Object.keys(signed).sort();
    const canonical = [
        method,
        url.pathname,
        '',
        ...names.map((name) => `${name}:${signed[name]}`),
        '',
        names.join(';'),
        payloadHash,
    ].join('\n');
    const scope = `${day}/${REGION}/s3/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', now, scope, sha256(canonical)].join('\n');
    const key = hmac(
        hmac(hmac(hmac(`AWS4${access.secretKey}`, day), REGION), 's3'),
        'aws4_request',
    );
    const signature = createHmac('sha256', key).update(toSign).digest('hex');
    // host ставит fetch сам; в подписи он есть.
    const sent = Object.fromEntries(Object.entries(signed).filter(([name]) => name !== 'host'));

    return fetch(url, {
        method,
        headers: {
            ...sent,
            authorization: `AWS4-HMAC-SHA256 Credential=${access.accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
        },
        ...(method === 'PUT' ? { body: new Uint8Array(body) } : {}),
    });
}
