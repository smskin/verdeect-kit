// AC-2.12 (U, UC-4): quietRoutes — успешный запрос на debug, ошибочный и 5xx — как обычно; maskPath — к пути в логе
// доступа (prd.md §3.2). §3.2: entry cli — поток stderr, журнала доступа нет. Эталоны: P accessLogLevel
// (QUIET_ACCESS_PREFIX /v1/authz/), O accessLogLevel (/internal/v1/llm/), O mask-path.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLoggerOptions } from '../../../src/observability/index.js';
import { accessLines, collector, LOGGER_ENV, startPinoHttpApp, withStream } from './support.js';

const output = collector();
let app: FastifyInstance;

beforeAll(async () => {
    app = await startPinoHttpApp(
        withStream(
            createLoggerOptions({
                service: 'kit-test',
                entry: 'http',
                env: LOGGER_ENV,
                quietRoutes: ['/v1/authz/'],
                redaction: { maskPath: (path) => path.replace(/^\/share\/[^/]+/, '/share/***') },
            }),
            output.stream,
        ),
    );
});

afterAll(async () => {
    await app.close();
});

beforeEach(() => {
    output.clear();
});

async function levelOf(url: string): Promise<unknown> {
    await app.inject({ method: 'GET', url });
    const [line] = accessLines(output.records());

    return line?.level;
}

describe('UC-4: уровень строки доступа', () => {
    it('AC-2.12: quietRoutes — успешный запрос на debug, ошибочный и 5xx — на info', async () => {
        expect(await levelOf('/v1/authz/check?x=1')).toBe(20);
        output.clear();
        expect(await levelOf('/v1/authz/fail')).toBe(30);
        output.clear();
        expect(await levelOf('/v1/authz/bad')).toBe(30);
        output.clear();
        expect(await levelOf('/v1/other')).toBe(30);
    });

    it('AC-2.12: maskPath применяется к пути в логе доступа', async () => {
        await app.inject({ method: 'GET', url: '/share/MARK_SHARE_TOKEN/view?x=1' });

        const [line] = accessLines(output.records());
        expect(line).toMatchObject({ req: { url: '/share/***/view' } });
        expect(output.text()).not.toContain('MARK_SHARE_TOKEN');
    });
});

describe('§3.2: точка входа cli', () => {
    it('§3.2: entry cli — поток stderr, autoLogging выключен', () => {
        const params = createLoggerOptions({ service: 'kit-test', entry: 'cli', env: LOGGER_ENV });

        const [options, stream] = params.pinoHttp;
        expect(stream).toBe(process.stderr);
        expect(options.autoLogging).toBe(false);
        expect(options.base).toMatchObject({ entry: 'cli' });
    });

    it('§3.2: entry http — поток stdout', () => {
        const params = createLoggerOptions({ service: 'kit-test', entry: 'http', env: LOGGER_ENV });

        expect(params.pinoHttp[1]).toBe(process.stdout);
    });
});
