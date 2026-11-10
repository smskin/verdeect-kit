// AC-1.2 (C; prd.md v1.13 NFR-3, §3.8): @nestjs/testing — опциональный peer /testing. Без него /testing импортируется
// (testcontainers есть), а createTestApp падает с текстом AC-1.2.
import { createTestApp } from '@verdeect/kit/testing';
import { describe, expect, it } from 'vitest';
import { AppModule } from './service/app.module.js';

describe('UC-14: createTestApp без @nestjs/testing', () => {
    it('AC-1.2: createTestApp без @nestjs/testing → «@verdeect/kit/testing требует @nestjs/testing — добавьте в зависимости сервиса»', async () => {
        await expect(createTestApp({ module: AppModule, service: 'consumer' })).rejects.toThrow(
            '@verdeect/kit/testing требует @nestjs/testing — добавьте в зависимости сервиса',
        );
    });
});
