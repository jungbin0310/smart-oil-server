import * as turf from '@turf/turf';
import {
  CandidateStationInput,
  DiscountCardRule,
  EngineCalculationContext,
  FuelType,
  InputType,
  RoadType,
} from '../types/engine.types';
import {
  LatLng,
  StationRecommendRequest,
  StationRecommendResponseData,
} from '../types/api.types';
import { DEFAULT_USER_PROFILE, findUserProfile } from '../repositories/user.repository';
import {
  findTopStationsInRadius,
  findTopStationsInRouteBuffer,
} from '../repositories/station.repository';
import {
  computeStationDetoursWithFallback,
  getBaseRouteWithFallback,
} from './routing.adapter';
import { optimizeAndRankStations } from '../engine/costOptimizer';

const ROUTE_BUFFER_KM: Record<RoadType, number> = {
  HIGHWAY: 0.3, // 300m
  NATIONAL: 2.0, // 2km
  CITY: 0.8, // 800m
};

function resolveEffectiveRoadType(roadTypeHint: RoadType, roadNames: string[]): RoadType {
  if (roadTypeHint === 'HIGHWAY' || roadNames.some((name) => name.includes('고속도로'))) {
    return 'HIGHWAY';
  }
  if (roadTypeHint === 'NATIONAL') {
    return 'NATIONAL';
  }
  return 'CITY';
}

export async function recommendOptimalStations(params: {
  userId?: number;
  request: StationRecommendRequest;
}): Promise<{
  data: StationRecommendResponseData;
  meta: Record<string, unknown>;
}> {
  const origin: LatLng | undefined = params.request.origin || params.request.currentLocation;
  if (
    !origin ||
    !Number.isFinite(Number(origin.lat)) ||
    !Number.isFinite(Number(origin.lng))
  ) {
    throw new Error('유효한 출발지 좌표(origin 또는 currentLocation)가 필요합니다.');
  }

  const normalizedOrigin: LatLng = {
    lat: Number(origin.lat),
    lng: Number(origin.lng),
  };

  // 1. 사용자 프로필 및 보유 할인카드 로드 (비회원일 경우 기본값 적용)
  let fuelType: FuelType = DEFAULT_USER_PROFILE.fuelType;
  let appliedEfficiency: number = DEFAULT_USER_PROFILE.appliedEfficiency;
  let inputType: InputType = DEFAULT_USER_PROFILE.inputType;
  let defaultAmountMoney: number = DEFAULT_USER_PROFILE.defaultAmountMoney;
  let defaultAmountLiter: number = DEFAULT_USER_PROFILE.defaultAmountLiter;
  let ownedCards: DiscountCardRule[] = [];

  if (params.userId) {
    const profile = await findUserProfile(params.userId);
    fuelType = profile.fuelType;
    appliedEfficiency = profile.appliedEfficiency;
    inputType = profile.inputType;
    defaultAmountMoney = profile.defaultAmountMoney;
    defaultAmountLiter = profile.defaultAmountLiter;
    ownedCards = profile.ownedCards;
  }

  // 요청 본문에 명시적 오버라이드가 있으면 우선 반영
  if (params.request.fuelType) fuelType = params.request.fuelType;
  if (params.request.inputType) inputType = params.request.inputType;
  if (params.request.appliedEfficiency && params.request.appliedEfficiency > 0) {
    appliedEfficiency = Number(params.request.appliedEfficiency);
  }
  if (params.request.defaultAmountMoney && params.request.defaultAmountMoney > 0) {
    defaultAmountMoney = Math.round(Number(params.request.defaultAmountMoney));
  }
  if (params.request.defaultAmountLiter && params.request.defaultAmountLiter > 0) {
    defaultAmountLiter = Number(params.request.defaultAmountLiter);
  }

  const rawDest = params.request.destination;
  const hasValidDestination = Boolean(
    rawDest && Number.isFinite(Number(rawDest.lat)) && Number.isFinite(Number(rawDest.lng))
  );
  const effectiveSearchMode: 'ROUTE' | 'RADIUS' =
    params.request.searchMode === 'RADIUS' || !hasValidDestination ? 'RADIUS' : 'ROUTE';

  const roadTypeHint: RoadType = params.request.roadTypeHint || 'CITY';
  let appliedRoadType: RoadType = roadTypeHint;
  let isFallbackApplied = false;
  let fallbackReason: string | undefined;
  let candidates: CandidateStationInput[] = [];

  if (effectiveSearchMode === 'ROUTE' && rawDest) {
    const normalizedDest: LatLng = {
      lat: Number(rawDest.lat),
      lng: Number(rawDest.lng),
    };

    // (1) 카카오모빌리티 원본 경로 조회 (실패/타임아웃 시 직선 경로 Fallback)
    const baseRoute = await getBaseRouteWithFallback(
      normalizedOrigin,
      normalizedDest,
      roadTypeHint
    );

    // (2) 도로 유형별 차등 공간 필터링 버퍼 생성 (@turf/turf)
    appliedRoadType = resolveEffectiveRoadType(roadTypeHint, baseRoute.roadNames);
    const bufferKm = ROUTE_BUFFER_KM[appliedRoadType] ?? 0.8;

    const routeLine = turf.lineString(baseRoute.coordinates);
    const bufferPolygon = turf.buffer(routeLine, bufferKm, { units: 'kilometers' });

    if (bufferPolygon) {
      // (3) 버퍼 내 주유소 중 단가 오름차순 상위 5개 후보 조회
      const topStations = await findTopStationsInRouteBuffer({
        origin: normalizedOrigin,
        bufferPolygon,
        fuelType,
        roadType: appliedRoadType,
        limit: 5,
      });

      // (4) 경유지 우회거리 계산 (실패 시 3단계 Fallback)
      const detourResult = await computeStationDetoursWithFallback({
        origin: normalizedOrigin,
        destination: normalizedDest,
        baseRoute,
        stations: topStations,
        roadType: appliedRoadType,
      });

      candidates = detourResult.candidates;
      isFallbackApplied = detourResult.isFallbackApplied;
      fallbackReason = detourResult.fallbackReason;
    } else {
      isFallbackApplied = baseRoute.isFallbackApplied;
      fallbackReason = baseRoute.fallbackReason;
    }
  } else {
    // [반경 탐색 모드]: 현위치 반경 3km 내 단가 오름차순 상위 5개 조회, 직선거리 * 1.3 우회거리 적용
    appliedRoadType = 'CITY';
    const nearbyStations = await findTopStationsInRadius({
      origin: normalizedOrigin,
      radiusMeter: 3000,
      fuelType,
      limit: 5,
    });

    candidates = nearbyStations.map((station) => {
      const detourDistanceMeter = Math.round(station.distanceFromCurrentMeter * 1.3);
      const detourDurationSec = Math.round(detourDistanceMeter / 8.33);
      return {
        stationId: station.stationId,
        name: station.name,
        brand: station.brand,
        roadType: station.roadType,
        lat: station.lat,
        lng: station.lng,
        unitPrice: station.unitPrice,
        detourDistanceMeter,
        detourDurationSec,
        distanceFromCurrentMeter: station.distanceFromCurrentMeter,
      };
    });
  }

  // 3. 확정된 2가지 실주유비/주유량 최적화 수식 적용 및 정렬
  const engineContext: EngineCalculationContext = {
    fuelType,
    appliedEfficiency,
    inputType,
    defaultAmountMoney,
    defaultAmountLiter,
    ownedCards,
  };

  const ranked = optimizeAndRankStations(candidates, engineContext);

  return {
    data: {
      searchMode: effectiveSearchMode,
      appliedRoadType,
      fuelType,
      inputType,
      appliedEfficiency,
      topRecommendation: ranked[0] ?? null,
      alternatives: ranked.slice(1, 5),
    },
    meta: {
      isFallbackApplied,
      ...(fallbackReason ? { fallbackReason } : {}),
      candidateCount: ranked.length,
    },
  };
}
