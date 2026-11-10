// Настоящий Sentry.init с поддельным транспортом (prd.md AC-2.9, AC-2.10): конверты записываются, отправка — с
// задержкой delayMs или без ответа (GlitchTip недоступен). beforeSend — скраббер пакета, как у initSentry.
import * as Sentry from '@sentry/nestjs';
import { scrubEvent } from '../../src/observability/sentry.js';

/** DSN поддельного GlitchTip: сеть не используется, транспорт подменён. */
export const FAKE_DSN = 'https://public@example.invalid/1';

/** Режим транспорта: задержка ответа в мс или `hang` — ответа нет. */
export interface FakeTransportMode {
    delayMs: number | 'hang';
}

/** Доставленное событие: теги и текст конверта. */
export interface DeliveredEvent {
    readonly body: string;
    readonly tags: Record<string, string>;
    readonly at: number;
}

/** Инициализирует SDK с поддельным транспортом; возвращает режим (меняется в тестах) и доставленные события. */
export function initFakeSentry(): { mode: FakeTransportMode; delivered: DeliveredEvent[] } {
    const mode: FakeTransportMode = { delayMs: 0 };
    const delivered: DeliveredEvent[] = [];

    Sentry.init({
        dsn: FAKE_DSN,
        defaultIntegrations: false,
        integrations: [],
        tracesSampleRate: 0,
        beforeSend: (event, hint) => scrubEvent(event, hint.originalException),
        transport: () =>
            Sentry.createTransport({ recordDroppedEvent: () => undefined }, async (request) => {
                if (mode.delayMs === 'hang') {
                    return new Promise(() => undefined);
                }
                await new Promise((resolve) => setTimeout(resolve, mode.delayMs as number));
                const body = String(request.body);
                delivered.push({ body, tags: tagsOf(body), at: performance.now() });

                return { statusCode: 200 };
            }),
    });

    return { mode, delivered };
}

/** Теги события из конверта (строки JSON через перевод строки). */
function tagsOf(body: string): Record<string, string> {
    for (const line of body.split('\n')) {
        try {
            const item = JSON.parse(line) as { tags?: Record<string, string> };
            if (item.tags !== undefined) {
                return item.tags;
            }
        } catch {
            // не JSON — пропускаем
        }
    }

    return {};
}
