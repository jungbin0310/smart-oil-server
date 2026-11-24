import { Request, Response, NextFunction } from 'express';
import { KakaoLoginRequest } from '../types/api.types';
import { fetchKakaoUserInfo } from '../services/kakao.service';
import { upsertUserByKakaoId } from '../repositories/user.repository';
import { signAccessToken } from '../middlewares/auth.middleware';
import { HttpError } from '../middlewares/error.middleware';

/**
 * POST /api/v1/auth/kakao
 * - kakaoAccessToken === 'DEV_TEST_TOKEN': users 테이블에 테스트 유저(kakao_id: 'test_user_1', nickname: '류태현') Upsert 후 JWT 발급
 * - 실제 카카오 토큰: https://kapi.kakao.com/v2/user/me 검증 후 Upsert 및 JWT 발급
 */
export async function loginWithKakao(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = req.body as Partial<KakaoLoginRequest>;
    const kakaoAccessToken = typeof body?.kakaoAccessToken === 'string' ? body.kakaoAccessToken.trim() : '';

    if (!kakaoAccessToken) {
      throw new HttpError(400, 'INVALID_REQUEST', 'kakaoAccessToken이 필요합니다.');
    }

    let kakaoId: string;
    let nickname: string;

    if (kakaoAccessToken === 'DEV_TEST_TOKEN') {
      kakaoId = 'test_user_1';
      nickname = '류태현';
    } else {
      try {
        const kakaoUser = await fetchKakaoUserInfo(kakaoAccessToken);
        kakaoId = kakaoUser.kakaoId;
        nickname = kakaoUser.nickname;
      } catch (err) {
        console.error('[Auth Controller] 카카오 토큰 검증 실패:', err);
        throw new HttpError(401, 'KAKAO_AUTH_FAILED', '유효하지 않은 카카오 액세스 토큰입니다.');
      }
    }

    const user = await upsertUserByKakaoId(kakaoId, nickname);
    const accessToken = signAccessToken({
      userId: user.userId,
      kakaoId: user.kakaoId,
      nickname: user.nickname,
    });

    res.status(200).json({
      success: true,
      data: {
        accessToken,
        user,
      },
    });
  } catch (error) {
    next(error);
  }
}
