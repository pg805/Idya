'use strict';

// library dependencies
import logger from './util/logger.js';

// exit message
process.on('exit', (code) => {
    logger.info(`About to exit with code: ${code}`);
});

// promise error
process.on('unhandledRejection', (error) => logger.error(`Uncaught Promise Rejection: ${error}`));

// exit
process.on('SIGTERM', () =>
    process.exit(0),
);