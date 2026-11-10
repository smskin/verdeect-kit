// AC-3.10 (UC-1, UC-3): bootstrapService — имя сервиса вне ^[a-z][a-z0-9-]{1,31}$ → отказ запуска (prd.md §3.5).
import { describe, expect, it } from 'vitest';
import { bootstrapService } from '../../../src/http/index.js';
import { expectExit, useBootstrapStand } from './bootstrap-support.js';
import { probeEnv, ProbeModule } from './support.js';

const stand = useBootstrapStand();

describe('UC-3: имя сервиса', () => {
    it.each(['Bff_App', '', `a${'b'.repeat(32)}`])(
        'AC-3.10: «%s» — отказ запуска (fatal, exit 1, текст формата)',
        async (service) => {
            const exit = await expectExit(
                bootstrapService({ module: ProbeModule, service, env: probeEnv }),
            );
            const fatal = stand.records().find((record) => record.level === 60);

            expect(exit.code).toBe(1);
            expect(JSON.stringify(fatal)).toContain('вне формата ^[a-z][a-z0-9-]{1,31}$');
        },
    );

    it('AC-3.10: bff-app проходит', async () => {
        const app = stand.track(
            await bootstrapService({ module: ProbeModule, service: 'bff-app', env: probeEnv }),
        );

        expect(app.getHttpServer().listening).toBe(true);
        expect(stand.records().some((record) => record.msg === 'сервис слушает')).toBe(true);
    });
});
