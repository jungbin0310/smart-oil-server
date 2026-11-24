import { Request, Response, NextFunction } from 'express';
import { findAllDiscountCards } from '../repositories/user.repository';

/**
 * GET /api/v1/master/cards
 * - discount_policy_master 테이블의 전체 카드 목록 조회 (target_brands JSON 파싱 포함)
 */
export async function getMasterCards(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const cards = await findAllDiscountCards();
    res.status(200).json({
      success: true,
      data: {
        cards,
      },
      meta: {
        totalCount: cards.length,
      },
    });
  } catch (error) {
    next(error);
  }
}
