const PREFIX = '[FFM]';

export function debugLog(scope, message, data) {
  if (data !== undefined) {
    console.log(`${PREFIX} ${scope}: ${message}`, data);
    return;
  }

  console.log(`${PREFIX} ${scope}: ${message}`);
}

export function debugWarn(scope, message, data) {
  if (data !== undefined) {
    console.warn(`${PREFIX} ${scope}: ${message}`, data);
    return;
  }

  console.warn(`${PREFIX} ${scope}: ${message}`);
}

export function debugError(scope, message, data) {
  if (data !== undefined) {
    console.error(`${PREFIX} ${scope}: ${message}`, data);
    return;
  }

  console.error(`${PREFIX} ${scope}: ${message}`);
}
