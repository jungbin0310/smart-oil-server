import axios from 'axios';
import proj4 from 'proj4';
import cron from 'node-cron';
import { RowDataPacket } from 'mysql2/promise';
import { pool } from '../config/db';

// 오피넷 KATEC 좌표계 정의 및 WGS84 좌표계 정의
const KATEC_PROJ =
  '+proj=tmerc +lat_0=38 +lon_0=128 +k=0.9999 +x_0=400000 +y_0=600000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43';
const WGS84_PROJ = 'EPSG:4326';

const OPINET_AROUND_ALL_URL = 'http://www.opinet.co.kr/api/aroundAll.do';
const DEFAULT_RADIUS = 5000;

// 전국 주요 도시 거점 KATEC 중심 좌표 리스트
export interface KatecHub {
  name: string;
  x: number;
  y: number;
}

export const MAJOR_HUBS: KatecHub[] = [
  { name: '서울(도심)', x: 309910, y: 552073 },
  { name: '서울(강남)', x: 314213, y: 544414 },
  { name: '판교/성남', x: 321498, y: 532899 },
  { name: '수원', x: 314034, y: 518410 },
  { name: '인천', x: 285642, y: 540140 },
  { name: '대전', x: 344951, y: 416812 },
  { name: '대구', x: 454504, y: 363660 },
  { name: '부산', x: 498165, y: 287275 },
  { name: '광주', x: 295665, y: 285115 },
];

// 오피넷 유종 코드 정의 (B027: 휘발유, B034: 고급휘발유, D047: 경유, K015: LPG)
export const OPINET_PROD_CODES = [
  { prodcd: 'B027', label: '휘발유', field: 'gasolinePrice' },
  { prodcd: 'B034', label: '고급휘발유', field: 'premiumPrice' },
  { prodcd: 'D047', label: '경유', field: 'dieselPrice' },
  { prodcd: 'K015', label: 'LPG', field: 'lpgPrice' },
] as const;

type PriceFieldKey = (typeof OPINET_PROD_CODES)[number]['field'];

interface OpinetAroundOilItem {
  UNI_ID: string;
  POLL_DIV_CD: string;
  OS_NM: string;
  PRICE: number | string;
  DISTANCE?: number | string;
  GIS_X_COOR: number | string;
  GIS_Y_COOR: number | string;
  NEW_ADR?: string;
  VAN_ADR?: string;
}

export interface MergedStationData {
  stationId: string;
  name: string;
  brand: string;
  address: string | null;
  lat: number;
  lng: number;
  katecX: number;
  katecY: number;
  gasolinePrice: number | null;
  premiumPrice: number | null;
  dieselPrice: number | null;
  lpgPrice: number | null;
}

export interface OpinetSyncResult {
  hubCount: number;
  totalMergedStations: number;
  upsertedCount: number;
  syncedAt: string;
}

const BRAND_NAME_MAP: Record<string, string> = {
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
 * 오피넷 KATEC 좌표(GIS_X_COOR, GIS_Y_COOR)를 WGS84(lng, lat)로 변환
 */
export function convertKatecToWgs84(katecX: number, katecY: number): { lat: number; lng: number } {
  const [lng, lat] = proj4(KATEC_PROJ, WGS84_PROJ, [Number(katecX), Number(katecY)]);
  return {
    lat: Number(lat.toFixed(7)),
    lng: Number(lng.toFixed(7)),
  };
}

/**
 * 단일 거점 + 단일 유종 오피넷 반경 검색 API 호출
 */
async function fetchAroundAllByHubAndProd(
  apiKey: string,
  hub: KatecHub,
  prodcd: string
): Promise<OpinetAroundOilItem[]> {
  const response = await axios.get(OPINET_AROUND_ALL_URL, {
    params: {
      code: apiKey,
      x: hub.x,
      y: hub.y,
      radius: DEFAULT_RADIUS,
      sort: 1,
      prodcd,
      out: 'json',
    },
    timeout: 15000,
  });

  const payload = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
  const oilList = payload?.RESULT?.OIL;

  if (!oilList) {
    return [];
  }

  return Array.isArray(oilList) ? oilList : [oilList];
}

interface ColumnMeta extends RowDataPacket {
  Field: string;
  Type: string;
  Null: 'YES' | 'NO';
  Key: string;
  Default: string | null;
  Extra: string;
}

/**
 * gas_station 테이블의 실제 컬럼 구조를 조회하여 안전하게 Upsert 쿼리를 구성 및 실행
 */
async function upsertStationsToGasStationTable(stations: MergedStationData[]): Promise<number> {
  if (stations.length === 0) {
    return 0;
  }

  let columnsMeta: ColumnMeta[] = [];
  try {
    const [rows] = await pool.query<ColumnMeta[]>('SHOW COLUMNS FROM gas_station');
    columnsMeta = rows;
  } catch (err) {
    console.warn('[Opinet Sync] SHOW COLUMNS FROM gas_station 조회 실패, 기본 컬럼 구성을 사용합니다:', err);
  }

  const hasDynamicColumns = columnsMeta.length > 0;
  const activeColumns: {
    name: string;
    isPrimaryKey: boolean;
    isSpatialPoint: boolean;
    getValue: (s: MergedStationData) => string | number | null;
  }[] = [];

  if (hasDynamicColumns) {
    for (const col of columnsMeta) {
      const fieldLower = col.Field.toLowerCase();
      const extraLower = (col.Extra || '').toLowerCase();

      if (extraLower.includes('auto_increment')) {
        continue;
      }
      if (['created_at', 'updated_at', 'synced_at', 'last_synced_at'].includes(fieldLower)) {
        continue;
      }

      const defaultNumeric = col.Null === 'NO' || col.Default !== null ? Number(col.Default) || 0 : 0;

      if (['station_id', 'uni_id', 'id'].includes(fieldLower)) {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: true,
          isSpatialPoint: false,
          getValue: (s) => s.stationId,
        });
      } else if (['name', 'station_name', 'os_nm'].includes(fieldLower)) {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          getValue: (s) => s.name,
        });
      } else if (['brand', 'brand_code', 'poll_div_cd'].includes(fieldLower)) {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          getValue: (s) => s.brand,
        });
      } else if (fieldLower === 'brand_name') {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          getValue: (s) => BRAND_NAME_MAP[s.brand] || s.brand,
        });
      } else if (['address', 'addr', 'new_adr', 'van_adr'].includes(fieldLower)) {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          getValue: (s) => s.address ?? (col.Null === 'YES' ? null : ''),
        });
      } else if (fieldLower === 'road_type') {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          getValue: () => 'CITY',
        });
      } else if (['lat', 'latitude'].includes(fieldLower)) {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          getValue: (s) => s.lat,
        });
      } else if (['lng', 'lon', 'longitude'].includes(fieldLower)) {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          getValue: (s) => s.lng,
        });
      } else if (['gis_x_coor', 'katec_x', 'x_coor'].includes(fieldLower)) {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          getValue: (s) => s.katecX,
        });
      } else if (['gis_y_coor', 'katec_y', 'y_coor'].includes(fieldLower)) {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          getValue: (s) => s.katecY,
        });
      } else if (
        ['location', 'point', 'geom', 'coords'].includes(fieldLower) ||
        col.Type.toLowerCase().includes('point')
      ) {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: true,
          // MySQL 8.0 SRID 4326: 반드시 POINT(위도 경도) 즉 POINT(lat lng) 순서 준수
          getValue: (s) => `POINT(${s.lat} ${s.lng})`,
        });
      } else if (
        [
          'gasoline_price',
          'price_gasoline',
          'gasoline',
          'normal_gasoline_price',
          'regular_price',
          'b027_price',
          'b027',
        ].includes(fieldLower)
      ) {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          getValue: (s) => s.gasolinePrice ?? defaultNumeric,
        });
      } else if (
        [
          'premium_price',
          'premium_gasoline_price',
          'price_premium',
          'price_premium_gasoline',
          'premium_gasoline',
          'high_gasoline_price',
          'premium',
          'b034_price',
          'b034',
        ].includes(fieldLower)
      ) {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          getValue: (s) => s.premiumPrice ?? defaultNumeric,
        });
      } else if (['diesel_price', 'price_diesel', 'diesel', 'd047_price', 'd047'].includes(fieldLower)) {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          getValue: (s) => s.dieselPrice ?? defaultNumeric,
        });
      } else if (
        ['lpg_price', 'price_lpg', 'lpg', 'butane_price', 'k015_price', 'k015'].includes(fieldLower)
      ) {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          getValue: (s) => s.lpgPrice ?? defaultNumeric,
        });
      }
    }
  }

  // 기본 컬럼 폴백 (SHOW COLUMNS 결과가 없을 경우)
  if (activeColumns.length === 0) {
    activeColumns.push(
      { name: 'station_id', isPrimaryKey: true, isSpatialPoint: false, getValue: (s) => s.stationId },
      { name: 'name', isPrimaryKey: false, isSpatialPoint: false, getValue: (s) => s.name },
      { name: 'brand', isPrimaryKey: false, isSpatialPoint: false, getValue: (s) => s.brand },
      {
        name: 'gasoline_price',
        isPrimaryKey: false,
        isSpatialPoint: false,
        getValue: (s) => s.gasolinePrice ?? 0,
      },
      {
        name: 'premium_price',
        isPrimaryKey: false,
        isSpatialPoint: false,
        getValue: (s) => s.premiumPrice ?? 0,
      },
      {
        name: 'diesel_price',
        isPrimaryKey: false,
        isSpatialPoint: false,
        getValue: (s) => s.dieselPrice ?? 0,
      },
      {
        name: 'lpg_price',
        isPrimaryKey: false,
        isSpatialPoint: false,
        getValue: (s) => s.lpgPrice ?? 0,
      },
      { name: 'lat', isPrimaryKey: false, isSpatialPoint: false, getValue: (s) => s.lat },
      { name: 'lng', isPrimaryKey: false, isSpatialPoint: false, getValue: (s) => s.lng },
      {
        name: 'location',
        isPrimaryKey: false,
        isSpatialPoint: true,
        getValue: (s) => `POINT(${s.lat} ${s.lng})`,
      }
    );
  }

  const colNamesSql = activeColumns.map((c) => `\`${c.name}\``).join(', ');
  const singleRowPlaceholders = activeColumns
    .map((c) => (c.isSpatialPoint ? 'ST_GeomFromText(?, 4326)' : '?'))
    .join(', ');
  const updateAssignmentsSql = activeColumns
    .filter((c) => !c.isPrimaryKey)
    .map((c) => `\`${c.name}\` = VALUES(\`${c.name}\`)`)
    .join(', ');

  // 배치 단위로 묶어서 INSERT INTO gas_station ... ON DUPLICATE KEY UPDATE 실행
  const BATCH_SIZE = 100;
  let upsertedCount = 0;

  for (let i = 0; i < stations.length; i += BATCH_SIZE) {
    const chunk = stations.slice(i, i + BATCH_SIZE);
    const valuesSql = chunk.map(() => `(${singleRowPlaceholders})`).join(', ');
    const sql = `
      INSERT INTO gas_station (${colNamesSql})
      VALUES ${valuesSql}
      ON DUPLICATE KEY UPDATE ${updateAssignmentsSql}
    `;

    const params: (string | number | null)[] = [];
    for (const station of chunk) {
      for (const col of activeColumns) {
        params.push(col.getValue(station));
      }
    }

    await pool.query(sql, params);
    upsertedCount += chunk.length;
  }

  return upsertedCount;
}

let activeSyncPromise: Promise<OpinetSyncResult> | null = null;

/**
 * 전국 주요 거점 반경 5000m 내 주유소 유종별 데이터를 수집/병합하여 gas_station 테이블에 적재
 */
export async function syncOpinetStations(): Promise<OpinetSyncResult> {
  if (activeSyncPromise) {
    console.log('[Opinet Sync] 이미 동기화 작업이 진행 중이므로 기존 작업을 대기합니다.');
    return activeSyncPromise;
  }

  activeSyncPromise = (async () => {
    const apiKey = process.env.OPINET_API_KEY || process.env.OPINET_KEY;
    if (!apiKey) {
      throw new Error('OPINET_API_KEY 환경변수가 설정되어 있지 않습니다.');
    }

    console.log(`[Opinet Sync] 전국 ${MAJOR_HUBS.length}개 주요 거점 오피넷 데이터 수집을 시작합니다...`);
    const stationMap = new Map<string, MergedStationData>();

    for (const hub of MAJOR_HUBS) {
      try {
        const resultsByProd = await Promise.all(
          OPINET_PROD_CODES.map(async ({ prodcd, field }) => {
            try {
              const items = await fetchAroundAllByHubAndProd(apiKey, hub, prodcd);
              return { field, items };
            } catch (err) {
              console.error(`[Opinet Sync] 거점(${hub.name}) 유종(${prodcd}) 조회 실패:`, err);
              return { field, items: [] as OpinetAroundOilItem[] };
            }
          })
        );

        for (const { field, items } of resultsByProd) {
          for (const item of items) {
            const uniId = String(item.UNI_ID || '').trim();
            const katecX = Number(item.GIS_X_COOR);
            const katecY = Number(item.GIS_Y_COOR);
            const price = Number(item.PRICE);

            if (!uniId || !Number.isFinite(katecX) || !Number.isFinite(katecY)) {
              continue;
            }

            let existing = stationMap.get(uniId);
            if (!existing) {
              const { lat, lng } = convertKatecToWgs84(katecX, katecY);
              // 대한민국 위경도 유효 범위 검증
              if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 30 || lat > 40 || lng < 120 || lng > 135) {
                continue;
              }

              existing = {
                stationId: uniId,
                name: String(item.OS_NM || '').trim(),
                brand: String(item.POLL_DIV_CD || 'ETC').trim(),
                address: item.NEW_ADR || item.VAN_ADR || null,
                lat,
                lng,
                katecX,
                katecY,
                gasolinePrice: null,
                premiumPrice: null,
                dieselPrice: null,
                lpgPrice: null,
              };
              stationMap.set(uniId, existing);
            }

            if (Number.isFinite(price) && price > 0) {
              existing[field as PriceFieldKey] = price;
            }
          }
        }
      } catch (hubError) {
        console.error(`[Opinet Sync] 거점(${hub.name}) 처리 중 오류 발생:`, hubError);
      }
    }

    const mergedStations = Array.from(stationMap.values());
    console.log(`[Opinet Sync] 총 ${mergedStations.length}개 주유소 병합 완료. DB 적재를 시작합니다...`);

    const upsertedCount = await upsertStationsToGasStationTable(mergedStations);
    const syncedAt = new Date().toISOString();

    console.log(`[Opinet Sync] gas_station 테이블 ${upsertedCount}건 적재/갱신 완료 (${syncedAt})`);

    return {
      hubCount: MAJOR_HUBS.length,
      totalMergedStations: mergedStations.length,
      upsertedCount,
      syncedAt,
    };
  })();

  try {
    return await activeSyncPromise;
  } finally {
    activeSyncPromise = null;
  }
}

let isCronScheduled = false;

/**
 * 하루 4번 (00:00, 06:00, 12:00, 18:00 - Asia/Seoul 기준) 자동 동기화 스케줄러 등록
 */
export function startOpinetSyncScheduler(): void {
  if (isCronScheduled) {
    return;
  }

  cron.schedule(
    '0 0,6,12,18 * * *',
    async () => {
      console.log('[Opinet Cron] 정기 오피넷 주유소 데이터 동기화 실행 (Asia/Seoul)...');
      try {
        await syncOpinetStations();
      } catch (error) {
        console.error('[Opinet Cron] 정기 오피넷 동기화 실패:', error);
      }
    },
    {
      timezone: 'Asia/Seoul',
    }
  );

  isCronScheduled = true;
  console.log('[Opinet Cron] 스케줄러 등록 완료 (0 0,6,12,18 * * * / Asia/Seoul)');
}
