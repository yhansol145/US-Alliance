import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { JobStatus, USER_SETTABLE_JOB_STATUSES } from '@app/utils';

import {
  DESCRIPTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  trim,
} from './create-job.dto';

/**
 * PATCH 가능 필드: title, description, status
 * - id / attempts / version / 타임스탬프 등은 whitelist 로 거부된다 (400)
 * - status 는 pending(재시도) / canceled(취소) 만 지정 가능
 */
export class UpdateJobDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(TITLE_MAX_LENGTH)
  title?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(DESCRIPTION_MAX_LENGTH)
  description?: string;

  @IsOptional()
  @IsIn(USER_SETTABLE_JOB_STATUSES, {
    message: `status 는 ${USER_SETTABLE_JOB_STATUSES.join(', ')} 중 하나여야 합니다.`,
  })
  status?: JobStatus;
}
