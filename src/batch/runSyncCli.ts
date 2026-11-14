import '../config/env';
import { syncOpinetStations, SyncChunkOption } from './opinet.sync';
import { pool } from '../config/db';

function parseCliChunkArg(): SyncChunkOption {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('-')) ||
    process.argv
      .slice(2)
      .find((a) => a.startsWith('--chunk='))
      ?.split('=')[1];

  if (!arg || arg.toLowerCase() === 'all') {
    return 'all';
  }
  if (arg === '1' || arg === '2' || arg === '3' || arg === '4') {
    return Number(arg) as 1 | 2 | 3 | 4;
  }
  return 'all';
}

async function run(): Promise<void> {
  const chunk = parseCliChunkArg();
  try {
    console.log(`[Opinet CLI] 오피넷 주유소 데이터 수동 동기화를 시작합니다 (chunk=${chunk})...`);
    const result = await syncOpinetStations({ chunk });
    console.log(
      `[Opinet CLI] 동기화 완료! (chunk=${result.chunk}, 거점=${result.hubCount}개) 수집/병합된 주유소: ${result.totalMergedStations}개, DB 적재/갱신된 주유소: ${result.upsertedCount}개`
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
