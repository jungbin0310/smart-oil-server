import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface AuthUserPayload {
  userId: number;
  kakaoId: string;
  nickname: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUserPayload;
    }
  }
}

export function signAccessToken(payload: AuthUserPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '30d' });
}

export function verifyAccessToken(token: string): AuthUserPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as AuthUserPayload;
    if (!decoded || typeof decoded.userId !== 'number') {
      return null;
    }
    return {
      userId: decoded.userId,
      kakaoId: String(decoded.kakaoId || ''),
      nickname: String(decoded.nickname || ''),
    };
  } catch {
    return null;
  }
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  return token || null;
}

/**
 * 필수 인증 미들웨어 (프로필 조회/수정, 주유 기록 등록 등)
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: '인증 토큰이 필요합니다.',
      },
    });
    return;
  }

  const user = verifyAccessToken(token);
  if (!user) {
    res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: '유효하지 않거나 만료된 인증 토큰입니다.',
      },
    });
    return;
  }

  req.user = user;
  next();
}

/**
 * 선택적 인증 미들웨어 (비회원 게스트 모드 허용)
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (token) {
    const user = verifyAccessToken(token);
    if (user) {
      req.user = user;
    }
  }
  next();
}
