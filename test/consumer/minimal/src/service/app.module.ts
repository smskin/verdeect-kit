// Корневой модуль сервиса-потребителя (AC-9.1, AC-3.8): KitConfigModule с той же схемой, что в main.ts, маршруты с @Api,
// KitDatabaseModule (пробы database и database-read) и KitIdempotencyModule (очистка, AC-9.5), VerdeectAuthModule.
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VerdeectAuthModule } from '@verdeect/auth/nest';
import { KitConfigModule } from '@verdeect/kit/config';
import { KitDatabaseModule } from '@verdeect/kit/database';
import { KitIdempotencyModule } from '@verdeect/kit/idempotency';
import { CompaniesController } from './companies.controller.js';
import { serviceEnvSchema } from './env.js';
import { ItemsController } from './items.controller.js';
import * as schema from './schema.js';

@Module({
    imports: [
        KitConfigModule.forRoot({ schema: serviceEnvSchema }),
        KitDatabaseModule.forRoot({ schema }),
        KitIdempotencyModule.forRoot({ table: schema.idempotency }),
        VerdeectAuthModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                issuers: [
                    {
                        iss: config.getOrThrow<string>('AUTH_ISSUER'),
                        jwksUri: config.getOrThrow<string>('AUTH_JWKS_URI'),
                    },
                ],
                resource: config.getOrThrow<string>('AUTH_RESOURCE'),
            }),
        }),
    ],
    controllers: [ItemsController, CompaniesController],
})
export class AppModule {}
