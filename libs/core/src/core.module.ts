import { DynamicModule, Global, Module } from '@nestjs/common';

import { JsonDbService } from './database/json-db.service';
import { JobRepository } from './database/repositories';
import { FileLogService } from './log/file-log.service';

/**
 * 저장소 / 로거 등 공용 인프라 모듈
 *
 * @Global 싱글톤으로 등록한다. JsonDbService 가 가진 쓰기 큐가 동시성 제어의 핵심이라,
 * 모듈별로 인스턴스가 생기면 큐가 분리되어 직렬화가 깨지기 때문이다.
 */
@Global()
@Module({})
export class CoreModule {
  static JOB_REPO = 'IJobRepository';

  static forRoot(): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        JsonDbService,
        FileLogService,
        { provide: CoreModule.JOB_REPO, useClass: JobRepository },
      ],
      exports: [JsonDbService, FileLogService, CoreModule.JOB_REPO],
    };
  }
}
