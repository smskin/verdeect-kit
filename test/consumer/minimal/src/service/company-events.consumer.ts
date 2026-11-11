// Обработчик событий компании (AC-9.1; prd.md §3.4 subscriber.on): сервис потребляет своё же событие — факт обработки —
// строка consumer.inbox (inbox занят в транзакции обработчика).
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { KitSubscriber } from '@verdeect/kit/messaging';
import { CompanyCreated } from './events.js';

@Injectable()
export class CompanyEventsConsumer implements OnModuleInit {
    private readonly logger = new Logger(CompanyEventsConsumer.name);

    constructor(private readonly subscriber: KitSubscriber) {}

    onModuleInit(): void {
        this.subscriber.on(CompanyCreated, async (event) => {
            this.logger.debug({ id: event.id }, 'consumer: company.created обработан');
            await Promise.resolve();
        });
    }
}
