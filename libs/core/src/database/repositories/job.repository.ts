import { Injectable } from '@nestjs/common';

import { Job } from '../../models/entities';
import { IJobRepository } from '../../models/repositories';
import { JsonDbService } from '../json-db.service';

const JOBS_PATH = '/jobs';

@Injectable()
export class JobRepository implements IJobRepository {
  constructor(private readonly jsonDb: JsonDbService) {}

  async findAll(): Promise<Job[]> {
    return this.jsonDb.read<Job[]>(JOBS_PATH);
  }

  async findById(id: string): Promise<Job | null> {
    const jobs = await this.findAll();
    return jobs.find((job) => job.id === id) ?? null;
  }

  async create(job: Job): Promise<Job> {
    return this.transaction((jobs) => {
      jobs.push(job);
      return job;
    });
  }

  async updateById(
    id: string,
    mutator: (current: Job) => Job,
  ): Promise<Job | null> {
    return this.transaction((jobs) => {
      const index = jobs.findIndex((job) => job.id === id);
      if (index === -1) {
        return null;
      }
      const next = mutator(structuredClone(jobs[index]));
      jobs[index] = next;
      return next;
    });
  }

  async transaction<T>(mutator: (jobs: Job[]) => T): Promise<T> {
    return this.jsonDb.transaction<Job[], T>(JOBS_PATH, mutator);
  }
}
