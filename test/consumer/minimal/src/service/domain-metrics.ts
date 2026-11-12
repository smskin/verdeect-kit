// Метрика домена потребителя (AC-2.14, prd.md §3.2 v1.21): реестр экземпляра из KIT_METRICS, префикс — имя сервиса.
import { Inject, Injectable } from '@nestjs/common';
import { Gauge, type Registry } from '@prometheus-io/client';
import { KIT_METRICS } from '@verdeect/kit/observability';

@Injectable()
export class DomainMetrics {
    /** `consumer_started` — 1 после сборки приложения. */
    readonly started: Gauge;

    constructor(@Inject(KIT_METRICS) registry: Registry) {
        this.started = new Gauge({
            name: 'consumer_started',
            help: 'Приложение потребителя собрано',
            registers: [registry],
        });
        this.started.set(1);
    }
}
