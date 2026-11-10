// Модуль тестов AC-3.12 (prd.md §3.5): GET /report пишет в лог и в GlitchTip значения под чувствительными именами.
import 'reflect-metadata';
import { Controller, Get, Logger, Module } from '@nestjs/common';
import { KitConfigModule } from '../../../src/config/index.js';
import { captureError } from '../../../src/observability/sentry.js';
import { probeEnv, ProbeController } from './support.js';

/** Значения под чувствительными именами: ни одно не должно попасть в лог и событие. */
export const SECRETS = {
    projectSecret: 'MARK_PROJECT',
    password: 'MARK_PASSWORD',
    refresh_token: 'MARK_REFRESH',
    authorization: 'MARK_AUTH',
} as const;

@Controller()
class ReportController {
    private readonly logger = new Logger('ReportController');

    @Get('report')
    report(): { ok: true } {
        this.logger.warn({ ...SECRETS }, 'отчёт с секретами');
        captureError(new Error('отчёт'), { extra: { ...SECRETS } });

        return { ok: true };
    }
}

@Module({
    imports: [KitConfigModule.forRoot({ schema: probeEnv })],
    controllers: [ProbeController, ReportController],
})
export class RoleModule {}

/** Строки журнала доступа pino-http (у них есть req и res). */
export function accessLines(
    records: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
    return records.filter((record) => 'req' in record && 'res' in record);
}
