import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@app/utils';

/**
 * 도메인 예외. 필터에서 `error` 코드와 `details` 를 그대로 응답에 싣는다.
 */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message, status);
  }

  static notFound(code: ErrorCode, message: string, details?: unknown) {
    return new AppException(HttpStatus.NOT_FOUND, code, message, details);
  }

  static badRequest(code: ErrorCode, message: string, details?: unknown) {
    return new AppException(HttpStatus.BAD_REQUEST, code, message, details);
  }

  static conflict(code: ErrorCode, message: string, details?: unknown) {
    return new AppException(HttpStatus.CONFLICT, code, message, details);
  }

  static preconditionFailed(message: string, details?: unknown) {
    return new AppException(
      HttpStatus.PRECONDITION_FAILED,
      ErrorCode.PRECONDITION_FAILED,
      message,
      details,
    );
  }
}
