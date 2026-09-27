import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigWithAdapter, JsonAdapter, JsonDB } from 'node-json-db';

import { APP_CONFIG, AppConfig } from '../config/app.config';
import { AtomicFileAdapter } from './atomic-file.adapter';

interface PendingTransaction {
  dataPath: string;
  mutator: (data: unknown) => unknown;
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
}

/**
 * node-json-db 래퍼
 *
 * [문제] node-json-db 는 개별 메서드(getData/push/save) 단위로만 내부 락을 잡는다.
 *        "읽기 → 수정 → 쓰기" 가 여러 await 로 나뉘면 API 요청과 스케줄러가
 *        끼어들어 lost update 가 발생한다.
 *
 * [해결] 모든 쓰기를 단일 큐로 직렬화한다 (single writer).
 *        큐에 쌓인 트랜잭션은 도착 순서대로 하나씩 메모리에 적용되고,
 *        디스크 저장(fsync)은 배치 단위로 한 번만 수행한다 (group commit).
 *        호출자는 자신의 변경이 디스크에 저장된 뒤에야 응답을 받는다.
 *
 * CoreModule 이 @Global 싱글톤으로 제공하므로 큐는 프로세스에 하나만 존재한다.
 */
@Injectable()
export class JsonDbService implements OnModuleInit {
  private db: JsonDB;
  private readonly queue: PendingTransaction[] = [];
  private draining = false;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async onModuleInit() {
    // saveOnPush=false: push 와 save 를 분리해 배치 끝에서 한 번만 저장한다
    this.db = new JsonDB(
      new ConfigWithAdapter(
        new JsonAdapter(new AtomicFileAdapter(this.config.dbPath), true),
        false,
      ),
    );

    // 파일이 깨져 있으면 여기서 예외가 발생한다.
    // 기존 데이터를 빈 값으로 덮어쓰지 않도록 의도적으로 부팅을 실패시킨다.
    await this.db.load();

    if (!(await this.db.exists('/jobs'))) {
      await this.db.push('/jobs', []);
      await this.db.save();
    }
  }

  /**
   * 큐를 거치지 않고 읽는다.
   *
   * 쓰기는 항상 새 객체로 통째로 교체(copy-on-write)하고 내부 객체를 제자리에서
   * 수정하지 않으므로, 읽는 쪽은 언제나 트랜잭션 단위로 일관된 스냅샷을 본다.
   * 반환값은 복사본이라 호출자가 수정해도 DB 에 영향이 없다.
   */
  async read<T>(dataPath: string): Promise<T> {
    return structuredClone(await this.db.getData(dataPath));
  }

  /**
   * dataPath 의 값을 원자적으로 read-modify-write 한다.
   *
   * - mutator 는 작업용 복사본을 받아 직접 수정하고 결과값을 반환한다.
   * - mutator 가 예외를 던지면 해당 트랜잭션만 취소되고 같은 배치의 다른 트랜잭션은 영향이 없다.
   * - 큐 처리를 짧게 유지하기 위해 mutator 는 동기 함수여야 한다 (I/O 금지).
   */
  transaction<D, T>(dataPath: string, mutator: (data: D) => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        dataPath,
        mutator: mutator as (data: unknown) => unknown,
        resolve: resolve as (result: unknown) => void,
        reject,
      });
      void this.drain();
    });
  }

  private async drain() {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        await this.commitBatch(this.queue.splice(0));
      }
    } finally {
      this.draining = false;
    }
  }

  private async commitBatch(batch: PendingTransaction[]) {
    const applied: { tx: PendingTransaction; result: unknown }[] = [];
    let dirty = false;

    for (const tx of batch) {
      try {
        const current = await this.db.getData(tx.dataPath);
        const working = structuredClone(current);
        const result = tx.mutator(working);

        // 변경이 없으면 push 를 생략한다 (스케줄러의 빈 tick 등에서 디스크 쓰기 방지)
        if (JSON.stringify(working) !== JSON.stringify(current)) {
          await this.db.push(tx.dataPath, working, true);
          dirty = true;
        }
        applied.push({ tx, result: structuredClone(result) });
      } catch (e) {
        tx.reject(e);
      }
    }

    if (dirty) {
      try {
        await this.db.save();
      } catch (e) {
        // 저장 실패 시 메모리를 디스크 기준으로 되돌려,
        // "응답은 실패했는데 메모리에는 반영됨" 상태가 남지 않게 한다
        await this.db.reload();
        applied.forEach(({ tx }) => tx.reject(e));
        return;
      }
    }

    applied.forEach(({ tx, result }) => tx.resolve(result));
  }
}
