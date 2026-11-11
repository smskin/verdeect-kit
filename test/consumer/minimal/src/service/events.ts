// События сервиса-потребителя (AC-9.1, AC-5.13; prd.md §3.4): defineEvent каталога 01 §7.2. CompanyArchived нужен прогону
// покрытия (coverage/), основной прогон покрывает оба события.
import { defineEvent } from '@verdeect/kit/messaging';
import { z } from 'zod';

export const CompanyCreated = defineEvent({
    type: 'consumer.company.created',
    version: 1,
    subject: 'company',
    data: z.object({ companyId: z.string(), name: z.string().min(1) }),
});

export const CompanyArchived = defineEvent({
    type: 'consumer.company.archived',
    version: 1,
    subject: 'company',
    data: z.object({ companyId: z.string() }),
});

export const PUBLISHED_EVENTS = [CompanyCreated, CompanyArchived] as const;
