// Манифест пакета (prd.md v1.7: G1, G3, NFR-1, NFR-3, NFR-4, AC-1.1 — форма exports E1–E3, bin E3; §3.2 — files: alerts).
// Образец — verdeect-platform-client test/unit/package-manifest.spec.ts.
import { readFileSync } from 'node:fs';
import semver from 'semver';
import { describe, expect, it } from 'vitest';

interface Manifest {
    readonly type: string;
    readonly packageManager: string;
    readonly engines: Record<string, string>;
    readonly exports: Record<string, unknown>;
    readonly files: readonly string[];
    readonly bin?: unknown;
    readonly main?: unknown;
    readonly dependencies: Record<string, string>;
    readonly peerDependencies: Record<string, string>;
    readonly peerDependenciesMeta: Record<string, { readonly optional?: boolean }>;
    readonly devDependencies: Record<string, string>;
}

const manifest = JSON.parse(
    readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as Manifest;

const REQUIRED_PEERS: Record<string, string> = {
    '@nestjs/common': '^12.1.0',
    '@nestjs/core': '^12.1.0',
    '@nestjs/config': '^12.0.0',
    '@nestjs/platform-fastify': '^12.1.0',
    fastify: '^5.12.0',
    'reflect-metadata': '^0.2.0',
    rxjs: '^7.8.0',
    zod: '^4.6.0',
    'drizzle-orm': '^0.45.4',
    'nestjs-pino': '^5.3.0',
    pino: '^10.4.0',
    '@prometheus-io/client': '^0.16.1',
    '@sentry/nestjs': '^11.7.0',
    '@verdeect/auth': '^1.0.0',
};

const OPTIONAL_PEERS: Record<string, string> = {
    pg: '^8.23.0',
    ioredis: '^6.0.0',
    amqplib: '^2.2.0',
    'amqp-connection-manager': '^5.0.0',
    testcontainers: '^12.2.0',
    vitest: '^5.0.0',
    '@nestjs/testing': '^12.1.0',
};

describe('AC-1.1: точки входа пакета (E1–E3)', () => {
    it('AC-1.1: exports — ровно ./config, ./http, ./observability, ./testing, ./package.json', () => {
        expect(Object.keys(manifest.exports).sort()).toEqual(
            ['./config', './http', './observability', './package.json', './testing'].sort(),
        );
    });

    it('AC-1.1: ./http — {types, default} на dist/http/index.*', () => {
        expect(manifest.exports['./http']).toEqual({
            types: './dist/http/index.d.ts',
            default: './dist/http/index.js',
        });
    });

    it('AC-1.1: ./config — {types, default} на dist/config/index.*', () => {
        expect(manifest.exports['./config']).toEqual({
            types: './dist/config/index.d.ts',
            default: './dist/config/index.js',
        });
    });

    it('AC-1.1: ./observability — {types, default} на dist/observability/index.*', () => {
        expect(manifest.exports['./observability']).toEqual({
            types: './dist/observability/index.d.ts',
            default: './dist/observability/index.js',
        });
    });

    it('§3.2: files содержит alerts (шаблон alerts/verdeect-kit.rules.yml)', () => {
        expect(manifest.files).toContain('alerts');
    });

    it("AC-1.1: ./testing — ключи ровно ['types', 'development'], без default (NFR-4)", () => {
        const testing = manifest.exports['./testing'] as Record<string, string>;
        expect(Object.keys(testing)).toEqual(['types', 'development']);
        expect(testing).toEqual({
            types: './dist/testing/index.d.ts',
            development: './dist/testing/index.js',
        });
    });

    it('AC-1.1: bin — ровно {verdeect-kit: ./dist/cli/main.js}, нет main и корневого "."', () => {
        expect(manifest.bin).toEqual({ 'verdeect-kit': './dist/cli/main.js' });
        expect(manifest.main).toBeUndefined();
        expect(manifest.exports['.']).toBeUndefined();
    });
});

describe('NFR-3: зависимости', () => {
    it('NFR-3: обязательные peer — ровно список PRD v1.7, не optional', () => {
        const required = Object.fromEntries(
            Object.entries(manifest.peerDependencies).filter(
                ([name]) => manifest.peerDependenciesMeta[name]?.optional !== true,
            ),
        );
        expect(required).toEqual(REQUIRED_PEERS);
    });

    it('NFR-3: опциональные peer — pg, ioredis, amqplib, amqp-connection-manager, testcontainers, vitest, @nestjs/testing, у всех optional: true', () => {
        const optional = Object.fromEntries(
            Object.entries(manifest.peerDependencies).filter(
                ([name]) => manifest.peerDependenciesMeta[name]?.optional === true,
            ),
        );
        expect(optional).toEqual(OPTIONAL_PEERS);
        expect(Object.keys(manifest.peerDependenciesMeta).sort()).toEqual(
            Object.keys(OPTIONAL_PEERS).sort(),
        );
    });

    it('NFR-3: peer не дублируются в dependencies; dependencies — только ajv, semver, shell-quote и yaml, точные версии', () => {
        expect(manifest.dependencies).toEqual({
            ajv: '8.20.0',
            semver: '7.8.6',
            'shell-quote': '1.12.0',
            yaml: '2.9.1',
        });
        for (const name of Object.keys(manifest.peerDependencies)) {
            expect(manifest.dependencies[name], name).toBeUndefined();
        }
    });

    it('NFR-3: devDependencies — точные версии', () => {
        for (const [name, version] of Object.entries(manifest.devDependencies)) {
            expect(semver.valid(version), name).not.toBeNull();
        }
    });
});

describe('NFR-1: среда выполнения', () => {
    it('NFR-1: ESM, engines.node >=22.12, packageManager pnpm', () => {
        expect(manifest.type).toBe('module');
        expect(manifest.engines.node).toBe('>=22.12');
        expect(manifest.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
    });
});
