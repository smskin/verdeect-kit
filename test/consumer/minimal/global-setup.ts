// globalSetup потребителя (AC-9.1): PostgreSQL из TEST_IMAGES через startTestStack пакета.
import { startTestStack } from '@verdeect/kit/testing';

export default startTestStack({ service: 'consumer', postgres: true });
