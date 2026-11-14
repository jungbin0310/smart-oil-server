import '../config/env';
import { syncOpinetStations } from './opinet.sync';
import { pool } from '../config/db';

async function run(): Promise<void> {
  try {
    console.log('[Opinet CLI] 오피넷 주유소 데이터 수동 동기화를 시작합니다...');
    const result = await syncOpinetStations();
    console.log(
      `[Opinet CLI] 동기화 완료! 수집/병합된 주유소: ${result.totalMergedStations}개, DB 적재/갱신된 주유소: ${result.upsertedCount}개`
    );
    await pool.end().catch(() => {});
    process.exit(0);
  } catch (error) {
    console.error('[Opinet CLI] 오피넷 데이터 수동 동기화 실패:', error);
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

void run();
