import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { createWriteStream, mkdirSync, WriteStream } from 'fs';
import path from 'path';

import { APP_CONFIG, AppConfig } from '../config/app.config';

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

/**
 * logs.txt 파일 로거
 *
 * - append 모드의 단일 WriteStream 을 공유하므로, API 요청 로그와 스케줄러 로그가
 *   동시에 발생해도 한 줄 단위로 순서대로 기록되고 서로 섞이지 않는다.
 * - 스트림 쓰기는 비동기 버퍼링이라 요청 처리 경로를 블로킹하지 않는다.
 */
@Injectable()
export class FileLogService implements OnApplicationShutdown {
  private readonly consoleLogger = new Logger();
  private readonly stream: WriteStream;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    mkdirSync(path.dirname(config.logPath), { recursive: true });
    this.stream = createWriteStream(config.logPath, {
      flags: 'a',
      encoding: 'utf-8',
    });
    this.stream.on('error', (e) =>
      this.consoleLogger.error(`logs.txt 쓰기 실패: ${e.message}`, 'FileLog'),
    );
  }

  log(message: string, context: string): void {
    this.write('INFO', message, context);
  }

  warn(message: string, context: string): void {
    this.write('WARN', message, context);
  }

  error(message: string, context: string, stack?: string): void {
    this.write('ERROR', stack ? `${message}\n${stack}` : message, context);
  }

  /**
   * 지금까지 쓴 로그가 모두 파일에 반영될 때까지 기다린다 (테스트 / 종료 시 사용)
   */
  flush(): Promise<void> {
    return new Promise((resolve) => this.stream.write('', () => resolve()));
  }

  async onApplicationShutdown() {
    await new Promise<void>((resolve) => this.stream.end(() => resolve()));
  }

  private write(level: LogLevel, message: string, context: string): void {
    const line = `${new Date().toISOString()} [${level}] [${context}] ${message}\n`;
    if (!this.stream.writableEnded) {
      this.stream.write(line);
    }

    if (this.config.logToConsole) {
      if (level === 'ERROR') this.consoleLogger.error(message, context);
      else if (level === 'WARN') this.consoleLogger.warn(message, context);
      else this.consoleLogger.log(message, context);
    }
  }
}
