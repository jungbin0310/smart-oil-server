import { Request, Response, NextFunction } from 'express';
import { CreateFuelRecordRequest } from '../types/api.types';
import { updateEfficiencyWithFuelRecord } from '../repositories/user.repository';
import { HttpError } from '../middlewares/error.middleware';

/**
 * POST /api/v1/records
 * - drivenDistanceKm / fueledLiter로 단일 연비 산출
 * - 최근 5회 가중 이동평균으로 user_vehicle_profile.custom_efficiency 및 record_count 갱신
 */
export async function createFuelRecord(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new HttpError(401, 'UNAUTHORIZED', '로그인이 필요합니다.');
    }

    const body = req.body as Partial<CreateFuelRecordRequest>;
    const drivenDistanceKm = Number(body?.drivenDistanceKm);
    const fueledLiter = Number(body?.fueledLiter);

    if (!Number.isFinite(drivenDistanceKm) || drivenDistanceKm <= 0) {
      throw new HttpError(400, 'INVALID_DISTANCE', 'drivenDistanceKm은 0보다 큰 숫자여야 합니다.');
    }
    if (!Number.isFinite(fueledLiter) || fueledLiter <= 0) {
      throw new HttpError(400, 'INVALID_LITER', 'fueledLiter는 0보다 큰 숫자여야 합니다.');
    }

    const result = await updateEfficiencyWithFuelRecord(
      req.user.userId,
      drivenDistanceKm,
      fueledLiter
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}
