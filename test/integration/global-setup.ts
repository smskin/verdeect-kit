// globalSetup уровня I (prd.md §3.8, AC-1.13): PostgreSQL TEST_IMAGES.postgres раз на прогон через собственный startTestStack.
import { startTestStack } from '../../src/testing/start-test-stack.js';

export default startTestStack({ service: 'kit', postgres: true });
