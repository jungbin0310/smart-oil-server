import { FuelType, InputType, RankedStationResult, RoadType, DiscountCardRule } from './engine.types';

// 클라이언트 요청/응답 DTO 타입 정의
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  meta?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    fallbackAction?: string;
  };
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface KakaoLoginRequest {
  kakaoAccessToken: string;
}

export interface UserProfileDto {
  userId: number;
  fuelType: FuelType;
  officialEfficiency: number;
  customEfficiency: number | null;
  appliedEfficiency: number;
  recordCount: number;
  inputType: InputType;
  defaultAmountMoney: number;
  defaultAmountLiter: number;
  ownedCardIds: number[];
  ownedCards: DiscountCardRule[];
}

export interface UpdateUserProfileRequest {
  fuelType?: FuelType;
  officialEfficiency?: number;
  customEfficiency?: number | null;
  inputType?: InputType;
  defaultAmountMoney?: number;
  defaultAmountLiter?: number;
  ownedCardIds?: number[];
}

export interface CreateFuelRecordRequest {
  drivenDistanceKm: number;
  fueledLiter: number;
}

export interface StationRecommendRequest {
  origin?: LatLng;
  currentLocation?: LatLng;
  destination?: LatLng | null;
  searchMode?: 'ROUTE' | 'RADIUS';
  roadTypeHint?: RoadType;
  fuelType?: FuelType;
  inputType?: InputType;
  defaultAmountMoney?: number;
  defaultAmountLiter?: number;
  appliedEfficiency?: number;
}

export interface StationRecommendResponseData {
  searchMode: 'ROUTE' | 'RADIUS';
  appliedRoadType: RoadType;
  fuelType: FuelType;
  inputType: InputType;
  appliedEfficiency: number;
  topRecommendation: RankedStationResult | null;
  alternatives: RankedStationResult[];
}
