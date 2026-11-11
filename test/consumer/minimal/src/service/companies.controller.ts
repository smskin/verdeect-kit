// Маршрут потребителя с @Idempotent (AC-3.8, AC-4.14, AC-9.1): создание компании в Db.transaction под тенантом токена;
// в тестах процесса не вызывается — нужен снимку OpenAPI и сборке DI.
import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
    principalOf,
    RequireTenant,
    VerdeectAuthGuard,
    type PrincipalCarrier,
} from '@verdeect/auth/nest';
import { Db, newId, type DbContext } from '@verdeect/kit/database';
import { Api, ZodValidationPipe } from '@verdeect/kit/http';
import { Idempotent } from '@verdeect/kit/idempotency';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { company } from './schema.js';

export const Company = z.object({ id: z.string(), name: z.string() });
const CreateCompany = z.strictObject({ name: z.string().min(1) });

@Controller('companies')
@UseGuards(VerdeectAuthGuard)
export class CompaniesController {
    constructor(private readonly db: Db) {}

    @Post()
    @RequireTenant()
    @Idempotent({ required: true })
    @Api({ summary: 'Создать компанию', response: Company })
    async create(
        @Body(new ZodValidationPipe(CreateCompany)) body: z.output<typeof CreateCompany>,
        @Req() request: PrincipalCarrier,
        @Res({ passthrough: true }) reply: FastifyReply,
    ): Promise<z.output<typeof Company>> {
        const principal = principalOf(request);
        const tenant = principal !== null && principal.kind !== 'service' ? principal.tenant : null;
        const ctx: DbContext = { tenant, traceId: 'consumer', actor: { channel: 'http' } };
        const id = newId('cmp');
        await this.db.transaction(ctx, (tx) =>
            tx.insert(company).values({ id, tenant: tenant ?? '', name: body.name }),
        );
        void reply.header('Location', `/companies/${id}`);

        return { id, name: body.name };
    }
}
