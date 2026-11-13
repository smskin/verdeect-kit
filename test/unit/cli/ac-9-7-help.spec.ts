// AC-9.7 (U; prd.md §3.8 v1.26, KT-76 п. 3): справка verdeect-kit — --help, help и без аргументов: каждая команда и
// каждая форма в stdout, код 0; <команда> --help — формы команды; неизвестная команда — UNKNOWN_COMMAND JSON в stdout,
// список команд и форм в stderr, код 1. Логика — runCli (src/cli/run.ts), main.ts только вызывает его.
import { describe, expect, it } from 'vitest';
import { runCli } from '../../../src/cli/run.js';

const FORMS: Readonly<Record<string, readonly string[]>> = {
    openapi: ['openapi --out <f> [--module <f>#<export>]'],
    db: [
        'db prepare --service <svc>',
        'db migrate --folder <p> --schema <svc>',
        'db move-journal --from <s> --to <svc>',
    ],
    rabbitmq: [
        'rabbitmq definitions --services <svc,…> [--publishes <svc>=<prefix>,…] [--admin <user>] [--out <f>]',
    ],
    crypto: ['crypto generate-secret [--bytes N]'],
    redis: ['redis acl --services <svc,…> --out <f>'],
};

async function run(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    let stdout = '';
    let stderr = '';
    const code = await runCli(argv, {
        stdout: (text) => {
            stdout += text;
        },
        stderr: (text) => {
            stderr += text;
        },
    });

    return { code, stdout, stderr };
}

describe('UC-1: справка verdeect-kit', () => {
    it.each([[['--help']], [['help']], [[]]])(
        'AC-9.7: %j — код 0, в stdout каждая команда и каждая форма из таблицы CLI README (строка на форму)',
        async (argv) => {
            const { code, stdout } = await run(argv);
            const lines = stdout.split('\n').map((line) => line.trim());

            expect(code).toBe(0);
            for (const form of Object.values(FORMS).flat()) {
                expect(
                    lines.some((line) => line.endsWith(form)),
                    form,
                ).toBe(true);
            }
        },
    );

    it('AC-9.7: --help — строка формы rabbitmq definitions целиком, с префиксом verdeect-kit', async () => {
        const { stdout } = await run(['--help']);

        expect(stdout.split('\n')).toContain(
            '  verdeect-kit rabbitmq definitions --services <svc,…> [--publishes <svc>=<prefix>,…] [--admin <user>] [--out <f>]',
        );
        expect(stdout.split('\n')).toContain(
            '  verdeect-kit db migrate --folder <p> --schema <svc>',
        );
    });

    it.each(Object.keys(FORMS))('AC-9.7: %s --help — формы команды, код 0', async (command) => {
        const { code, stdout } = await run([command, '--help']);
        const lines = stdout.split('\n').map((line) => line.trim());

        expect(code).toBe(0);
        for (const form of FORMS[command] ?? []) {
            expect(
                lines.some((line) => line.endsWith(form)),
                form,
            ).toBe(true);
        }
        for (const [other, forms] of Object.entries(FORMS)) {
            if (other !== command) {
                expect(stdout).not.toContain(forms[0]);
            }
        }
    });

    it('AC-9.7: неизвестная команда — UNKNOWN_COMMAND JSON в stdout, список команд и форм в stderr, код 1', async () => {
        const { code, stdout, stderr } = await run(['nope']);

        expect(code).toBe(1);
        expect(JSON.parse(stdout)).toMatchObject({ error: { code: 'UNKNOWN_COMMAND' } });
        for (const form of Object.values(FORMS).flat()) {
            expect(stderr).toContain(form);
        }
    });
});
