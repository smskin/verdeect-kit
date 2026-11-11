// AC-1.1: разрешение подпутей у потребителя; /testing — только с условием development (NFR-4).
async function probe(specifier, name) {
    try {
        const module = await import(specifier);
        return typeof module[name] === 'function' ? 'ok' : 'no-export';
    } catch (error) {
        return error?.code ?? String(error);
    }
}

console.log(
    `config:${await probe('@verdeect/kit/config', 'defineEnv')} crypto:${await probe('@verdeect/kit/crypto', 'createCipher')} database:${await probe('@verdeect/kit/database', 'newId')} http:${await probe('@verdeect/kit/http', 'createHttpApp')} idempotency:${await probe('@verdeect/kit/idempotency', 'Idempotent')} messaging:${await probe('@verdeect/kit/messaging', 'defineEvent')} observability:${await probe('@verdeect/kit/observability', 'createLoggerOptions')} redis:${await probe('@verdeect/kit/redis', 'KitRedisModule')} testing:${await probe('@verdeect/kit/testing', 'startTestStack')}`,
);
