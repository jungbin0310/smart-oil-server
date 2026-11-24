export type FuelType = 'GASOLINE' | 'PREMIUM_GASOLINE' | 'DIESEL' | 'LPG';
export type InputType = 'FIXED_AMOUNT' | 'FIXED_LITER';
export type RoadType = 'CITY' | 'NATIONAL' | 'HIGHWAY';

export interface CandidateStationInput {
  stationId: string;
  name: string;
  brand: string;
  roadType?: RoadType;
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
  roadType: RoadType;
  location: { lat: number; lng: number };
  unitPrice: number;
  expectedFuelLiter: number;
  netSecuredLiter: number;
  detourDistanceMeter: number;
  detourDurationSec: number;
  appliedCardName: string | null;
  costBreakdown: {
    baseFuelCost: number;
    detourExtraCost: number;
    cardDiscountAmount: number;
    finalTotalCost: number;
  };
}
