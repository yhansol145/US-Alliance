import { DynamicModule, Global, Module } from '@nestjs/common';

import { APP_CONFIG, AppConfig, DEFAULT_APP_CONFIG } from './app.config';

@Global()
@Module({})
export class CoreConfigModule {
  static forRoot(config: AppConfig = DEFAULT_APP_CONFIG): DynamicModule {
    return {
      module: CoreConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
