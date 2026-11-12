export type FuelType = 'GASOLINE' | 'PREMIUM_GASOLINE' | 'DIESEL' | 'LPG';
export type InputType = 'FIXED_AMOUNT' | 'FIXED_LITER';
export type RoadType = 'CITY' | 'NATIONAL' | 'HIGHWAY';

export interface CandidateStationInput {
  stationId: string;
  name: string;
  brand: string;
  lat: number;
  lng: number;
  unitPrice: number;
  detourDistanceMeter: number;
  detourDurationSec: number;
  distanceFromCurrentMeter: number;
}

export interface DiscountCardRule {
  cardId: number;
  cardName: string;
  targetBrands: string[];
  discountType: 'PER_LITER' | 'PERCENT' | 'FLAT';
  discountValue: number;
  maxDiscountLimit: number;
}

export interface EngineCalculationContext {
  fuelType: FuelType;
  appliedEfficiency: number;
  inputType: InputType;
  defaultAmountMoney: number;
  defaultAmountLiter: number;
  ownedCards: DiscountCardRule[];
}

export interface RankedStationResult {
  rank: number;
  stationId: string;
  name: string;
  brand: string;
  brandName: string;
  location: { lat: number; lng: number };
  unitPrice: number;
  expectedFuelLiter: number;
  detourDistanceMeter: number;
  detourDurationSec: number;
  costBreakdown: {
    baseFuelCost: number;
    detourExtraCost: number;
    cardDiscountAmount: number;
    finalTotalCost: number;
  };
  comparison: {
    savedCostVsNearest: number;
    popupSummaryText: string;
  };
}
