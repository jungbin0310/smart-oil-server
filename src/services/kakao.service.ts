import axios from 'axios';
import { LatLng } from '../types/api.types';

const KAKAO_USER_ME_URL = 'https://kapi.kakao.com/v2/user/me';
const KAKAO_DIRECTIONS_URL = 'https://apis-navi.kakaomobility.com/v1/directions';
const KAKAO_DIRECTIONS_TIMEOUT_MS = 800;

export interface KakaoUserInfo {
  kakaoId: string;
  nickname: string;
}

export interface KakaoDirectionResult {
  distanceMeter: number;
  durationSec: number;
  /** [lng, lat] 좌표 배열 (GeoJSON / Turf 호환) */
  coordinates: [number, number][];
  roadNames: string[];
}

/**
 * 실제 카카오 액세스 토큰으로 사용자 정보 조회 (https://kapi.kakao.com/v2/user/me)
 */
export async function fetchKakaoUserInfo(kakaoAccessToken: string): Promise<KakaoUserInfo> {
  const response = await axios.get(KAKAO_USER_ME_URL, {
    headers: {
      Authorization: `Bearer ${kakaoAccessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    },
    timeout: 5000,
  });

  const data = response.data;
  if (!data || !data.id) {
    throw new Error('카카오 사용자 정보를 확인할 수 없습니다.');
  }

  const kakaoId = String(data.id);
  const nickname =
    data.kakao_account?.profile?.nickname ||
    data.properties?.nickname ||
    `카카오사용자_${kakaoId.slice(-4)}`;

  return {
    kakaoId,
    nickname: String(nickname).trim(),
  };
}

/**
 * 카카오모빌리티 길찾기 API 호출 (단일 목적지 또는 1개 경유지 포함, 타임아웃 800ms)
 */
export async function fetchKakaoDirections(
  origin: LatLng,
  destination: LatLng,
  waypoint?: LatLng
): Promise<KakaoDirectionResult> {
  const apiKey = (process.env.KAKAO_REST_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('KAKAO_REST_API_KEY_MISSING');
  }

  const params: Record<string, string> = {
    origin: `${origin.lng},${origin.lat}`,
    destination: `${destination.lng},${destination.lat}`,
    priority: 'RECOMMEND',
  };

  if (waypoint) {
    params.waypoints = `${waypoint.lng},${waypoint.lat}`;
  }

  const response = await axios.get(KAKAO_DIRECTIONS_URL, {
    headers: {
      Authorization: `KakaoAK ${apiKey}`,
    },
    params,
    timeout: KAKAO_DIRECTIONS_TIMEOUT_MS,
  });

  const route = response.data?.routes?.[0];
  if (!route || route.result_code !== 0 || !route.summary) {
    throw new Error(`KAKAO_DIRECTIONS_INVALID_RESULT: ${route?.result_msg || 'NO_ROUTE'}`);
  }

  const coordinates: [number, number][] = [];
  const roadNamesSet = new Set<string>();

  const sections = Array.isArray(route.sections) ? route.sections : [];
  for (const section of sections) {
    const roads = Array.isArray(section.roads) ? section.roads : [];
    for (const road of roads) {
      if (typeof road.name === 'string' && road.name.trim()) {
        roadNamesSet.add(road.name.trim());
      }
      const vertexes: number[] = Array.isArray(road.vertexes) ? road.vertexes : [];
      for (let i = 0; i + 1 < vertexes.length; i += 2) {
        const lng = Number(vertexes[i]);
        const lat = Number(vertexes[i + 1]);
        if (Number.isFinite(lng) && Number.isFinite(lat)) {
          const prev = coordinates[coordinates.length - 1];
          if (!prev || prev[0] !== lng || prev[1] !== lat) {
            coordinates.push([lng, lat]);
          }
        }
      }
    }
  }

  if (coordinates.length < 2) {
    coordinates.push([origin.lng, origin.lat], [destination.lng, destination.lat]);
  }

  return {
    distanceMeter: Number(route.summary.distance ?? 0),
    durationSec: Number(route.summary.duration ?? 0),
    coordinates,
    roadNames: Array.from(roadNamesSet),
  };
}
