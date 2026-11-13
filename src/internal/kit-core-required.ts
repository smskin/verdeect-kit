// Обязательное ядро пакета (prd.md §3.2 v1.25, AC-2.15): модули /database, /messaging, /redis, /idempotency и лимитер
// внедряют HealthRegistry и KIT_METRICS из KitCoreModule. Инъекция optional на уровне DI — чтобы вместо общей ошибки Nest
// «can't resolve dependencies» дать текст PRD; без ядра — Error при сборке контекста.

/**
 * Значение из ядра пакета или ошибка сборки с текстом PRD.
 * @throws {Error} ядра нет — модуль собран без `KitCoreModule.forRoot`, `bootstrapService` и `createHttpApp`.
 */
export function requireKitCore<T>(value: T | null | undefined, owner: string): T {
    if (value === null || value === undefined) {
        throw new Error(
            `${owner}: нет ядра пакета — подключите KitCoreModule.forRoot или запускайте через bootstrapService/createHttpApp`,
        );
    }

    return value;
}
