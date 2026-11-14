import express, { Request, Response } from 'express';
import cors from 'cors';
import { RowDataPacket } from 'mysql2/promise';
import './config/env';
import { pool } from './config/db';
import { syncOpinetStations, startOpinetSyncScheduler } from './batch/opinet.sync';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// 기본 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 기본 루트 엔드포인트
app.get('/', (_req: Request, res: Response) => {
  res.send('Smart Oil API Server Running');
});

// 헬스체크 엔드포인트
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'OK' });
});

// 수동 오피넷 동기화 엔드포인트 (브라우저 GET 및 Postman POST 모두 지원)
const handleManualOpinetSync = async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await syncOpinetStations();
    res.status(200).json({
      success: true,
      message: '오피넷 주유소 데이터 수집 및 갱신이 완료되었습니다.',
      data: result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '오피넷 주유소 데이터 동기화 중 오류가 발생했습니다.';
    console.error('[Admin Sync API] 오피넷 수동 동기화 오류:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'OPINET_SYNC_FAILED',
        message,
      },
    });
  }
};

app.post('/api/v1/admin/sync-opinet', handleManualOpinetSync);
app.get('/api/v1/admin/sync-opinet', handleManualOpinetSync);

// 관리자 키 검증 기반 원격 수동 갱신 엔드포인트 (GET /api/v1/admin/sync?key=smartoil)
app.get('/api/v1/admin/sync', async (req: Request, res: Response): Promise<void> => {
  const adminKey = process.env.ADMIN_KEY || 'smartoil';
  const providedKey = typeof req.query.key === 'string' ? req.query.key : '';

  if (!providedKey || providedKey !== adminKey) {
    res.status(403).json({
      success: false,
      message: '권한이 없습니다. 유효한 key 파라미터를 입력해 주세요.',
    });
    return;
  }

  try {
    const result = await syncOpinetStations();
    res.status(200).json({
      success: true,
      message: '오피넷 수동 갱신 완료',
      updatedCount: result.upsertedCount,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '오피넷 주유소 데이터 동기화 중 오류가 발생했습니다.';
    console.error('[Admin Sync API] 오피넷 수동 동기화 오류:', error);
    res.status(500).json({
      success: false,
      message,
    });
  }
});

/**
 * 서버 시작 시 gas_station 테이블 데이터 개수가 10개 미만이면 백그라운드에서 1회 자동 동기화 실행
 */
async function checkAndRunInitialOpinetSync(): Promise<void> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM gas_station');
    const count = Number(rows[0]?.count ?? 0);
    console.log(`[Smart Oil Server] 현재 gas_station 테이블 데이터 개수: ${count}개`);

    if (count < 10) {
      console.log(
        '[Smart Oil Server] gas_station 데이터가 10개 미만이므로 백그라운드에서 오피넷 초기 동기화를 실행합니다...'
      );
      syncOpinetStations().catch((err) => {
        console.error('[Smart Oil Server] 백그라운드 초기 오피넷 동기화 실패:', err);
      });
    }
  } catch (error) {
    console.error('[Smart Oil Server] gas_station 테이블 초기 개수 확인 중 오류 발생:', error);
  }
}

// 서버 실행
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Smart Oil Server] Running on http://0.0.0.0:${PORT}`);
    startOpinetSyncScheduler();
    void checkAndRunInitialOpinetSync();
  });
}

export default app;
