import '../config/env';
import { syncOpinetStations, FuelCodeOption } from './opinet.sync';
import { pool } from '../config/db';

function parseCliFuelArg(): FuelCodeOption {
  const arg =
    process.argv.slice(2).find((a) => !a.startsWith('-')) ||
    process.argv
      .slice(2)
      .find((a) => a.startsWith('--fuel='))
      ?.split('=')[1];

  if (!arg || arg.toLowerCase() === 'all') {
    return 'all';
  }
  const upper = arg.toUpperCase();
  if (upper === 'B027' || upper === 'D047' || upper === 'K015') {
    return upper;
  }
  return 'all';
}

async function run(): Promise<void> {
  const fuel = parseCliFuelArg();
  try {
    console.log(`[Opinet CLI] 오피넷 수도권 주유소 데이터 수동 동기화를 시작합니다 (fuel=${fuel})...`);
    const result = await syncOpinetStations({ fuel });
    console.log(
      `[Opinet CLI] 동기화 완료! (fuel=${result.fuel}, 수집 유종=[${result.syncedFuels.join(', ')}], 거점=${result.hubCount}개, 총 호출=${result.totalApiCalls}회) 병합 주유소: ${result.totalMergedStations}개, DB 적재/갱신 주유소: ${result.upsertedCount}개`
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
