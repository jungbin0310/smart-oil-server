import { Request, Response, NextFunction } from 'express';
import { StationRecommendRequest } from '../types/api.types';
import { recommendOptimalStations } from '../services/station.service';
import { HttpError } from '../middlewares/error.middleware';

/**
 * POST /api/v1/stations/recommend
 * - 경로 탐색(ROUTE) 및 반경 탐색(RADIUS) 기반 실주유비/주유량 최적 주유소 추천
 */
export async function recommendStations(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = (req.body || {}) as StationRecommendRequest;
    const origin = body.origin || body.currentLocation;

    if (!origin || !Number.isFinite(Number(origin.lat)) || !Number.isFinite(Number(origin.lng))) {
      throw new HttpError(
        400,
        'INVALID_ORIGIN',
        '유효한 현위치 좌표(origin 또는 currentLocation의 lat, lng)를 입력해 주세요.'
      );
    }

    const result = await recommendOptimalStations({
      userId: req.user?.userId,
      request: body,
    });

    res.status(200).json({
      success: true,
      data: result.data,
      meta: result.meta,
    });
  } catch (error) {
    next(error);
  }
}
