import { randomBytes } from 'crypto';
import { mkdir, open, readFile, rename, unlink } from 'fs/promises';
import path from 'path';
import type { IAdapter } from 'node-json-db';

/**
 * node-json-db 용 원자적(atomic) 파일 어댑터
 *
 * 기본 FileAdapter 는 대상 파일을 'w' 모드로 열어 즉시 truncate 한 뒤 쓰기 때문에,
 * 쓰기 도중 프로세스가 종료되면 빈 파일 / 잘린 JSON 이 남을 수 있다.
 *
 * 이 어댑터는 같은 디렉토리의 임시 파일에 전체 내용을 쓰고 fsync 한 뒤 rename 한다.
 * 같은 파일시스템 내 rename 은 POSIX 에서 원자적이므로, 디스크에는 항상
 * "이전 버전 전체" 또는 "새 버전 전체" 중 하나만 존재한다.
 */
export class AtomicFileAdapter implements IAdapter<string> {
  constructor(readonly filename: string) {}

  async readAsync(): Promise<string | null> {
    try {
      return await readFile(this.filename, { encoding: 'utf-8' });
    } catch (e) {
      if (e.code === 'ENOENT') {
        return null;
      }
      throw e;
    }
  }

  async writeAsync(data: string): Promise<void> {
    const dir = path.dirname(this.filename);
    const tmpPath = path.join(
      dir,
      `.${path.basename(this.filename)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`,
    );

    await mkdir(dir, { recursive: true });

    const fd = await open(tmpPath, 'w');
    try {
      await fd.writeFile(data, { encoding: 'utf-8' });
      await fd.sync();
    } finally {
      await fd.close();
    }

    try {
      await rename(tmpPath, this.filename);
    } catch (e) {
      await unlink(tmpPath).catch(() => undefined);
      throw e;
    }
  }
}
