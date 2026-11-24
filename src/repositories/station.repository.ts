import { RowDataPacket } from 'mysql2/promise';
import * as turf from '@turf/turf';
import { pool } from '../config/db';
import { FuelType, RoadType } from '../types/engine.types';
import { LatLng } from '../types/api.types';

export interface StationDbRow {
  stationId: string;
  name: string;
  brand: string;
  roadType: RoadType;
  lat: number;
  lng: number;
  unitPrice: number;
  distanceFromCurrentMeter: number;
}

const FUEL_PRICE_COLUMN_MAP: Record<FuelType, string> = {
  GASOLINE: 'gasoline_price',
  PREMIUM_GASOLINE: 'premium_gasoline_price',
  DIESEL: 'diesel_price',
  LPG: 'lpg_price',
};

let gasStationColumnsCache: Set<string> | null = null;

async function getGasStationColumns(): Promise<Set<string>> {
  if (gasStationColumnsCache) {
    return gasStationColumnsCache;
  }
  const [rows] = await pool.query<RowDataPacket[]>('SHOW COLUMNS FROM gas_station');
  gasStationColumnsCache = new Set(rows.map((r) => String(r.Field).toLowerCase()));
  return gasStationColumnsCache;
}

/**
 * 유종에 따른 gas_station 가격 컬럼명 매핑
 * (DB에서 해당 컬럼이 삭제된 경우 null 반환하여 SQL 에러 방지)
 */
export async function resolveFuelPriceColumn(fuelType: FuelType): Promise<string | null> {
  const targetCol = FUEL_PRICE_COLUMN_MAP[fuelType] || 'gasoline_price';
  const cols = await getGasStationColumns();
  if (!cols.has(targetCol)) {
    return null;
  }
  return targetCol;
}

function buildRoadTypeWhereSql(roadType: RoadType): string {
  if (roadType === 'HIGHWAY') {
    return `(\`road_type\` = 'HIGHWAY' OR \`name\` LIKE '%휴게소%')`;
  }
  return `(\`road_type\` IS NULL OR \`road_type\` != 'HIGHWAY')`;
}

function mapStationRow(row: RowDataPacket): StationDbRow {
  const rawRoadType = String(row.road_type || 'CITY').toUpperCase();
  const roadType: RoadType =
    rawRoadType === 'HIGHWAY' ? 'HIGHWAY' : rawRoadType === 'NATIONAL' ? 'NATIONAL' : 'CITY';

  return {
    stationId: String(row.station_id),
    name: String(row.name),
    brand: String(row.brand || 'ETC'),
    roadType,
    lat: Number(row.lat),
    lng: Number(row.lng),
    unitPrice: Number(row.unit_price),
    distanceFromCurrentMeter: Math.round(Number(row.distance_meter ?? 0)),
  };
}

/**
 * GeoJSON Polygon을 MySQL 8.0 SRID 4326 WKT (POLYGON((lat lng, ...)))로 변환
 */
function geoJsonPolygonToSrid4326Wkt(
  feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
): string | null {
  const geom = feature.geometry;
  let ring: number[][] | null = null;

  if (geom.type === 'Polygon' && geom.coordinates.length > 0) {
    ring = geom.coordinates[0];
  } else if (geom.type === 'MultiPolygon' && geom.coordinates.length > 0 && geom.coordinates[0].length > 0) {
    ring = geom.coordinates[0][0];
  }

  if (!ring || ring.length < 4) {
    return null;
  }

  // MySQL 8.0 SRID 4326은 (위도 경도) 즉 (lat lng) 순서
  const coordsStr = ring.map(([lng, lat]) => `${lat.toFixed(6)} ${lng.toFixed(6)}`).join(', ');
  return `POLYGON((${coordsStr}))`;
}

/**
 * [경로 탐색 모드] 경로 버퍼 폴리곤 내 주유소 중 단가 오름차순 상위 limit개 후보 조회
 * - MySQL ST_Contains(SRID 4326) 우선 시도 후, 실패/폴리곤 이슈 시 Bounding Box + Turf booleanPointInPolygon으로 안전하게 처리
 */
export async function findTopStationsInRouteBuffer(params: {
  origin: LatLng;
  bufferPolygon: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  fuelType: FuelType;
  roadType: RoadType;
  limit?: number;
}): Promise<StationDbRow[]> {
  const priceCol = await resolveFuelPriceColumn(params.fuelType);
  if (!priceCol) {
    return [];
  }

  const limit = params.limit ?? 5;
  const roadWhereSql = buildRoadTypeWhereSql(params.roadType);
  const originPointWkt = `POINT(${params.origin.lat} ${params.origin.lng})`;

  // 1차 시도: MySQL ST_Contains + SRID 4326
  const polygonWkt = geoJsonPolygonToSrid4326Wkt(params.bufferPolygon);
  if (polygonWkt) {
    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        `
          SELECT
            \`station_id\`,
            \`name\`,
            \`brand\`,
            \`road_type\`,
            \`lat\`,
            \`lng\`,
            \`${priceCol}\` AS unit_price,
            ST_Distance_Sphere(\`location\`, ST_GeomFromText(?, 4326)) AS distance_meter
          FROM gas_station
          WHERE \`${priceCol}\` > 0
            AND ${roadWhereSql}
            AND ST_Contains(ST_GeomFromText(?, 4326), \`location\`)
          ORDER BY \`${priceCol}\` ASC, distance_meter ASC
          LIMIT ?
        `,
        [originPointWkt, polygonWkt, limit]
      );

      if (rows.length > 0) {
        return rows.map(mapStationRow);
      }
    } catch (err) {
      console.warn('[Station Repository] ST_Contains 조회 실패, Bounding Box + Turf 필터링으로 대체합니다:', err);
    }
  }

  // 2차(안전 폴백): Bounding Box SQL + Turf booleanPointInPolygon 정밀 필터링
  const [minLng, minLat, maxLng, maxLat] = turf.bbox(params.bufferPolygon);
  const [bboxRows] = await pool.query<RowDataPacket[]>(
    `
      SELECT
        \`station_id\`,
        \`name\`,
        \`brand\`,
        \`road_type\`,
        \`lat\`,
        \`lng\`,
        \`${priceCol}\` AS unit_price,
        ST_Distance_Sphere(\`location\`, ST_GeomFromText(?, 4326)) AS distance_meter
      FROM gas_station
      WHERE \`${priceCol}\` > 0
        AND ${roadWhereSql}
        AND \`lat\` BETWEEN ? AND ?
        AND \`lng\` BETWEEN ? AND ?
      ORDER BY \`${priceCol}\` ASC, distance_meter ASC
      LIMIT 200
    `,
    [originPointWkt, minLat, maxLat, minLng, maxLng]
  );

  const filtered = bboxRows
    .map(mapStationRow)
    .filter((station) => {
      const pt = turf.point([station.lng, station.lat]);
      return turf.booleanPointInPolygon(pt, params.bufferPolygon);
    });

  return filtered.slice(0, limit);
}

/**
 * [반경 탐색 모드] 현위치 반경 radiusMeter(기본 3000m) 내 주유소 중 단가 오름차순 상위 limit개 조회
 */
export async function findTopStationsInRadius(params: {
  origin: LatLng;
  radiusMeter?: number;
  fuelType: FuelType;
  limit?: number;
}): Promise<StationDbRow[]> {
  const priceCol = await resolveFuelPriceColumn(params.fuelType);
  if (!priceCol) {
    return [];
  }

  const radiusMeter = params.radiusMeter ?? 3000;
  const limit = params.limit ?? 5;
  const originPointWkt = `POINT(${params.origin.lat} ${params.origin.lng})`;

  // 1도 약 111km -> Bounding Box 사전 필터로 인덱스 활용 및 속도 최적화
  const latDelta = radiusMeter / 111000 + 0.01;
  const lngDelta = radiusMeter / (111000 * Math.cos((params.origin.lat * Math.PI) / 180)) + 0.01;

  const [rows] = await pool.query<RowDataPacket[]>(
    `
      SELECT
        \`station_id\`,
        \`name\`,
        \`brand\`,
        \`road_type\`,
        \`lat\`,
        \`lng\`,
        \`${priceCol}\` AS unit_price,
        ST_Distance_Sphere(\`location\`, ST_GeomFromText(?, 4326)) AS distance_meter
      FROM gas_station
      WHERE \`${priceCol}\` > 0
        AND \`lat\` BETWEEN ? AND ?
        AND \`lng\` BETWEEN ? AND ?
        AND ST_Distance_Sphere(\`location\`, ST_GeomFromText(?, 4326)) <= ?
      ORDER BY \`${priceCol}\` ASC, distance_meter ASC
      LIMIT ?
    `,
    [
      originPointWkt,
      params.origin.lat - latDelta,
      params.origin.lat + latDelta,
      params.origin.lng - lngDelta,
      params.origin.lng + lngDelta,
      originPointWkt,
      radiusMeter,
      limit,
    ]
  );

  return rows.map(mapStationRow);
}
