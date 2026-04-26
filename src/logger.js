const DEBUG_ENABLED = String(process.env.DEBUG_LOGS || '').toLowerCase() === 'true';

function ts() {
  return new Date().toISOString();
}

function write(level, scope, ...parts) {
  const prefix = `[${ts()}] [${level}] [${scope}]`;
  console.log(prefix, ...parts);
}

function info(scope, ...parts) {
  write('INFO', scope, ...parts);
}

function warn(scope, ...parts) {
  write('WARN', scope, ...parts);
}

function error(scope, ...parts) {
  write('ERROR', scope, ...parts);
}

function debug(scope, ...parts) {
  if (!DEBUG_ENABLED) return;
  write('DEBUG', scope, ...parts);
}

module.exports = { info, warn, error, debug, DEBUG_ENABLED };
