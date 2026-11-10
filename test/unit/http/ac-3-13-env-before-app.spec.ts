// AC-3.13 (UC-3): окружение разбирается до создания приложения — неверное → failStartup, модуль не инициализирован, порт
// не открыт; верное — parseEnv ровно один раз, KitConfigModule берёт разобранное (prd.md §3.5, §3.1). §3.5 (KT-15 п. 2):
// модуль без KitConfigModule → failStartup. §3.2 (KT-15 п. 1): SIGTERM слушает только KitLifecycle.listen().
import 'reflect-metadata';
import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { defineEnv, envBase, KitConfigModule } from '../../../src/config/index.js';
import { bootstrapService } from '../../../src/http/index.js';
import { expectExit, useBootstrapStand } from './bootstrap-support.js';
import { NoConfigModule, probeEnv } from './support.js';

const stand = useBootstrapStand();

let parses = 0;
let initialized = 0;

const countingEnv = defineEnv({ ...envBase }, () => {
    parses += 1;
});

@Injectable()
class InitProbe implements OnModuleInit {
    onModuleInit(): void {
        initialized += 1;
    }
}

@Module({ imports: [KitConfigModule.forRoot({ schema: countingEnv })], providers: [InitProbe] })
class CountingModule {}

describe('UC-3: окружение до приложения', () => {
    it('AC-3.13: неверное окружение → fatal INVALID_ENVIRONMENT, exit 1, onModuleInit не вызван, порт не открыт', async () => {
        process.env.PORT = 'не-порт';
        initialized = 0;

        const exit = await expectExit(
            bootstrapService({ module: CountingModule, service: 'probe', env: countingEnv }),
        );
        const fatal = stand.records().find((record) => record.level === 60);

        expect(exit.code).toBe(1);
        expect(fatal).toMatchObject({ code: 'INVALID_ENVIRONMENT', keys: ['PORT'] });
        expect(stand.text()).not.toContain('не-порт');
        expect(initialized).toBe(0);
        expect(stand.records().some((record) => record.msg === 'сервис слушает')).toBe(false);
    });

    it('AC-3.13: при верном окружении parseEnv вызван один раз', async () => {
        parses = 0;
        stand.track(
            await bootstrapService({ module: CountingModule, service: 'probe', env: countingEnv }),
        );

        expect(parses).toBe(1);
        expect(initialized).toBeGreaterThan(0);
    });

    it('§3.5: модуль без KitConfigModule.forRoot → fatal через failStartup, текст называет KitConfigModule.forRoot, exit 1', async () => {
        const exit = await expectExit(
            bootstrapService({ module: NoConfigModule, service: 'probe', env: probeEnv }),
        );
        const fatal = stand.records().find((record) => record.level === 60);

        expect(exit.code).toBe(1);
        expect(JSON.stringify(fatal)).toContain('KitConfigModule.forRoot');
    });

    it('§3.2: после bootstrapService SIGTERM слушает ровно один новый обработчик (KitLifecycle.listen), enableShutdownHooks не вызван', async () => {
        const before = process.listenerCount('SIGTERM');
        stand.track(
            await bootstrapService({ module: CountingModule, service: 'probe', env: countingEnv }),
        );

        expect(process.listenerCount('SIGTERM')).toBe(before + 1);
    });
});
