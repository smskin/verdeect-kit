// AC-5.20 (UC-1, UC-6): KitMessagingModule.forRoot — имя сервиса вне ^[a-z][a-z0-9-]{1,31}$ → отказ с тем же текстом,
// что bootstrapService (AC-3.10, общая assertServiceName) (prd.md §3.4).
import { describe, expect, it } from 'vitest';
import { assertServiceName } from '../../../src/internal/service-name.js';
import { KitMessagingModule } from '../../../src/messaging/kit-messaging.module.js';

function textAfterPlace(fn: () => unknown): string {
    try {
        fn();
    } catch (error) {
        return String((error as Error).message).replace(/^[^:]+: /, '');
    }

    return '';
}

describe('UC-6: имя сервиса /messaging', () => {
    it.each(['Bff_App', '', `a${'b'.repeat(32)}`])(
        'AC-5.20: forRoot с service «%s» — отказ с тем же текстом, что AC-3.10',
        async (service) => {
            const error: unknown = await KitMessagingModule.forRoot({ service }).catch(
                (reason: unknown) => reason,
            );

            expect(error).toBeInstanceOf(TypeError);
            const message = (error as Error).message;
            expect(message.startsWith('KitMessagingModule: ')).toBe(true);
            expect(message.replace(/^[^:]+: /, '')).toBe(
                textAfterPlace(() => assertServiceName(service, 'bootstrapService')),
            );
        },
    );

    it("AC-5.20: 'bff-app' проходит", async () => {
        const module = await KitMessagingModule.forRoot({ service: 'bff-app' });

        expect(module.module).toBe(KitMessagingModule);
        expect(module.global).toBe(true);
    });
});
