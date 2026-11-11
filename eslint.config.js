// Flat config пакета @verdeect/kit: стиль, TSDoc публичного API, границы подпутей (.ai-factory/ARCHITECTURE.md)
// и правила AC-9.4 (no-console — NFR-8; pgSchema с литералом и имена <svc>.<имя> — NFR-2). Образец — verdeect-platform-client.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Известные сервисы Вердикта (AC-9.4). Расширение списка — через PRD.
const SERVICES = 'identity|platform|orchestrator|bff|files|media';
const SERVICE_NAME_MESSAGE =
    'Имя вида <svc>.<имя> известного сервиса в коде пакета (NFR-2, AC-9.4)';
const PG_SCHEMA_MESSAGE =
    'pgSchema с литералом — привязка к схеме сервиса (NFR-2): имя схемы передаёт сервис';

// Общие запреты импорта для всего src/** (ARCHITECTURE.md «Правила зависимостей»).
const COMMON_PATTERNS = [
    {
        group: [
            'pg',
            'ioredis',
            'amqplib',
            'amqp-connection-manager',
            'testcontainers',
            'testcontainers/*',
            'vitest',
            'vitest/*',
            '@nestjs/testing',
        ],
        allowTypeImports: true,
        message:
            'Опциональный peer — только через loadPeer из src/internal/peer.ts, либо requirePeer + import() при вызове (src/database/pg.ts, src/messaging/peer.ts) (AC-1.2); import type разрешён',
    },
    {
        group: ['drizzle-orm/node-postgres'],
        allowTypeImports: true,
        message:
            'драйвер Drizzle тянет pg статически — только через loadDrizzle() из src/database/pg.ts (requirePeer + ленивый import(), AC-1.2)',
    },
    {
        group: ['@verdeect/kit', '@verdeect/kit/*'],
        allowTypeImports: true,
        message: 'Внутри src — только относительные импорты с .js',
    },
];

// ajv — внутренняя деталь expectMatchesApi: запрещён во всём src/** кроме src/testing/** (NFR-3, KT-15).
const AJV_PATTERN = {
    group: ['ajv', 'ajv/*'],
    message: 'ajv — только в src/testing (NFR-3, KT-15)',
};

/**
 * Одно правило no-restricted-imports на группу файлов: в flat config последний блок с тем же
 * правилом заменяет предыдущий, поэтому общие запреты и запреты подпути собираются вместе.
 */
function restrictedImports(extra = [], { allowAjv = false } = {}) {
    return {
        '@typescript-eslint/no-restricted-imports': [
            'error',
            { patterns: [...COMMON_PATTERNS, ...(allowAjv ? [] : [AJV_PATTERN]), ...extra] },
        ],
    };
}

export default [
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            'coverage/**',
            'requirements/**',
            '.ai-factory/**',
            '.claude/**',
            '.serena/**',
            // Проекты-потребители (AC-9.1): свои package.json и tsconfig, архив пакета в корне не разрешится.
            'test/consumer/**',
            // Тестовые данные AC-1.8 и AC-9.4 (в том числе намеренные нарушения).
            'test/fixtures/**',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.ts'],
        rules: {
            curly: ['error', 'all'],
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-non-null-assertion': 'error',
            '@typescript-eslint/consistent-type-imports': 'error',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        },
    },
    {
        // Без этих опций consistent-type-imports требует `import type` для классов-токенов DI Nest,
        // и метаданные декораторов теряют ссылку на класс.
        files: ['src/**/*.ts', 'test/**/*.ts', 'vitest*.config.ts'],
        languageOptions: {
            globals: globals.node,
            parserOptions: {
                emitDecoratorMetadata: true,
                experimentalDecorators: true,
            },
        },
    },
    {
        // TSDoc у каждого экспорта src/ и у публичных членов экспортируемых интерфейсов и классов.
        // Линтер не видит реэкспорт в index.ts, поэтому документируются и внутренние экспорты.
        files: ['src/**/*.ts'],
        plugins: { jsdoc },
        rules: {
            'jsdoc/require-jsdoc': [
                'error',
                {
                    publicOnly: true,
                    exemptEmptyConstructors: true,
                    require: {
                        FunctionDeclaration: true,
                        ClassDeclaration: true,
                        ArrowFunctionExpression: false,
                        MethodDefinition: false,
                    },
                    contexts: [
                        'TSInterfaceDeclaration',
                        'TSTypeAliasDeclaration',
                        // Только члены интерфейсов: поля литералов в приведениях и союзах документирует сам тип.
                        'TSInterfaceBody > TSPropertySignature',
                        'TSInterfaceBody > TSMethodSignature',
                        'ExportNamedDeclaration > VariableDeclaration',
                        'MethodDefinition:not([accessibility="private"]):not([kind="constructor"])',
                        'TSParameterProperty:not([accessibility="private"])',
                    ],
                },
            ],
        },
    },
    {
        // AC-9.4: логи только через pino (NFR-8), без привязки к схемам и таблицам сервисов (NFR-2).
        // Комментарии не разбираются как узлы; спецификаторы импорта и экспорта исключены.
        files: ['src/**/*.ts'],
        rules: {
            'no-console': 'error',
            'no-restricted-syntax': [
                'error',
                {
                    selector: "CallExpression[callee.name='pgSchema'][arguments.0.type='Literal']",
                    message: PG_SCHEMA_MESSAGE,
                },
                {
                    selector:
                        "CallExpression[callee.property.name='pgSchema'][arguments.0.type='Literal']",
                    message: PG_SCHEMA_MESSAGE,
                },
                {
                    selector: `Literal[value=/^(${SERVICES})\\.[a-z0-9_.-]+$/]:not(ImportDeclaration > Literal):not(ExportNamedDeclaration > Literal):not(ExportAllDeclaration > Literal):not(ImportExpression > Literal)`,
                    message: SERVICE_NAME_MESSAGE,
                },
                {
                    // `bff.${x}`: часть шаблона до подстановки кончается точкой — тоже имя сервиса.
                    selector: `TemplateElement[value.raw=/^(${SERVICES})\\.([a-z0-9_-]|$)/]`,
                    message: SERVICE_NAME_MESSAGE,
                },
            ],
        },
    },
    {
        files: ['src/**/*.ts'],
        rules: restrictedImports(),
    },
    {
        // internal зависит только от node:* и zod.
        files: ['src/internal/**/*.ts'],
        rules: restrictedImports([
            {
                group: ['@nestjs/*', '../config/*', '../testing/*', '../cli/*', 'shell-quote'],
                message: 'internal зависит только от node:* и zod (ARCHITECTURE.md).',
            },
        ]),
    },
    {
        files: ['src/config/**/*.ts'],
        rules: restrictedImports([
            {
                group: ['../testing/*', '../cli/*', 'shell-quote'],
                message:
                    'Рабочий код не импортирует testing и его зависимость shell-quote (ARCHITECTURE.md).',
            },
        ]),
    },
    {
        files: ['src/crypto/**/*.ts'],
        rules: restrictedImports([
            {
                group: [
                    '@nestjs/*',
                    '../config/index.js',
                    '../observability/*',
                    '../http/*',
                    '../database/*',
                    '../idempotency/*',
                    '../messaging/*',
                    '../redis/*',
                    '../testing/*',
                    '../cli/*',
                    'shell-quote',
                ],
                message:
                    'crypto импортирует только node:crypto, config/fragments и internal (ARCHITECTURE.md).',
            },
        ]),
    },
    {
        files: ['src/observability/**/*.ts'],
        rules: restrictedImports([
            {
                group: [
                    '../testing/*',
                    '../http/*',
                    '../database/*',
                    '../idempotency/*',
                    '../messaging/*',
                    '../redis/*',
                    '../crypto/*',
                    '../cli/*',
                    'shell-quote',
                ],
                message: 'observability импортирует только config и internal (ARCHITECTURE.md).',
            },
        ]),
    },
    {
        // http/ и http/api/: оба уровня вложенности.
        files: ['src/http/**/*.ts'],
        rules: restrictedImports([
            {
                group: [
                    '../testing/*',
                    '../../testing/*',
                    '../database/*',
                    '../../database/*',
                    '../idempotency/*',
                    '../../idempotency/*',
                    '../messaging/*',
                    '../../messaging/*',
                    '../redis/*',
                    '../../redis/*',
                    '../crypto/*',
                    '../../crypto/*',
                    '../cli/*',
                    '../../cli/*',
                    'shell-quote',
                ],
                message:
                    'http импортирует только observability, config и internal (ARCHITECTURE.md).',
            },
        ]),
    },
    {
        files: ['src/database/**/*.ts'],
        rules: restrictedImports([
            {
                group: [
                    '../testing/*',
                    '../http/*',
                    '../idempotency/*',
                    '../messaging/*',
                    '../redis/*',
                    '../crypto/*',
                    '../cli/*',
                    'shell-quote',
                ],
                message:
                    'database импортирует только observability, config и internal (ARCHITECTURE.md).',
            },
        ]),
    },
    {
        files: ['src/idempotency/**/*.ts'],
        rules: restrictedImports([
            {
                group: [
                    '../testing/*',
                    '../messaging/*',
                    '../redis/*',
                    '../crypto/*',
                    '../cli/*',
                    'shell-quote',
                ],
                message:
                    'idempotency импортирует database, http, observability, config, internal (ARCHITECTURE.md).',
            },
        ]),
    },
    {
        files: ['src/messaging/**/*.ts'],
        rules: restrictedImports([
            {
                group: [
                    '../testing/*',
                    '../http/*',
                    '../idempotency/*',
                    '../redis/*',
                    '../crypto/*',
                    '../cli/*',
                    'shell-quote',
                ],
                message:
                    'messaging импортирует только observability, config, internal (ARCHITECTURE.md).',
            },
            {
                group: ['../database/*'],
                allowTypeImports: true,
                message:
                    'значения database — только динамическим import() в KitMessagingModule.forRoot (pg — только при outbox или inbox, AC-1.2)',
            },
        ]),
    },
    {
        // CLI грузит подпути только динамическим import() (ARCHITECTURE.md «CLI»); import type разрешён.
        files: ['src/cli/**/*.ts'],
        rules: restrictedImports([
            {
                group: [
                    '**/http/*',
                    '**/config/*',
                    '**/observability/*',
                    '**/testing/*',
                    '**/internal/*',
                    '**/database/*',
                    '**/idempotency/*',
                    '**/messaging/*',
                    '**/redis/*',
                    '**/crypto/*',
                ],
                allowTypeImports: true,
                message:
                    'CLI загружает подпути только динамическим import() (ARCHITECTURE.md «CLI»).',
            },
        ]),
    },
    {
        // testing — единственный подпуть, которому разрешён ajv (expectMatchesApi).
        files: ['src/testing/**/*.ts'],
        rules: restrictedImports([], { allowAjv: true }),
    },
    {
        files: ['*.js', '*.mjs', 'scripts/**/*.mjs'],
        languageOptions: { globals: globals.node },
    },
    prettier,
];
