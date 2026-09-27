import { ValidationError } from '@nestjs/common';
import { ErrorCode } from '@app/utils';

import { AppException } from './app.exception';

export interface ValidationErrorDetail {
  field: string;
  messages: string[];
}

const flatten = (
  errors: ValidationError[],
  parent = '',
): ValidationErrorDetail[] =>
  errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = error.constraints
      ? [{ field, messages: Object.values(error.constraints) }]
      : [];
    return [...own, ...flatten(error.children ?? [], field)];
  });

/**
 * ValidationPipe 의 기본 에러(message 배열)를 필드 단위 details 로 변환한다.
 */
export const validationExceptionFactory = (errors: ValidationError[]) =>
  AppException.badRequest(
    ErrorCode.VALIDATION_FAILED,
    '요청 값이 올바르지 않습니다.',
    flatten(errors),
  );
