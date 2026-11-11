// globalSetup уровня I (prd.md §3.8, AC-1.13, AC-4.18): PostgreSQL TEST_IMAGES.postgres раз на прогон через собственный
// startTestStack; БД kit подготовлена prepareDatabase и мигрирована фикстурой (шаблон kit_template для createScratchDatabase).
import { startTestStack } from '../../src/testing/start-test-stack.js';

export default startTestStack({
    service: 'kit',
    postgres: true,
    migrations: 'test/fixtures/database/migrations',
});
