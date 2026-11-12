import express, { Request, Response } from 'express';
import cors from 'cors';
import { env } from './config/env';

const app = express();

// 기본 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 헬스체크 엔드포인트
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'OK' });
});

// 서버 실행
if (require.main === module) {
  app.listen(env.PORT, () => {
    console.log(`[Smart Oil Server] Running on http://localhost:${env.PORT}`);
  });
}

export default app;
