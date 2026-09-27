import { AppException, Job } from '@app/core';
import { ErrorCode } from '@app/utils';

export const toETag = (job: Job) => `"${job.version}"`;

/**
 * If-Match 헤더를 기대 버전으로 변환한다.
 * - 헤더 없음 / `*` → undefined (버전 검사 안 함)
 * - `"3"` 또는 `W/"3"` → 3
 */
export const parseIfMatch = (header?: string): number | undefined => {
  if (header === undefined || header.trim() === '*') {
    return undefined;
  }
  const match = /^(?:W\/)?"(\d+)"$/.exec(header.trim());
  if (!match) {
    throw AppException.badRequest(
      ErrorCode.VALIDATION_FAILED,
      'If-Match 헤더 형식이 올바르지 않습니다. 예: If-Match: "3"',
      [
        {
          field: 'If-Match',
          messages: ['ETag 형식("<version>")이어야 합니다.'],
        },
      ],
    );
  }
  return Number(match[1]);
};
