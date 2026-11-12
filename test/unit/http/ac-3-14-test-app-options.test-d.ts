// AC-3.14 (prd.md §3.8): опции createTestApp — http принимает KitHttpOptions, bodyLimit верхнего уровня убран (KT-62).
import { describe, expectTypeOf, it } from 'vitest';
import type { KitHttpOptions } from '../../../src/http/index.js';
import type { KitCoreLoggerOptions, KitRedaction } from '../../../src/observability/index.js';
import { createTestApp, type KitTestAppOptions } from '../../../src/testing/index.js';
import { ProbeModule } from './support.js';

describe('UC-4: типы createTestApp', () => {
    it('AC-3.14: http — KitHttpOptions; bodyLimit верхнего уровня — ошибка типа', () => {
        expectTypeOf<NonNullable<KitTestAppOptions['http']>>().toEqualTypeOf<KitHttpOptions>();
        // v1.25: те же типы logger и redaction, что у bootstrapService.
        expectTypeOf<NonNullable<KitTestAppOptions['logger']>>().toEqualTypeOf<KitCoreLoggerOptions>();
        expectTypeOf<NonNullable<KitTestAppOptions['redaction']>>().toEqualTypeOf<KitRedaction>();
        expectTypeOf<KitTestAppOptions>().not.toHaveProperty('bodyLimit');

        void (() =>
            createTestApp({
                module: ProbeModule,
                service: 'probe',
                // @ts-expect-error bodyLimit — только в http (v1.21).
                bodyLimit: 1024,
            }));
    });
});
