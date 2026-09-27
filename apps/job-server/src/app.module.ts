import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import {
  AllExceptionsFilter,
  CoreConfigModule,
  CoreModule,
  validationExceptionFactory,
} from '@app/core';

import { JobModule } from './modules/job/job.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';

@Module({
  imports: [
    CoreConfigModule.forRoot(),
    CoreModule.forRoot(),
    ScheduleModule.forRoot(),
    JobModule,
    SchedulerModule,
  ],
  providers: [
    // main.ts 가 아닌 모듈에 등록해 e2e 테스트에서도 동일하게 적용되도록 한다
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        transform: true, // 쿼리 문자열 → number 등 DTO 타입으로 변환
        whitelist: true,
        forbidNonWhitelisted: true, // 정의되지 않은 필드(id, attempts 등) 는 400
        exceptionFactory: validationExceptionFactory,
      }),
    },
  ],
})
export class AppModule {}
