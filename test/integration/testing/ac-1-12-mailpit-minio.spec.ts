// AC-1.12 (UC-14): startTestStack поднимает mailpit и minio из TEST_IMAGES только по флагам, адреса — через provide
// (prd.md §3.8, E1). startTestStack вызывается напрямую с подставным project. v1.23: MinIO с KMS — PutObject с
// ServerSideEncryption: AES256 в бакет, созданный тестом, проходит, объект читается.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_IMAGES } from '../../../src/testing/images.js';
import { startTestStack } from '../../../src/testing/start-test-stack.js';
import { runningImages } from '../../support/docker.js';
import { s3Request } from '../../support/s3.js';

const SERVICE = 'kit-mail-s3';

function fakeProject(): {
    provided: Map<string, unknown>;
    provide: (k: string, v: unknown) => void;
} {
    const provided = new Map<string, unknown>();

    return { provided, provide: (key, value) => provided.set(key, value) };
}

const project = fakeProject();
let teardown: (() => Promise<void>) | null = null;

beforeAll(async () => {
    teardown = await startTestStack({ service: SERVICE, mailpit: true, minio: true })(
        project as never,
    );
});

afterAll(async () => {
    await teardown?.();
});

function provided(key: string): string {
    const value = project.provided.get(key);
    expect(typeof value, key).toBe('string');

    return value as string;
}

describe('UC-14: mailpit и minio тестового контура', () => {
    it('AC-1.12: mailpit и minio подняты из TEST_IMAGES', async () => {
        expect(new Set(await runningImages(SERVICE))).toEqual(
            new Set([TEST_IMAGES.mailpit, TEST_IMAGES.minio]),
        );
    });

    it('AC-1.12: адреса переданы через provide', async () => {
        expect(provided('kitSmtpUrl')).toMatch(/^smtp:\/\//);
        expect((await fetch(`${provided('kitMailpitUrl')}/livez`)).status).toBe(200);
        expect((await fetch(`${provided('kitS3Endpoint')}/minio/health/live`)).status).toBe(200);
        expect(provided('kitS3AccessKey')).not.toBe('');
        expect(provided('kitS3SecretKey')).not.toBe('');
        expect(project.provided.has('kitPostgresUrl')).toBe(false);
    });

    it('AC-1.12: PutObject с ServerSideEncryption: AES256 в бакет, созданный тестом, проходит; объект читается', async () => {
        const access = {
            endpoint: provided('kitS3Endpoint'),
            accessKey: provided('kitS3AccessKey'),
            secretKey: provided('kitS3SecretKey'),
        };
        expect((await s3Request(access, 'PUT', '/ac112')).status).toBe(200);

        const put = await s3Request(access, 'PUT', '/ac112/note.txt', Buffer.from('шифр'), {
            'x-amz-server-side-encryption': 'AES256',
        });
        expect(put.status, await put.clone().text()).toBe(200);
        expect(put.headers.get('x-amz-server-side-encryption')).toBe('AES256');

        const get = await s3Request(access, 'GET', '/ac112/note.txt');
        expect(get.status).toBe(200);
        expect(await get.text()).toBe('шифр');
    });

    it('AC-1.12: без флагов mailpit/minio не стартуют', async () => {
        const other = fakeProject();

        const stop = await startTestStack({ service: 'kit-no-mail', postgres: false })(
            other as never,
        );

        expect(await runningImages('kit-no-mail')).toEqual([]);
        expect(other.provided.has('kitSmtpUrl')).toBe(false);
        expect(other.provided.has('kitS3Endpoint')).toBe(false);
        await stop();
    });

    it('AC-1.12: после teardown контейнеров нет', async () => {
        await teardown?.();
        teardown = null;

        expect(await runningImages(SERVICE)).toEqual([]);
    });
});
