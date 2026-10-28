// 英文错误码文案：客户端、HTTP 接口以及运行/操作/扫描问题中出现的稳定错误码。
export default {
  NETWORK_ERROR:
    'Unable to reach the server. Check your connection and try again.',
  INVALID_RESPONSE: 'The server returned an unexpected response.',
  HTTP_ERROR: 'The request could not be completed.',
  UNAUTHENTICATED: 'Your session has ended. Sign in to continue.',
  TOKEN_REVOKED: 'Your session was revoked. Sign in again.',
  PASSWORD_CHANGE_REQUIRED: 'Change your password before continuing.',
  INVALID_CREDENTIALS: 'Incorrect username or password.',
  LOGIN_RATE_LIMITED: 'Too many attempts. Wait a moment and try again.',
  VALIDATION_ERROR: 'Some values are invalid. Review the form and try again.',
  NOT_FOUND: 'This item no longer exists or has been archived.',
  PAYLOAD_TOO_LARGE: 'The request is too large.',
  INTERNAL_ERROR: 'The server ran into an unexpected error.',
  NOT_READY: 'The service is still starting. Try again shortly.',
  INVALID_STATE: 'This action isn’t available in the current state.',
  INVALID_PATH: 'This path is invalid.',
  INVALID_CRON: 'Use a five-field cron expression, such as 0 3 * * *.',
  JOB_BUSY:
    'This job has an active run. Wait for it to finish or cancel it first.',
  PATH_OVERLAP: 'Another active run is using overlapping paths.',
  QUEUE_FULL: 'The run queue is full. Try again once current runs finish.',
  QUEUE_TIMEOUT: 'The run waited too long in the queue.',
  RUN_TIMEOUT: 'The run exceeded its time limit.',
  USER_CANCEL: 'The run was cancelled.',
  PROCESS_RESTART: 'The service restarted while the run was active.',
  ENDPOINT_IN_USE:
    'This instance is still used by a job. Remove it from those jobs first.',
  AUTH_COOLDOWN:
    'OpenList is limiting sign-in attempts. Wait for the cooldown to end.',
  AUTH_BLOCKED:
    'Signing in to this instance is blocked. Update its credentials and test again.',
  ACCOUNT_CHANGED:
    'The OpenList account changed since the last test. Test the connection again.',
  MISSING_SECRET: 'No credentials are saved for this instance.',
  KEY_MISMATCH:
    'Saved credentials can’t be decrypted with the current encryption key.',
  OPENLIST_ERROR: "Couldn't communicate with the OpenList server.",
  OPENLIST_VERSION_UNSUPPORTED:
    'This OpenList version isn’t supported. Version 4.2.5 or later is required.',
  UPSTREAM_PROTOCOL_ERROR:
    'The OpenList server returned an unexpected response.',
  UPSTREAM_REDIRECT:
    'The OpenList server redirected the request. Check the base URL.',
  UPSTREAM_JSON_TOO_LARGE: 'The OpenList response was too large to process.',
  MULTIPART_DISABLED: 'Chunked uploads are disabled on this instance.',
  MOUNT_BOUNDARY_UNKNOWN: 'Storage mount boundaries couldn’t be determined.',
  SUSPECT_VIEW: 'The directory listing looks incomplete or unreliable.',
  SOURCE_ROOT_UNAVAILABLE: 'The source folder is unavailable.',
  TARGET_ROOT_UNAVAILABLE: 'The target folder is unavailable.',
  TARGET_ROOT_WILL_BE_CREATED:
    'The target folder doesn’t exist yet and will be created.',
  EMPTY_SOURCE: 'The source folder is empty.',
  SCAN_INCOMPLETE: 'Part of the folder couldn’t be scanned.',
  SCAN_DEPTH_EXCEEDED: 'The folder tree is deeper than the scan limit.',
  RESOURCE_LIMIT: 'A configured resource limit was reached.',
  NAME_COLLISION: 'Multiple entries resolve to the same name.',
  INVALID_NAME: 'The name contains characters that can’t be synchronized.',
  TYPE_CONFLICT: 'A file and a folder share the same path.',
  UNKNOWN_SIZE: 'The source file size is unknown.',
  TARGET_UNKNOWN_SIZE: 'The target file size is unknown.',
  SIZE_MISMATCH: 'The copied file size doesn’t match the source.',
  SOURCE_CHANGED: 'The source file changed during copying.',
  DELETE_BLOCKED: 'Deletions were blocked by safety checks.',
  DELETE_LIMIT: 'Deletions exceeded the configured limit.',
  DELETE_NOT_EFFECTIVE: 'The file still exists after deletion.',
  DEPENDENCY_FAILED: 'A step this operation depends on failed.',
  PREVIOUS_OUTCOME_UNKNOWN:
    'An older version skipped this path because an earlier outcome was unknown. Later runs plan independently.',
  PRECONDITION_UNVERIFIED:
    'The target state couldn’t be verified before writing.',
  PRECONDITION_CHANGED: 'The target changed after it was scanned.',
  PRECONDITION_ALREADY_ABSENT: 'The item was already gone.',
  OBSERVED_AFTER_ERROR:
    'The request reported an error, but the result was observed afterwards.',
  PLAN_INTERRUPTED: 'The plan was interrupted and is no longer valid.',
  PLAN_INVALID: 'The plan is invalid.',
  REMOTE_TASK_CHANGED: 'An older version recorded an OpenList task restarting.',
  SPOOL_FULL: 'Not enough local spool space to relay files.',
  SPOOL_IO_ERROR: 'A local spool disk error occurred.',
} as const;
