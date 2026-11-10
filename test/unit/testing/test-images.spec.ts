// TEST_IMAGES (prd.md §3.8, E1); эталон — O test/support/images.ts.
import { describe, expect, it } from 'vitest';
import { imageRepository, TEST_IMAGES } from '../../../src/testing/images.js';

describe('§3.8: TEST_IMAGES', () => {
    it('§3.8: TEST_IMAGES — ровно пять образов PRD', () => {
        expect(TEST_IMAGES).toEqual({
            postgres: 'postgres:17.11-alpine3.24',
            redis: 'redis:7.4.11-alpine',
            rabbitmq: 'rabbitmq:4.3.6-management-alpine',
            mailpit: 'axllent/mailpit:v1.31.6',
            minio: 'pgsty/minio:RELEASE.2026-08-04T00-00-00Z',
        });
    });

    it('§3.8: imageRepository', () => {
        expect(imageRepository(TEST_IMAGES.mailpit)).toBe('axllent/mailpit');
        expect(imageRepository(TEST_IMAGES.minio)).toBe('pgsty/minio');
        expect(imageRepository(TEST_IMAGES.postgres)).toBe('postgres');
        expect(imageRepository('postgres')).toBe('postgres');
    });
});
