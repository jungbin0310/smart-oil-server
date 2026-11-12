import express, { Request, Response } from 'express';
import cors from 'cors';
import './config/env';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// 기본 루트 엔드포인트
app.get('/', (_req: Request, res: Response) => {
  res.send('Smart Oil API Server Running');
});

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
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Smart Oil Server] Running on http://0.0.0.0:${PORT}`);
  });
}

export default app;
