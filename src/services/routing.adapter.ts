import { LatLng } from '../types/api.types';
import { CandidateStationInput, RoadType } from '../types/engine.types';
import { StationDbRow } from '../repositories/station.repository';
import { fetchKakaoDirections } from './kakao.service';

export interface BaseRouteResult {
  distanceMeter: number;
  durationSec: number;
  coordinates: [number, number][];
  roadNames: string[];
  isFallbackApplied: boolean;
  fallbackReason?: string;
}

const DETOUR_TORTUOSITY_FACTOR: Record<RoadType, number> = {
  CITY: 1.3,
  NATIONAL: 1.2,
  HIGHWAY: 1.05,
};

const AVG_SPEED_MPS: Record<RoadType, number> = {
  CITY: 8.33, // 약 30km/h
  NATIONAL: 13.89, // 약 50km/h
  HIGHWAY: 22.22, // 약 80km/h
};

/**
 * Haversine 공식 기반 두 WGS84 좌표 간 직선거리(m) 계산
 */
export function calculateHaversineMeter(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 1단계: 카카오모빌리티 원본 경로 조회 (실패/타임아웃/키 미설정 시 직선 경로 Fallback)
 */
export async function getBaseRouteWithFallback(
  origin: LatLng,
  destination: LatLng,
  roadTypeHint: RoadType
): Promise<BaseRouteResult> {
  try {
    const direction = await fetchKakaoDirections(origin, destination);
    return {
      ...direction,
      isFallbackApplied: false,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'KAKAO_DIRECTIONS_FAILED';
    const straightDist = calculateHaversineMeter(origin, destination);
    const factor = DETOUR_TORTUOSITY_FACTOR[roadTypeHint] ?? 1.3;
    const estimatedDist = Math.round(straightDist * factor);
    const estimatedDuration = Math.round(estimatedDist / (AVG_SPEED_MPS[roadTypeHint] ?? 8.33));

    return {
      distanceMeter: estimatedDist,
      durationSec: estimatedDuration,
      coordinates: [
        [origin.lng, origin.lat],
        [destination.lng, destination.lat],
      ],
      roadNames: [],
      isFallbackApplied: true,
      fallbackReason: reason,
    };
  }
}

/**
 * Fallback 우회거리 공식:
 * [현위치->주유소 직선거리 + 주유소->목적지 직선거리 - 현위치->목적지 직선거리] * 굴곡도 계수(시내 1.3, 국도 1.2)
 */
function calculateFallbackDetour(
  origin: LatLng,
  destination: LatLng,
  station: StationDbRow,
  roadType: RoadType
): { detourDistanceMeter: number; detourDurationSec: number } {
  const originToStation =
    station.distanceFromCurrentMeter > 0
      ? station.distanceFromCurrentMeter
      : calculateHaversineMeter(origin, { lat: station.lat, lng: station.lng });
  const stationToDest = calculateHaversineMeter({ lat: station.lat, lng: station.lng }, destination);
  const originToDest = calculateHaversineMeter(origin, destination);

  const rawExtraStraight = Math.max(0, originToStation + stationToDest - originToDest);
  const factor = DETOUR_TORTUOSITY_FACTOR[roadType] ?? 1.3;
  const detourDistanceMeter = Math.round(rawExtraStraight * factor);
  const detourDurationSec = Math.round(detourDistanceMeter / (AVG_SPEED_MPS[roadType] ?? 8.33));

  return { detourDistanceMeter, detourDurationSec };
}

/**
 * 2단계/3단계: 후보 주유소(최대 5개)별 순수 우회거리 및 추가 시간 산출
 * - 카카오 경유지 API 병렬 호출 (타임아웃 800ms)
 * - 키 없음/에러/타임아웃 시 즉시 Haversine + 굴곡도 계수 Fallback 적용
 */
export async function computeStationDetoursWithFallback(params: {
  origin: LatLng;
  destination: LatLng;
  baseRoute: BaseRouteResult;
  stations: StationDbRow[];
  roadType: RoadType;
}): Promise<{
  candidates: CandidateStationInput[];
  isFallbackApplied: boolean;
  fallbackReason?: string;
}> {
  let isFallbackApplied = params.baseRoute.isFallbackApplied;
  let fallbackReason = params.baseRoute.fallbackReason;

  const hasKakaoKey = Boolean((process.env.KAKAO_REST_API_KEY || '').trim());

  const candidates = await Promise.all(
    params.stations.map(async (station): Promise<CandidateStationInput> => {
      if (!params.baseRoute.isFallbackApplied && hasKakaoKey) {
        try {
          const viaRoute = await fetchKakaoDirections(params.origin, params.destination, {
            lat: station.lat,
            lng: station.lng,
          });
          const detourDistanceMeter = Math.max(
            0,
            Math.round(viaRoute.distanceMeter - params.baseRoute.distanceMeter)
          );
          const detourDurationSec = Math.max(
            0,
            Math.round(viaRoute.durationSec - params.baseRoute.durationSec)
          );

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
        } catch (err) {
          isFallbackApplied = true;
          fallbackReason = err instanceof Error ? err.message : 'KAKAO_WAYPOINT_FAILED';
        }
      } else {
        isFallbackApplied = true;
        if (!hasKakaoKey && !fallbackReason) {
          fallbackReason = 'KAKAO_REST_API_KEY_MISSING';
        }
      }

      const fallbackDetour = calculateFallbackDetour(
        params.origin,
        params.destination,
        station,
        params.roadType
      );

      return {
        stationId: station.stationId,
        name: station.name,
        brand: station.brand,
        roadType: station.roadType,
        lat: station.lat,
        lng: station.lng,
        unitPrice: station.unitPrice,
        detourDistanceMeter: fallbackDetour.detourDistanceMeter,
        detourDurationSec: fallbackDetour.detourDurationSec,
        distanceFromCurrentMeter: station.distanceFromCurrentMeter,
      };
    })
  );

  return {
    candidates,
    isFallbackApplied,
    fallbackReason,
  };
}
