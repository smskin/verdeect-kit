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
    `config:${await probe('@verdeect/kit/config', 'defineEnv')} http:${await probe('@verdeect/kit/http', 'createHttpApp')} observability:${await probe('@verdeect/kit/observability', 'createLoggerOptions')} testing:${await probe('@verdeect/kit/testing', 'startTestStack')}`,
);
