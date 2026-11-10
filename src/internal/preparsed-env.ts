// Окружение, разобранное bootstrapService до создания приложения (prd.md §3.1, §3.5, AC-3.13). KitConfigModule забирает
// его при сборке контекста и не разбирает повторно. Ключ — объект схемы: тот же env в bootstrapService({env}) и
// KitConfigModule.forRoot({schema}). Значение отдаётся одной сборке: следующая разбирает process.env сама (AC-1.7).

const preparsed = new WeakMap<object, Record<string, unknown>>();

/** Запоминает разобранное окружение схемы (пишет bootstrapService). */
export function setPreparsedEnv(schema: object, env: Record<string, unknown>): void {
    preparsed.set(schema, env);
}

/** Возвращает и удаляет разобранное окружение схемы; нет — `undefined`. */
export function takePreparsedEnv(schema: object): Record<string, unknown> | undefined {
    const env = preparsed.get(schema);
    preparsed.delete(schema);

    return env;
}
