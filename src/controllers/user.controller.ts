import { Request, Response, NextFunction } from 'express';
import { UpdateUserProfileRequest } from '../types/api.types';
import { findUserProfile, upsertUserProfile } from '../repositories/user.repository';
import { HttpError } from '../middlewares/error.middleware';

/**
 * GET /api/v1/users/profile
 */
export async function getUserProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new HttpError(401, 'UNAUTHORIZED', '로그인이 필요합니다.');
    }

    const profile = await findUserProfile(req.user.userId);
    res.status(200).json({
      success: true,
      data: profile,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/v1/users/profile
 */
export async function updateUserProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new HttpError(401, 'UNAUTHORIZED', '로그인이 필요합니다.');
    }

    const payload = (req.body || {}) as UpdateUserProfileRequest;

    if (
      payload.fuelType !== undefined &&
      !['GASOLINE', 'PREMIUM_GASOLINE', 'DIESEL', 'LPG'].includes(payload.fuelType)
    ) {
      throw new HttpError(400, 'INVALID_FUEL_TYPE', '유효하지 않은 유종(fuelType)입니다.');
    }

    if (
      payload.inputType !== undefined &&
      !['FIXED_AMOUNT', 'FIXED_LITER'].includes(payload.inputType)
    ) {
      throw new HttpError(400, 'INVALID_INPUT_TYPE', '유효하지 않은 입력 방식(inputType)입니다.');
    }

    const updated = await upsertUserProfile(req.user.userId, payload);
    res.status(200).json({
      success: true,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
}
