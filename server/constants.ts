// Shared defaults. Define each value once here so the CLI options, the help
// text, and the server fallbacks cannot drift apart.

/** Which conversation source to read when --source is not given. */
export const DEFAULT_SOURCE = 'auto';

/** Interface the server binds to when --host is not given (localhost only). */
export const DEFAULT_HOST = '127.0.0.1';
