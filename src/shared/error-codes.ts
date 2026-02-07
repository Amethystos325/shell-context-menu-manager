export const ERROR_CODES = {
  VALIDATION: "E_VALIDATION",
  PERMISSION: "E_PERMISSION",
  READ_FAIL: "E_READ_FAIL",
  WRITE_FAIL: "E_WRITE_FAIL",
  IPC_BAD_REQUEST: "E_IPC_BAD_REQUEST",
  UNKNOWN: "E_UNKNOWN",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: string;

  constructor(code: ErrorCode, message: string, details?: string) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "AppError";
  }
}
