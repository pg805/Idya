'use strict';

import { createLogger, format, transports } from 'winston';
// talk to iggy about this import statement
// import { getBotSettings } from '../editSettings';

// logger formating
// eslint-disable-next-line max-len
const loggerFormat = format.printf((log) => `[${log.timestamp} : ${log.level}] - ${log.message}`);
const terminal = terminalConsole();

if (!terminal) {
    throw new Error('Terminal Error');
}

// create logger
const logger = createLogger({
    level: 'info',
    format: format.combine(
        format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss',
        }),
        format.errors({ stack: true }),
        format.splat(),
        loggerFormat,
    ),
    defaultMeta: { service: 'Idya' },
    transports: [
        // Write to all logs with level `info` and below to ida-combined.log`.
        // Write all logs error (and below) to `idya-error.log`.
        new transports.File({
            filename: './data/logs/idya-error.log',
            level: 'error'
        }),
        new transports.File({
            filename: './data/logs/idya-combined.log'
        }),
        terminal
    ],
});

/**
 * allows the bot to send messages to a console
 * @return {Console} console object to send logging statements to
 */
function terminalConsole() {
    if (process.env.NODE_ENV !== 'production') {
        return new transports.Console({
            format: format.combine(
                format.colorize(),
                loggerFormat,
            ),
            level: getBotSettings().debug ? 'debug' : 'info'
        });
    }
}

export default logger;
