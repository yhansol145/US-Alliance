import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiResponse, AppException, Job, PaginatedResponse } from '@app/core';
import { ErrorCode } from '@app/utils';

import {
  CreateJobDto,
  ListJobsQueryDto,
  SearchJobsQueryDto,
  UpdateJobDto,
} from '../dto';
import { JobService } from '../services/job.service';
import { parseIfMatch, toETag } from '../utils/etag';

const JobIdPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    AppException.badRequest(
      ErrorCode.VALIDATION_FAILED,
      'id 는 UUID 형식이어야 합니다.',
      [{ field: 'id', messages: ['UUID 형식이어야 합니다.'] }],
    ),
});

@Controller('jobs')
export class JobController {
  constructor(private readonly service: JobService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateJobDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiResponse<Job>> {
    const job = await this.service.create(dto);
    res.location(`/jobs/${job.id}`).setHeader('ETag', toETag(job));
    return { data: job };
  }

  @Get()
  async list(
    @Query() query: ListJobsQueryDto,
  ): Promise<PaginatedResponse<Job>> {
    return await this.service.list(query);
  }

  // `/jobs/:id` 보다 먼저 선언해야 'search' 가 id 로 매칭되지 않는다
  @Get('search')
  async search(
    @Query() query: SearchJobsQueryDto,
  ): Promise<PaginatedResponse<Job>> {
    return await this.service.search(query);
  }

  @Get(':id')
  async get(
    @Param('id', JobIdPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiResponse<Job>> {
    const job = await this.service.get(id);
    res.setHeader('ETag', toETag(job));
    return { data: job };
  }

  @Patch(':id')
  async update(
    @Param('id', JobIdPipe) id: string,
    @Body() dto: UpdateJobDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiResponse<Job>> {
    const job = await this.service.update(id, dto, parseIfMatch(ifMatch));
    res.setHeader('ETag', toETag(job));
    return { data: job };
  }
}
