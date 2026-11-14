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
const REQUEST_DELAY_MS = 100;
export const CHUNK_SIZE = 30;

export type SyncChunkOption = 1 | 2 | 3 | 4 | 'all';

export interface Wgs84Hub {
  name: string;
  lat: number;
  lng: number;
}

/**
 * 전국 120개 시/군/구 및 주요 거점 WGS84(위경도) 중심 좌표 리스트
 * - Chunk 1 (1~30번): 서울 25개 구 전체 + 경기 핵심(성남/분당/판교/하남/과천)
 * - Chunk 2 (31~60번): 경기도 30개 주요 시/군 권역 전체
 * - Chunk 3 (61~90번): 인천(8개 구), 대전(5개 구), 대구(6개 권역), 광주(4개 권역), 울산(5개 구/군), 세종 등
 * - Chunk 4 (91~120번): 부산(9개 권역), 강원, 충북, 충남, 전북, 전남, 경북, 경남, 제주 주요 시 거점
 */
export const NATIONWIDE_WGS84_HUBS: Wgs84Hub[] = [
  // [Chunk 1: 1~30번] 서울 25개 자치구 전체 + 성남/분당/판교/하남/과천
  { name: '서울 종로구', lat: 37.5730, lng: 126.9794 },
  { name: '서울 중구', lat: 37.5641, lng: 126.9979 },
  { name: '서울 용산구', lat: 37.5326, lng: 126.9904 },
  { name: '서울 성동구', lat: 37.5633, lng: 127.0371 },
  { name: '서울 광진구', lat: 37.5385, lng: 127.0823 },
  { name: '서울 동대문구', lat: 37.5744, lng: 127.0400 },
  { name: '서울 중랑구', lat: 37.6066, lng: 127.0927 },
  { name: '서울 성북구', lat: 37.5894, lng: 127.0167 },
  { name: '서울 강북구', lat: 37.6396, lng: 127.0257 },
  { name: '서울 도봉구', lat: 37.6688, lng: 127.0471 },
  { name: '서울 노원구', lat: 37.6542, lng: 127.0568 },
  { name: '서울 은평구', lat: 37.6027, lng: 126.9291 },
  { name: '서울 서대문구', lat: 37.5791, lng: 126.9368 },
  { name: '서울 마포구', lat: 37.5663, lng: 126.9016 },
  { name: '서울 양천구', lat: 37.5170, lng: 126.8665 },
  { name: '서울 강서구', lat: 37.5510, lng: 126.8495 },
  { name: '서울 구로구', lat: 37.4954, lng: 126.8874 },
  { name: '서울 금천구', lat: 37.4569, lng: 126.8954 },
  { name: '서울 영등포구', lat: 37.5264, lng: 126.8962 },
  { name: '서울 동작구', lat: 37.5124, lng: 126.9393 },
  { name: '서울 관악구', lat: 37.4784, lng: 126.9516 },
  { name: '서울 서초구', lat: 37.4837, lng: 127.0324 },
  { name: '서울 강남구', lat: 37.5172, lng: 127.0473 },
  { name: '서울 송파구', lat: 37.5145, lng: 127.1066 },
  { name: '서울 강동구', lat: 37.5301, lng: 127.1238 },
  { name: '경기 성남(수정/중원)', lat: 37.4449, lng: 127.1389 },
  { name: '경기 성남(분당)', lat: 37.3827, lng: 127.1189 },
  { name: '경기 성남(판교)', lat: 37.3948, lng: 127.1112 },
  { name: '경기 하남', lat: 37.5393, lng: 127.2149 },
  { name: '경기 과천', lat: 37.4292, lng: 126.9877 },

  // [Chunk 2: 31~60번] 경기도 시/군 전역
  { name: '경기 수원(영통/팔달)', lat: 37.2636, lng: 127.0286 },
  { name: '경기 수원(장안/권선)', lat: 37.2911, lng: 126.9958 },
  { name: '경기 용인(처인)', lat: 37.2343, lng: 127.2013 },
  { name: '경기 용인(기흥/수지)', lat: 37.3005, lng: 127.0989 },
  { name: '경기 고양(일산)', lat: 37.6584, lng: 126.7730 },
  { name: '경기 고양(덕양)', lat: 37.6375, lng: 126.8327 },
  { name: '경기 화성(동탄)', lat: 37.2006, lng: 127.0749 },
  { name: '경기 화성(향남/남양)', lat: 37.1328, lng: 126.9206 },
  { name: '경기 남양주(다산/별내)', lat: 37.6360, lng: 127.2165 },
  { name: '경기 남양주(진접/화도)', lat: 37.6531, lng: 127.3035 },
  { name: '경기 부천', lat: 37.5034, lng: 126.7660 },
  { name: '경기 안산(단원/상록)', lat: 37.3219, lng: 126.8309 },
  { name: '경기 안양(동안/만안)', lat: 37.3943, lng: 126.9568 },
  { name: '경기 평택(남부)', lat: 36.9921, lng: 127.1129 },
  { name: '경기 평택(송탄/고덕)', lat: 37.0650, lng: 127.0558 },
  { name: '경기 시흥', lat: 37.3800, lng: 126.8028 },
  { name: '경기 김포', lat: 37.6152, lng: 126.7156 },
  { name: '경기 파주', lat: 37.7599, lng: 126.7802 },
  { name: '경기 의정부', lat: 37.7381, lng: 127.0337 },
  { name: '경기 광주', lat: 37.4294, lng: 127.2551 },
  { name: '경기 광명', lat: 37.4785, lng: 126.8646 },
  { name: '경기 군포', lat: 37.3617, lng: 126.9352 },
  { name: '경기 의왕', lat: 37.3448, lng: 126.9683 },
  { name: '경기 오산', lat: 37.1499, lng: 127.0772 },
  { name: '경기 이천', lat: 37.2720, lng: 127.4350 },
  { name: '경기 안성', lat: 37.0080, lng: 127.2797 },
  { name: '경기 구리', lat: 37.5943, lng: 127.1296 },
  { name: '경기 포천', lat: 37.8949, lng: 127.2003 },
  { name: '경기 양주', lat: 37.7853, lng: 127.0458 },
  { name: '경기 여주/양평', lat: 37.2983, lng: 127.6374 },

  // [Chunk 3: 61~90번] 인천(8개 구) + 대전 + 대구 + 광주 + 울산 + 세종 + 경기 북동부
  { name: '인천 중구/동구', lat: 37.4737, lng: 126.6217 },
  { name: '인천 미추홀구', lat: 37.4636, lng: 126.6505 },
  { name: '인천 연수구(송도)', lat: 37.4102, lng: 126.6788 },
  { name: '인천 남동구', lat: 37.4473, lng: 126.7314 },
  { name: '인천 부평구', lat: 37.5070, lng: 126.7218 },
  { name: '인천 계양구', lat: 37.5374, lng: 126.7378 },
  { name: '인천 서구(청라)', lat: 37.5454, lng: 126.6760 },
  { name: '인천 서구(검단)/강화', lat: 37.6015, lng: 126.6568 },
  { name: '대전 동구/중구', lat: 36.3256, lng: 127.4214 },
  { name: '대전 서구(둔산)', lat: 36.3553, lng: 127.3835 },
  { name: '대전 유성구', lat: 36.3622, lng: 127.3561 },
  { name: '대전 대덕구', lat: 36.4466, lng: 127.4242 },
  { name: '대구 중구/남구', lat: 35.8693, lng: 128.5955 },
  { name: '대구 동구', lat: 35.8865, lng: 128.6356 },
  { name: '대구 서구/북구', lat: 35.8856, lng: 128.5829 },
  { name: '대구 수성구', lat: 35.8581, lng: 128.6306 },
  { name: '대구 달서구', lat: 35.8299, lng: 128.5327 },
  { name: '대구 달성군', lat: 35.7746, lng: 128.4313 },
  { name: '광주 동구/남구', lat: 35.1461, lng: 126.9231 },
  { name: '광주 서구(상무)', lat: 35.1520, lng: 126.8895 },
  { name: '광주 북구', lat: 35.1741, lng: 126.9121 },
  { name: '광주 광산구', lat: 35.1396, lng: 126.7936 },
  { name: '울산 남구', lat: 35.5438, lng: 129.3300 },
  { name: '울산 중구', lat: 35.5694, lng: 129.3328 },
  { name: '울산 동구', lat: 35.5049, lng: 129.4166 },
  { name: '울산 북구', lat: 35.5826, lng: 129.3613 },
  { name: '울산 울주군', lat: 35.5222, lng: 129.2422 },
  { name: '세종특별자치시', lat: 36.4800, lng: 127.2890 },
  { name: '경기 가평/양평', lat: 37.8315, lng: 127.5095 },
  { name: '경기 동두천/연천', lat: 37.9035, lng: 127.0605 },

  // [Chunk 4: 91~120번] 부산 주요 구 + 강원/충청/전라/경상/제주 주요 시 거점
  { name: '부산 중구/서구/영도구', lat: 35.0979, lng: 129.0243 },
  { name: '부산 부산진구(서면)', lat: 35.1631, lng: 129.0532 },
  { name: '부산 동래구/연제구', lat: 35.1950, lng: 129.0805 },
  { name: '부산 해운대구/수영구', lat: 35.1631, lng: 129.1636 },
  { name: '부산 남구', lat: 35.1365, lng: 129.0844 },
  { name: '부산 사하구', lat: 35.1044, lng: 128.9748 },
  { name: '부산 북구/사상구', lat: 35.1526, lng: 128.9913 },
  { name: '부산 강서구(명지)', lat: 35.2122, lng: 128.9806 },
  { name: '부산 금정구/기장군', lat: 35.2428, lng: 129.0926 },
  { name: '강원 춘천', lat: 37.8813, lng: 127.7298 },
  { name: '강원 원주', lat: 37.3422, lng: 127.9202 },
  { name: '강원 강릉', lat: 37.7519, lng: 128.8761 },
  { name: '강원 속초/동해', lat: 38.2070, lng: 128.5918 },
  { name: '충북 청주(상당/서원)', lat: 36.6424, lng: 127.4890 },
  { name: '충북 청주(흥덕/청원)', lat: 36.6358, lng: 127.4335 },
  { name: '충북 충주/제천', lat: 36.9910, lng: 127.9259 },
  { name: '충남 천안(서북/동남)', lat: 36.8151, lng: 127.1139 },
  { name: '충남 아산', lat: 36.7898, lng: 127.0018 },
  { name: '충남 서산/당진', lat: 36.7845, lng: 126.4503 },
  { name: '충남 공주/논산', lat: 36.4465, lng: 127.1190 },
  { name: '전북 전주(완산/덕진)', lat: 35.8242, lng: 127.1480 },
  { name: '전북 익산/군산', lat: 35.9483, lng: 126.9576 },
  { name: '전남 목포/무안', lat: 34.8118, lng: 126.3922 },
  { name: '전남 여수', lat: 34.7604, lng: 127.6622 },
  { name: '전남 순천/광양', lat: 34.9506, lng: 127.4872 },
  { name: '경북 포항', lat: 36.0190, lng: 129.3435 },
  { name: '경북 구미/김천', lat: 36.1195, lng: 128.3446 },
  { name: '경북 경주/경산', lat: 35.8562, lng: 129.2247 },
  { name: '경남 창원/마산/진해', lat: 35.2281, lng: 128.6811 },
  { name: '제주 제주시/서귀포', lat: 33.4996, lng: 126.5312 },
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
  chunk: SyncChunkOption;
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

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 일반 WGS84 위경도(lat, lng)를 오피넷 KATEC 좌표(x, y)로 역변환
 * proj4('EPSG:4326', KATEC, [lng, lat]) 사용
 */
export function convertWgs84ToKatec(lat: number, lng: number): { x: number; y: number } {
  const [x, y] = proj4(WGS84_PROJ, KATEC_PROJ, [Number(lng), Number(lat)]);
  return {
    x: Math.round(x),
    y: Math.round(y),
  };
}

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
 * chunk 옵션(1~4 또는 'all')에 해당하는 거점 배열 슬라이스 반환
 */
export function getHubsByChunk(chunk: SyncChunkOption): Wgs84Hub[] {
  if (chunk === 'all') {
    return NATIONWIDE_WGS84_HUBS;
  }
  const startIdx = (chunk - 1) * CHUNK_SIZE;
  const endIdx = startIdx + CHUNK_SIZE;
  return NATIONWIDE_WGS84_HUBS.slice(startIdx, endIdx);
}

/**
 * 한국 시간(Asia/Seoul) 현재 시각 기준으로 Rolling Chunk 번호(1~4) 계산
 * - 00시 타임(00~05시): 1번 (1~30번 거점)
 * - 06시 타임(06~11시): 2번 (31~60번 거점)
 * - 12시 타임(12~17시): 3번 (61~90번 거점)
 * - 18시 타임(18~23시): 4번 (91~120번 거점)
 */
export function getCurrentRollingChunk(): 1 | 2 | 3 | 4 {
  const seoulHourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    hour: 'numeric',
    hour12: false,
  }).format(new Date());
  const hour = Number(seoulHourStr) % 24;

  if (hour >= 0 && hour < 6) return 1;
  if (hour >= 6 && hour < 12) return 2;
  if (hour >= 12 && hour < 18) return 3;
  return 4;
}

/**
 * 단일 거점(WGS84 -> KATEC 변환) + 단일 유종 오피넷 반경 검색 API 호출
 */
async function fetchAroundAllByHubAndProd(
  apiKey: string,
  hub: Wgs84Hub,
  prodcd: string
): Promise<OpinetAroundOilItem[]> {
  const { x, y } = convertWgs84ToKatec(hub.lat, hub.lng);

  const response = await axios.get(OPINET_AROUND_ALL_URL, {
    params: {
      code: apiKey,
      x,
      y,
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
 * gas_station 테이블의 실제 컬럼 구조를 조회하여 안전하게 Upsert(누적 갱신) 쿼리를 구성 및 실행
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
    isPriceColumn: boolean;
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
          isPriceColumn: false,
          getValue: (s) => s.stationId,
        });
      } else if (['name', 'station_name', 'os_nm'].includes(fieldLower)) {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          isPriceColumn: false,
          getValue: (s) => s.name,
        });
      } else if (['brand', 'brand_code', 'poll_div_cd'].includes(fieldLower)) {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          isPriceColumn: false,
          getValue: (s) => s.brand,
        });
      } else if (fieldLower === 'brand_name') {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          isPriceColumn: false,
          getValue: (s) => BRAND_NAME_MAP[s.brand] || s.brand,
        });
      } else if (['address', 'addr', 'new_adr', 'van_adr'].includes(fieldLower)) {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          isPriceColumn: false,
          getValue: (s) => s.address ?? (col.Null === 'YES' ? null : ''),
        });
      } else if (fieldLower === 'road_type') {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          isPriceColumn: false,
          getValue: () => 'CITY',
        });
      } else if (['lat', 'latitude'].includes(fieldLower)) {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          isPriceColumn: false,
          getValue: (s) => s.lat,
        });
      } else if (['lng', 'lon', 'longitude'].includes(fieldLower)) {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          isPriceColumn: false,
          getValue: (s) => s.lng,
        });
      } else if (['gis_x_coor', 'katec_x', 'x_coor'].includes(fieldLower)) {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          isPriceColumn: false,
          getValue: (s) => s.katecX,
        });
      } else if (['gis_y_coor', 'katec_y', 'y_coor'].includes(fieldLower)) {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          isPriceColumn: false,
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
          isPriceColumn: false,
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
          isPriceColumn: true,
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
          isPriceColumn: true,
          getValue: (s) => s.premiumPrice ?? defaultNumeric,
        });
      } else if (['diesel_price', 'price_diesel', 'diesel', 'd047_price', 'd047'].includes(fieldLower)) {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          isPriceColumn: true,
          getValue: (s) => s.dieselPrice ?? defaultNumeric,
        });
      } else if (
        ['lpg_price', 'price_lpg', 'lpg', 'butane_price', 'k015_price', 'k015'].includes(fieldLower)
      ) {
        activeColumns.push({
          name: col.Field,
          isPrimaryKey: false,
          isSpatialPoint: false,
          isPriceColumn: true,
          getValue: (s) => s.lpgPrice ?? defaultNumeric,
        });
      }
    }
  }

  // 기본 컬럼 폴백 (SHOW COLUMNS 결과가 없을 경우)
  if (activeColumns.length === 0) {
    activeColumns.push(
      { name: 'station_id', isPrimaryKey: true, isSpatialPoint: false, isPriceColumn: false, getValue: (s) => s.stationId },
      { name: 'name', isPrimaryKey: false, isSpatialPoint: false, isPriceColumn: false, getValue: (s) => s.name },
      { name: 'brand', isPrimaryKey: false, isSpatialPoint: false, isPriceColumn: false, getValue: (s) => s.brand },
      {
        name: 'gasoline_price',
        isPrimaryKey: false,
        isSpatialPoint: false,
        isPriceColumn: true,
        getValue: (s) => s.gasolinePrice ?? 0,
      },
      {
        name: 'premium_price',
        isPrimaryKey: false,
        isSpatialPoint: false,
        isPriceColumn: true,
        getValue: (s) => s.premiumPrice ?? 0,
      },
      {
        name: 'diesel_price',
        isPrimaryKey: false,
        isSpatialPoint: false,
        isPriceColumn: true,
        getValue: (s) => s.dieselPrice ?? 0,
      },
      {
        name: 'lpg_price',
        isPrimaryKey: false,
        isSpatialPoint: false,
        isPriceColumn: true,
        getValue: (s) => s.lpgPrice ?? 0,
      },
      { name: 'lat', isPrimaryKey: false, isSpatialPoint: false, isPriceColumn: false, getValue: (s) => s.lat },
      { name: 'lng', isPrimaryKey: false, isSpatialPoint: false, isPriceColumn: false, getValue: (s) => s.lng },
      {
        name: 'location',
        isPrimaryKey: false,
        isSpatialPoint: true,
        isPriceColumn: false,
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
    .map((c) =>
      c.isPriceColumn
        ? `\`${c.name}\` = IF(VALUES(\`${c.name}\`) > 0, VALUES(\`${c.name}\`), \`${c.name}\`)`
        : `\`${c.name}\` = VALUES(\`${c.name}\`)`
    )
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
 * 전국 120개 거점(또는 지정된 Chunk 30개 거점) 반경 5000m 내 주유소 유종별 데이터를 수집/병합하여 gas_station 테이블에 누적 적재
 * @param options.chunk 1(1~30번), 2(31~60번), 3(61~90번), 4(91~120번), 또는 'all'(전체 120개 거점)
 */
export async function syncOpinetStations(options?: { chunk?: SyncChunkOption }): Promise<OpinetSyncResult> {
  if (activeSyncPromise) {
    console.log('[Opinet Sync] 이미 동기화 작업이 진행 중이므로 기존 작업을 대기합니다.');
    return activeSyncPromise;
  }

  const targetChunk: SyncChunkOption = options?.chunk ?? getCurrentRollingChunk();

  activeSyncPromise = (async () => {
    const apiKey = process.env.OPINET_API_KEY || process.env.OPINET_KEY;
    if (!apiKey) {
      throw new Error('OPINET_API_KEY 환경변수가 설정되어 있지 않습니다.');
    }

    const targetHubs = getHubsByChunk(targetChunk);
    console.log(
      `[Opinet Sync] Chunk=${targetChunk} (총 ${targetHubs.length}개 거점) 오피넷 데이터 수집을 시작합니다...`
    );

    const stationMap = new Map<string, MergedStationData>();

    for (let hIdx = 0; hIdx < targetHubs.length; hIdx++) {
      const hub = targetHubs[hIdx];

      for (const { prodcd, field } of OPINET_PROD_CODES) {
        try {
          const items = await fetchAroundAllByHubAndProd(apiKey, hub, prodcd);

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
              if (
                !Number.isFinite(lat) ||
                !Number.isFinite(lng) ||
                lat < 30 ||
                lat > 40 ||
                lng < 120 ||
                lng > 135
              ) {
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
        } catch (err) {
          console.error(`[Opinet Sync] 거점(${hub.name}) 유종(${prodcd}) 조회 실패:`, err);
        }

        // 오피넷 서버 차단 방지를 위한 요청 간 100ms 딜레이
        await delay(REQUEST_DELAY_MS);
      }

      if ((hIdx + 1) % 10 === 0 || hIdx === targetHubs.length - 1) {
        console.log(
          `[Opinet Sync] 진행 상황: ${hIdx + 1}/${targetHubs.length} 거점 완료 (현재 병합 주유소: ${stationMap.size}개)`
        );
      }
    }

    const mergedStations = Array.from(stationMap.values());
    console.log(
      `[Opinet Sync] Chunk=${targetChunk} 총 ${mergedStations.length}개 주유소 병합 완료. DB 누적 적재를 시작합니다...`
    );

    const upsertedCount = await upsertStationsToGasStationTable(mergedStations);
    const syncedAt = new Date().toISOString();

    console.log(
      `[Opinet Sync] Chunk=${targetChunk} gas_station 테이블 ${upsertedCount}건 적재/갱신 완료 (${syncedAt})`
    );

    return {
      chunk: targetChunk,
      hubCount: targetHubs.length,
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
 * 하루 4번 (00:00, 06:00, 12:00, 18:00 - Asia/Seoul 기준) Rolling Chunk 자동 동기화 스케줄러 등록
 * - 00시: Chunk 1 (1~30번 거점)
 * - 06시: Chunk 2 (31~60번 거점)
 * - 12시: Chunk 3 (61~90번 거점)
 * - 18시: Chunk 4 (91~120번 거점)
 */
export function startOpinetSyncScheduler(): void {
  if (isCronScheduled) {
    return;
  }

  cron.schedule(
    '0 0,6,12,18 * * *',
    async () => {
      const rollingChunk = getCurrentRollingChunk();
      console.log(
        `[Opinet Cron] 정기 오피넷 주유소 데이터 동기화 실행 (Asia/Seoul, Rolling Chunk=${rollingChunk})...`
      );
      try {
        await syncOpinetStations({ chunk: rollingChunk });
      } catch (error) {
        console.error(`[Opinet Cron] 정기 오피넷 동기화(Chunk=${rollingChunk}) 실패:`, error);
      }
    },
    {
      timezone: 'Asia/Seoul',
    }
  );

  isCronScheduled = true;
  console.log('[Opinet Cron] Rolling 스케줄러 등록 완료 (0 0,6,12,18 * * * / Asia/Seoul, 30개 거점씩 분할 실행)');
}
