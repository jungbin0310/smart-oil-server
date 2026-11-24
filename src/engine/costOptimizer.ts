import {
  CandidateStationInput,
  DiscountCardRule,
  EngineCalculationContext,
  RankedStationResult,
} from '../types/engine.types';

export const BRAND_NAME_MAP: Record<string, string> = {
  SKE: 'SK에너지',
  GSC: 'GS칼텍스',
  HDO: '현대오일뱅크',
  SOL: 'S-OIL',
  RTO: '자영알뜰',
  RTX: '고속도로알뜰',
  NHO: '농협알뜰',
  ETC: '자가상표',
  E1G: 'E1',
  SKG: 'SK가스',
};

/**
 * 보유 카드 중 해당 주유소 브랜드에 적용 가능한 최대 할인액 계산
 */
function calculateBestCardDiscount(
  brand: string,
  expectedFuelLiter: number,
  baseFuelCost: number,
  ownedCards: DiscountCardRule[]
): { amount: number; cardName: string | null } {
  let bestAmount = 0;
  let bestCardName: string | null = null;
  const normalizedBrand = (brand || '').trim().toUpperCase();

  for (const card of ownedCards) {
    const targets = (card.targetBrands || []).map((b) => String(b).trim().toUpperCase());
    const isMatched = targets.includes('ALL') || targets.includes(normalizedBrand);
    if (!isMatched) {
      continue;
    }

    let rawDiscount = 0;
    if (card.discountType === 'PER_LITER') {
      rawDiscount = Math.round(expectedFuelLiter * card.discountValue);
    } else if (card.discountType === 'PERCENT') {
      rawDiscount = Math.round(baseFuelCost * (card.discountValue / 100));
    } else if (card.discountType === 'FLAT') {
      rawDiscount = Math.round(card.discountValue);
    }

    const cappedDiscount =
      card.maxDiscountLimit > 0 ? Math.min(rawDiscount, card.maxDiscountLimit) : rawDiscount;
    const finalDiscount = Math.max(0, Math.min(cappedDiscount, baseFuelCost));

    if (finalDiscount > bestAmount) {
      bestAmount = finalDiscount;
      bestCardName = card.cardName;
    }
  }

  return { amount: bestAmount, cardName: bestCardName };
}

/**
 * 확정된 2가지 실주유비/주유량 최적화 수식 적용
 * - FIXED_LITER: 최종 실주유비(finalTotalCost) 오름차순 정렬
 * - FIXED_AMOUNT: 순수 확보 주유량(netSecuredLiter) 내림차순 정렬
 */
export function optimizeAndRankStations(
  candidates: CandidateStationInput[],
  context: EngineCalculationContext
): RankedStationResult[] {
  const safeEfficiency = context.appliedEfficiency > 0 ? context.appliedEfficiency : 13.0;

  const evaluated = candidates
    .filter((c) => Number.isFinite(c.unitPrice) && c.unitPrice > 0)
    .map((candidate) => {
      const detourKm = Math.max(0, candidate.detourDistanceMeter) / 1000;
      const detourFuelLiter = detourKm / safeEfficiency;
      const detourExtraCost = Math.round(detourFuelLiter * candidate.unitPrice);

      let expectedFuelLiter = 0;
      let baseFuelCost = 0;
      let cardDiscountAmount = 0;
      let appliedCardName: string | null = null;
      let finalTotalCost = 0;
      let netSecuredLiter = 0;

      if (context.inputType === 'FIXED_LITER') {
        // ① 주유량 입력 시 (FIXED_LITER)
        expectedFuelLiter = Number(context.defaultAmountLiter.toFixed(2));
        baseFuelCost = Math.round(expectedFuelLiter * candidate.unitPrice);

        const bestCard = calculateBestCardDiscount(
          candidate.brand,
          expectedFuelLiter,
          baseFuelCost,
          context.ownedCards
        );
        cardDiscountAmount = bestCard.amount;
        appliedCardName = bestCard.cardName;

        finalTotalCost = baseFuelCost + detourExtraCost - cardDiscountAmount;
        netSecuredLiter = Number((expectedFuelLiter - detourFuelLiter).toFixed(2));
      } else {
        // ② 주유 금액 입력 시 (FIXED_AMOUNT)
        baseFuelCost = Math.round(context.defaultAmountMoney);
        expectedFuelLiter = Number((context.defaultAmountMoney / candidate.unitPrice).toFixed(2));

        const bestCard = calculateBestCardDiscount(
          candidate.brand,
          expectedFuelLiter,
          baseFuelCost,
          context.ownedCards
        );
        cardDiscountAmount = bestCard.amount;
        appliedCardName = bestCard.cardName;

        netSecuredLiter = Number(
          ((context.defaultAmountMoney - detourExtraCost + cardDiscountAmount) / candidate.unitPrice).toFixed(2)
        );
        finalTotalCost = context.defaultAmountMoney - cardDiscountAmount;
      }

      return {
        rank: 0,
        stationId: candidate.stationId,
        name: candidate.name,
        brand: candidate.brand,
        brandName: BRAND_NAME_MAP[candidate.brand] || candidate.brand,
        roadType: candidate.roadType || 'CITY',
        location: {
          lat: candidate.lat,
          lng: candidate.lng,
        },
        unitPrice: candidate.unitPrice,
        expectedFuelLiter,
        netSecuredLiter,
        detourDistanceMeter: Math.round(Math.max(0, candidate.detourDistanceMeter)),
        detourDurationSec: Math.round(Math.max(0, candidate.detourDurationSec)),
        appliedCardName,
        costBreakdown: {
          baseFuelCost,
          detourExtraCost,
          cardDiscountAmount,
          finalTotalCost,
        },
      };
    });

  if (context.inputType === 'FIXED_LITER') {
    evaluated.sort((a, b) => {
      if (a.costBreakdown.finalTotalCost !== b.costBreakdown.finalTotalCost) {
        return a.costBreakdown.finalTotalCost - b.costBreakdown.finalTotalCost;
      }
      return a.detourDistanceMeter - b.detourDistanceMeter;
    });
  } else {
    evaluated.sort((a, b) => {
      if (b.netSecuredLiter !== a.netSecuredLiter) {
        return b.netSecuredLiter - a.netSecuredLiter;
      }
      return a.detourDistanceMeter - b.detourDistanceMeter;
    });
  }

  return evaluated.map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));
}
