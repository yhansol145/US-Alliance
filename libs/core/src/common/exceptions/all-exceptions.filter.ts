import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorCode } from '@app/utils';

import { FileLogService } from '../../log/file-log.service';
import { REQUEST_ID_HEADER } from '../../log/request-logging.middleware';
import { ErrorResponse } from '../response/response.interface';
import { AppException } from './app.exception';

const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.METHOD_NOT_ALLOWED]: ErrorCode.METHOD_NOT_ALLOWED,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.PRECONDITION_FAILED]: ErrorCode.PRECONDITION_FAILED,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PAYLOAD_TOO_LARGE,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
};

/**
 * 모든 예외를 동일한 에러 응답 포맷으로 변환한다.
 *
 * { statusCode, error, message, details?, path, timestamp, requestId }
 *
 * - 5xx 는 내부 정보(stack 등)를 응답에 노출하지 않고 logs.txt 에만 남긴다.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: FileLogService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, error, message, details } = this.resolve(exception);

    if (statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} 처리 중 예외 발생`,
        AllExceptionsFilter.name,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorResponse = {
      statusCode,
      error,
      message,
      ...(details !== undefined && { details }),
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
      requestId: request.header(REQUEST_ID_HEADER),
    };

    response.status(statusCode).json(body);
  }

  private resolve(exception: unknown) {
    if (exception instanceof AppException) {
      return {
        statusCode: exception.getStatus(),
        error: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const res = exception.getResponse();
      const raw =
        typeof res === 'object' && res !== null && 'message' in res
          ? (res as { message: string | string[] }).message
          : exception.message;
      return {
        statusCode,
        error:
          STATUS_TO_CODE[statusCode] ??
          (statusCode >= 500
            ? ErrorCode.INTERNAL_SERVER_ERROR
            : ErrorCode.BAD_REQUEST),
        message: Array.isArray(raw) ? raw.join(', ') : raw,
        details: undefined,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: ErrorCode.INTERNAL_SERVER_ERROR,
      message: '서버 내부 오류가 발생했습니다.',
      details: undefined,
    };
  }
}
