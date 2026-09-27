import { Job } from '../entities';

export interface IJobRepository {
  findAll(): Promise<Job[]>;
  findById(id: string): Promise<Job | null>;
  create(job: Job): Promise<Job>;

  /**
   * 단일 Job 을 원자적으로 read-modify-write 한다.
   * - mutator 는 쓰기 큐 안에서 직렬로 실행되며, 예외를 던지면 아무것도 저장되지 않는다.
   * - 대상이 없으면 null 을 반환한다.
   */
  updateById(id: string, mutator: (current: Job) => Job): Promise<Job | null>;

  /**
   * 전체 jobs 배열을 대상으로 원자적 트랜잭션을 실행한다.
   * - mutator 는 작업용 복사본을 받아 직접 수정하고, 결과값을 반환한다.
   * - mutator 가 정상 종료되면 변경분이 한 번에 저장된다.
   * - 쓰기 큐를 짧게 유지하기 위해 mutator 는 동기 함수만 허용한다.
   */
  transaction<T>(mutator: (jobs: Job[]) => T): Promise<T>;
}
