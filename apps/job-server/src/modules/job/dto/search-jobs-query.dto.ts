import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { JOB_STATUSES, JobStatus } from '@app/utils';

import { TITLE_MAX_LENGTH, trim } from './create-job.dto';
import { ListJobsQueryDto } from './list-jobs-query.dto';

/**
 * GET /jobs/search?title=report&status=pending,failed
 * - title: 부분 일치, 대소문자 무시
 * - status: 쉼표 구분 또는 반복 파라미터(status=a&status=b) 로 복수 지정 (OR)
 * - title 과 status 를 함께 주면 AND
 */
export class SearchJobsQueryDto extends ListJobsQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(TITLE_MAX_LENGTH)
  title?: string;

  @IsOptional()
  @Transform(({ value }) =>
    (Array.isArray(value) ? value : [value])
      .flatMap((v) => String(v).split(','))
      .map((v) => v.trim())
      .filter(Boolean),
  )
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(JOB_STATUSES, {
    each: true,
    message: `status 는 ${JOB_STATUSES.join(', ')} 중 하나여야 합니다.`,
  })
  status?: JobStatus[];
}
