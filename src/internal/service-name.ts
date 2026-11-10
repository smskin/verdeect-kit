// Имя сервиса = имя экземпляра (prd.md §3.4, §3.5, §3.6; CE-3). Одна проверка для startTestStack, bootstrapService,
// createCipher и модулей.

/** Формат имени сервиса. */
export const SERVICE_NAME_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

/** Бросает TypeError, если имя вне формата; значение в сообщение попадает (это не секрет). */
export function assertServiceName(service: string, where: string): void {
    if (!SERVICE_NAME_PATTERN.test(service)) {
        throw new TypeError(
            `${where}: имя сервиса «${service}» вне формата ^[a-z][a-z0-9-]{1,31}$`,
        );
    }
}
