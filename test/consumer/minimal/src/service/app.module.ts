// Корневой модуль сервиса-потребителя (AC-9.1, AC-3.8): KitConfigModule с той же схемой, что в main.ts, маршрут с @Api,
// критичная проба /health database (TCP) через внедрённый HealthRegistry.
import { connect } from 'node:net';
import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KitConfigModule } from '@verdeect/kit/config';
import { HealthRegistry } from '@verdeect/kit/observability';
import { serviceEnvSchema } from './env.js';
import { ItemsController } from './items.controller.js';

/** TCP-проба PostgreSQL. */
function tcpProbe(url: string): () => Promise<boolean> {
    const { hostname, port } = new URL(url);

    return () =>
        new Promise((resolve) => {
            const socket = connect({ host: hostname, port: Number(port) });
            socket.setTimeout(1000);
            socket.once('connect', () => {
                socket.end();
                resolve(true);
            });
            socket.once('timeout', () => {
                socket.destroy();
                resolve(false);
            });
            socket.once('error', () => resolve(false));
        });
}

@Injectable()
export class DatabaseProbe implements OnModuleInit {
    constructor(
        private readonly health: HealthRegistry,
        private readonly config: ConfigService,
    ) {}

    onModuleInit(): void {
        this.health.register('database', tcpProbe(this.config.getOrThrow<string>('DATABASE_URL')), {
            critical: true,
        });
    }
}

@Module({
    imports: [KitConfigModule.forRoot({ schema: serviceEnvSchema })],
    controllers: [ItemsController],
    providers: [DatabaseProbe],
})
export class AppModule {}
