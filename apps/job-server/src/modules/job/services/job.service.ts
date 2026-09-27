import { Injectable } from '@nestjs/common';

import {
  CreateJobDto,
  ListJobsQueryDto,
  SearchJobsQueryDto,
  UpdateJobDto,
} from '../dto';
import {
  JobCreateUseCase,
  JobGetUseCase,
  JobListUseCase,
  JobSearchUseCase,
  JobUpdateUseCase,
} from '../usecase';

@Injectable()
export class JobService {
  constructor(
    private readonly jobCreateUseCase: JobCreateUseCase,
    private readonly jobGetUseCase: JobGetUseCase,
    private readonly jobListUseCase: JobListUseCase,
    private readonly jobSearchUseCase: JobSearchUseCase,
    private readonly jobUpdateUseCase: JobUpdateUseCase,
  ) {}

  async create(dto: CreateJobDto) {
    return await this.jobCreateUseCase.execute(dto);
  }

  async get(id: string) {
    return await this.jobGetUseCase.execute(id);
  }

  async list(query: ListJobsQueryDto) {
    return await this.jobListUseCase.execute(query);
  }

  async search(query: SearchJobsQueryDto) {
    return await this.jobSearchUseCase.execute(query);
  }

  async update(id: string, dto: UpdateJobDto, expectedVersion?: number) {
    return await this.jobUpdateUseCase.execute(id, dto, expectedVersion);
  }
}
