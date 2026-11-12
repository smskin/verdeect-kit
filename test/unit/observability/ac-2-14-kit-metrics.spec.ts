// AC-2.14 (UC-13, prd.md §3.2 v1.21): сервис внедряет KIT_METRICS — Registry, который отдаёт /metrics на METRICS_PORT, —
// и регистрирует метрику домена `<префикс>_…`: она видна в /metrics с меткой service; метрика глобального реестра
// @prometheus-io/client в /metrics не попадает.
import 'reflect-metadata';
import { Inject, Injectable, Module } from '@nestjs/common';
import { Counter, register, type Registry } from '@prometheus-io/client';
import { afterEach, describe, expect, it } from 'vitest';
import { KitConfigModule } from '../../../src/config/index.js';
import { bootstrapService } from '../../../src/http/index.js';
import { KIT_METRICS } from '../../../src/observability/index.js';
import { useBootstrapStand } from '../http/bootstrap-support.js';
import { probeEnv } from '../http/support.js';

@Injectable()
class DomainMetrics {
    readonly created: Counter;

    constructor(@Inject(KIT_METRICS) registry: Registry) {
        this.created = new Counter({
            name: 'probe_notes_created_total',
            help: 'Созданные заметки',
            registers: [registry],
        });
    }
}

@Module({
    imports: [KitConfigModule.forRoot({ schema: probeEnv })],
    providers: [DomainMetrics],
})
class MetricsModule {}

const stand = useBootstrapStand();

afterEach(() => {
    register.clear();
});

describe('UC-13: реестр метрик сервиса', () => {
    it('AC-2.14: счётчик домена через KIT_METRICS виден в /metrics с меткой service; метрика глобального реестра — нет', async () => {
        const app = stand.track(
            await bootstrapService({ module: MetricsModule, service: 'probe', env: probeEnv }),
        );
        app.get(DomainMetrics).created.inc(3);
        new Counter({ name: 'probe_global_total', help: 'Глобальный реестр' }).inc();
        const listening = stand.records().find((record) => record['msg'] === 'сервис слушает');
        const port = listening?.['metricsPort'];
        expect(typeof port).toBe('number');

        const body = await (await fetch(`http://127.0.0.1:${String(port)}/metrics`)).text();

        expect(body).toContain('probe_notes_created_total{service="probe"} 3');
        expect(body).not.toContain('probe_global_total');
    });
});
