// stopBackgroundLoops (prd.md §3.8 стр. 191 v1.31, AC-5.12): остановка фоновых циклов пакета в тесте — relay outbox,
// очистка сообщений и идемпотентности, что есть в приложении. Классы грузятся динамически: /testing не импортирует
// /messaging и /idempotency статически (AC-1.2) и работает без peer pg/drizzle-orm.
import type { INestApplicationContext } from '@nestjs/common';
import type { Logger } from 'pino';
import { KIT_LOGGER } from '../internal/tokens.js';

/** Класс с внутренним `stopLoops()`. */
interface Stoppable {
    stopLoops(): Promise<void>;
}

type Loader = () => Promise<abstract new (...args: never[]) => Stoppable>;

const LOOPS: readonly (readonly [string, Loader])[] = [
    ['outbox-relay', async () => (await import('../messaging/outbox-relay.js')).OutboxRelay],
    ['messaging-cleanup', async () => (await import('../messaging/cleanup.js')).MessagingCleanup],
    [
        'idempotency-cleanup',
        async () => (await import('../idempotency/kit-idempotency.module.js')).IdempotencyCleanup,
    ],
];

/** Экземпляр класса в приложении или `null` (модуль не загрузился без peer или класса нет в приложении). */
async function instanceOf(app: INestApplicationContext, load: Loader): Promise<Stoppable | null> {
    try {
        return app.get(await load(), { strict: false });
    } catch {
        return null;
    }
}

/**
 * Останавливает фоновые циклы приложения теста (§3.8): relay outbox, очистку outbox/inbox и идемпотентности. Текущий
 * проход дорабатывает (ожидание без срока), новые не начинаются; канал relay, подписчик и соединения не трогаются —
 * их закрывает `app.close()`. Повтор — без действия, возобновления нет.
 */
export async function stopBackgroundLoops(app: INestApplicationContext): Promise<void> {
    const found = await Promise.all(
        LOOPS.map(async ([name, load]) => [name, await instanceOf(app, load)] as const),
    );
    const loops = found.filter(([, instance]) => instance !== null);
    await Promise.all(loops.map(([, instance]) => instance?.stopLoops()));
    loggerOf(app)?.debug(
        { loops: loops.map(([name]) => name) },
        'фоновые циклы остановлены (stopBackgroundLoops)',
    );
}

/** Логгер pino приложения; нет ядра — `null`. */
function loggerOf(app: INestApplicationContext): Logger | null {
    try {
        return app.get<Logger>(KIT_LOGGER, { strict: false });
    } catch {
        return null;
    }
}
