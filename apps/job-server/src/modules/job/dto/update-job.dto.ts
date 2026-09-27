import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { JobStatus, USER_SETTABLE_JOB_STATUSES } from '@app/utils';

import {
  DESCRIPTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  trim,
} from './create-job.dto';

/**
 * 필드 생략(undefined)만 허용하고 null 은 검증 대상으로 둔다.
 * `@IsOptional()` 은 null 도 검증을 건너뛰어, `{ "title": null }` 이 그대로 저장되는 문제가 있었다.
 */
const IsOmittable = () => ValidateIf((_, value) => value !== undefined);

/**
 * PATCH 가능 필드: title, description, status
 * - id / attempts / version / 타임스탬프 등은 whitelist 로 거부된다 (400)
 * - status 는 pending(재시도) / canceled(취소) 만 지정 가능
 * - 필드를 생략할 수는 있지만 null 로 보낼 수는 없다 (400)
 */
export class UpdateJobDto {
  @IsOmittable()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(TITLE_MAX_LENGTH)
  title?: string;

  @IsOmittable()
  @Transform(trim)
  @IsString()
  @MaxLength(DESCRIPTION_MAX_LENGTH)
  description?: string;

  @IsOmittable()
  @IsIn(USER_SETTABLE_JOB_STATUSES, {
    message: `status 는 ${USER_SETTABLE_JOB_STATUSES.join(', ')} 중 하나여야 합니다.`,
  })
  status?: JobStatus;
}
