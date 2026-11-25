import axios from 'axios';
import proj4 from 'proj4';
import cron from 'node-cron';
import { pool } from '../config/db';

// 오피넷 KATEC 좌표계 정의 및 WGS84 좌표계 정의
const KATEC_PROJ =
  '+proj=tmerc +lat_0=38 +lon_0=128 +k=0.9999 +x_0=400000 +y_0=600000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43';
const WGS84_PROJ = 'EPSG:4326';

const OPINET_AROUND_ALL_URL = 'http://www.opinet.co.kr/api/aroundAll.do';
const DEFAULT_RADIUS = 5000;
const REQUEST_DELAY_MS = 90; // 80ms~100ms 딜레이 준수

export type FuelCodeOption = 'B027' | 'D047' | 'K015' | 'all';
export type SyncChunkOption = 1 | 2 | 3 | 4 | 'all';

export interface Wgs84Hub {
  name: string;
  lat: number;
  lng: number;
}

/**
 * 수도권 전역(서울·인천·경기도 31개 시/군 전체) 280개 위경도(WGS84) 거점 리스트
 * - 반경 5km(radius=5000) 검색으로 수도권 전체가 빈틈없이 커버되도록 설계
 *   1) 서울특별시 전역 (25개 자치구 전체 커버): 30개 거점
 *   2) 인천광역시 전역 (강화/영종 포함 주요 구 전체 커버): 20개 거점
 *   3) 경기도 31개 시/군 전역 (시내 중심부, 신도시, 택지지구 및 주요 고속도로/국도 라인): 230개 거점
 */
export const CAPITAL_AREA_WGS84_HUBS: Wgs84Hub[] = [
  // ============================================================================
  // [1] 서울특별시 전역 (25개 자치구 전체 커버: 30개 거점)
  // ============================================================================
  { name: '서울 종로구(광화문/종로)', lat: 37.5730, lng: 126.9794 },
  { name: '서울 중구(시청/을지로)', lat: 37.5641, lng: 126.9979 },
  { name: '서울 용산구(이태원/한강로)', lat: 37.5326, lng: 126.9904 },
  { name: '서울 성동구(성수/왕십리)', lat: 37.5509, lng: 127.0410 },
  { name: '서울 광진구(건대/구의)', lat: 37.5385, lng: 127.0823 },
  { name: '서울 동대문구(청량리/장안)', lat: 37.5744, lng: 127.0400 },
  { name: '서울 중랑구(면목/신내)', lat: 37.6066, lng: 127.0927 },
  { name: '서울 성북구(길음/장위)', lat: 37.5894, lng: 127.0167 },
  { name: '서울 강북구(미아/수유)', lat: 37.6396, lng: 127.0257 },
  { name: '서울 도봉구(창동/도봉)', lat: 37.6688, lng: 127.0471 },
  { name: '서울 노원구(상계/중계)', lat: 37.6542, lng: 127.0568 },
  { name: '서울 은평구(연신내/불광)', lat: 37.6027, lng: 126.9291 },
  { name: '서울 서대문구(신촌/홍제)', lat: 37.5791, lng: 126.9368 },
  { name: '서울 마포구(상암/합정)', lat: 37.5663, lng: 126.9016 },
  { name: '서울 양천구(목동/신정)', lat: 37.5170, lng: 126.8665 },
  { name: '서울 강서구(마곡/화곡)', lat: 37.5510, lng: 126.8495 },
  { name: '서울 강서구(김포공항/방화)', lat: 37.5658, lng: 126.8126 },
  { name: '서울 구로구(구로디지털/개봉)', lat: 37.4954, lng: 126.8874 },
  { name: '서울 금천구(가산/독산)', lat: 37.4569, lng: 126.8954 },
  { name: '서울 영등포구(여의도/문래)', lat: 37.5264, lng: 126.8962 },
  { name: '서울 동작구(노량진/사당)', lat: 37.5124, lng: 126.9393 },
  { name: '서울 관악구(신림/봉천)', lat: 37.4784, lng: 126.9516 },
  { name: '서울 서초구(서초/반포)', lat: 37.4919, lng: 127.0076 },
  { name: '서울 서초구(양재IC/내곡)', lat: 37.4633, lng: 127.0365 },
  { name: '서울 강남구(역삼/삼성)', lat: 37.5088, lng: 127.0473 },
  { name: '서울 강남구(수서/세곡)', lat: 37.4754, lng: 127.1025 },
  { name: '서울 송파구(잠실/방이)', lat: 37.5145, lng: 127.1066 },
  { name: '서울 송파구(문정/장지)', lat: 37.4842, lng: 127.1226 },
  { name: '서울 강동구(천호/길동)', lat: 37.5301, lng: 127.1238 },
  { name: '서울 강동구(고덕/강일IC)', lat: 37.5582, lng: 127.1685 },

  // ============================================================================
  // [2] 인천광역시 전역 (강화/영종 포함 주요 구 전체 커버: 20개 거점)
  // ============================================================================
  { name: '인천 중구(신포/연안부두)', lat: 37.4737, lng: 126.6217 },
  { name: '인천 중구(영종하늘도시)', lat: 37.4882, lng: 126.5594 },
  { name: '인천 중구(인천공항/운서)', lat: 37.4938, lng: 126.4881 },
  { name: '인천 중구(영종용유/을왕리)', lat: 37.4478, lng: 126.4032 },
  { name: '인천 동구(송림/만석)', lat: 37.4739, lng: 126.6432 },
  { name: '인천 미추홀구(주안/도화)', lat: 37.4636, lng: 126.6785 },
  { name: '인천 미추홀구(용현/학익)', lat: 37.4425, lng: 126.6505 },
  { name: '인천 연수구(연수/선학)', lat: 37.4192, lng: 126.6788 },
  { name: '인천 연수구(송도국제도시북부)', lat: 37.3948, lng: 126.6395 },
  { name: '인천 연수구(송도국제도시남부)', lat: 37.3695, lng: 126.6632 },
  { name: '인천 남동구(구월/간석)', lat: 37.4562, lng: 126.7052 },
  { name: '인천 남동구(논현/남동공단)', lat: 37.4055, lng: 126.7154 },
  { name: '인천 남동구(서창/장수IC)', lat: 37.4368, lng: 126.7495 },
  { name: '인천 부평구(부평역/산곡)', lat: 37.4935, lng: 126.7218 },
  { name: '인천 부평구(삼산/부평IC)', lat: 37.5152, lng: 126.7375 },
  { name: '인천 계양구(계산/작전)', lat: 37.5374, lng: 126.7378 },
  { name: '인천 계양구(귤현/계양IC)', lat: 37.5664, lng: 126.7542 },
  { name: '인천 서구(청라국제도시/가정)', lat: 37.5342, lng: 126.6538 },
  { name: '인천 서구(검단신도시/완정)', lat: 37.5948, lng: 126.6725 },
  { name: '인천 강화군(강화읍/초지대교)', lat: 37.7145, lng: 126.4982 },

  // ============================================================================
  // [3] 경기도 31개 시/군 전역 (230개 거점)
  // ============================================================================
  // 1. 성남시 (수정/중원/분당/판교/위례: 10개)
  { name: '경기 성남 수정구(신흥/태평)', lat: 37.4449, lng: 127.1389 },
  { name: '경기 성남 수정구(복정/위례남부)', lat: 37.4682, lng: 127.1395 },
  { name: '경기 성남 수정구(고등/시흥)', lat: 37.4258, lng: 127.0952 },
  { name: '경기 성남 중원구(모란/성남시청)', lat: 37.4201, lng: 127.1262 },
  { name: '경기 성남 중원구(상대원공단/갈현)', lat: 37.4315, lng: 127.1695 },
  { name: '경기 성남 분당구(야탑/이매)', lat: 37.4112, lng: 127.1288 },
  { name: '경기 성남 분당구(서현/수내)', lat: 37.3827, lng: 127.1189 },
  { name: '경기 성남 분당구(정자/미금/구미)', lat: 37.3515, lng: 127.1088 },
  { name: '경기 성남 판교(동판교/삼평/백현)', lat: 37.3948, lng: 127.1112 },
  { name: '경기 성남 판교(서판교/운중/대장)', lat: 37.3832, lng: 127.0715 },

  // 2. 수원시 (장안/권선/팔달/영통/광교: 10개)
  { name: '경기 수원 장안구(북수원/파장)', lat: 37.3095, lng: 126.9958 },
  { name: '경기 수원 장안구(정자/율전)', lat: 37.2962, lng: 126.9715 },
  { name: '경기 수원 권선구(권선/세류)', lat: 37.2505, lng: 127.0185 },
  { name: '경기 수원 권선구(서수원/호매실)', lat: 37.2685, lng: 126.9522 },
  { name: '경기 수원 권선구(고색/오목천)', lat: 37.2432, lng: 126.9688 },
  { name: '경기 수원 팔달구(수원역/행궁)', lat: 37.2682, lng: 127.0018 },
  { name: '경기 수원 팔달구(인계/우만)', lat: 37.2752, lng: 127.0325 },
  { name: '경기 수원 영통구(영통/망포)', lat: 37.2485, lng: 127.0652 },
  { name: '경기 수원 영통구(매탄/원천)', lat: 37.2695, lng: 127.0528 },
  { name: '경기 수원 영통구(광교신도시/동수원IC)', lat: 37.2925, lng: 127.0545 },

  // 3. 용인시 (처인/기흥/수지: 14개)
  { name: '경기 용인 처인구(김량장/역북/유림)', lat: 37.2415, lng: 127.2065 },
  { name: '경기 용인 처인구(포곡/에버랜드/용인IC)', lat: 37.2785, lng: 127.2188 },
  { name: '경기 용인 처인구(모현/능원/국도43호선)', lat: 37.3315, lng: 127.1985 },
  { name: '경기 용인 처인구(양지/양지IC/국도42호선)', lat: 37.2328, lng: 127.2845 },
  { name: '경기 용인 처인구(원삼/백암/죽산방면)', lat: 37.1642, lng: 127.3295 },
  { name: '경기 용인 처인구(이동읍/천리/송전)', lat: 37.1415, lng: 127.1965 },
  { name: '경기 용인 기흥구(신갈/신갈JC/기흥구청)', lat: 37.2745, lng: 127.1085 },
  { name: '경기 용인 기흥구(동백/초당)', lat: 37.2755, lng: 127.1528 },
  { name: '경기 용인 기흥구(보정/구성/마북)', lat: 37.3095, lng: 127.1125 },
  { name: '경기 용인 기흥구(영덕/흥덕/수원신갈IC)', lat: 37.2692, lng: 127.0842 },
  { name: '경기 용인 기흥구(공세/고매/기흥IC)', lat: 37.2295, lng: 127.1118 },
  { name: '경기 용인 수지구(풍덕천/죽전)', lat: 37.3245, lng: 127.0989 },
  { name: '경기 용인 수지구(성복/신봉)', lat: 37.3195, lng: 127.0685 },
  { name: '경기 용인 수지구(상현/동천)', lat: 37.3045, lng: 127.0752 },

  // 4. 화성시 (동탄1·2/병점/봉담/남양/향남/서부: 16개)
  { name: '경기 화성 동탄1신도시(반송/능동)', lat: 37.2065, lng: 127.0685 },
  { name: '경기 화성 동탄2북부(청계/영천/기흥동탄IC)', lat: 37.2135, lng: 127.1052 },
  { name: '경기 화성 동탄역(오산동/여울/방교)', lat: 37.1945, lng: 127.0915 },
  { name: '경기 화성 동탄2남부(산척/송동/장지)', lat: 37.1685, lng: 127.1088 },
  { name: '경기 화성 병점(진안/반월/태안)', lat: 37.2125, lng: 127.0395 },
  { name: '경기 화성 정남(정남IC/보통리)', lat: 37.1615, lng: 126.9885 },
  { name: '경기 화성 봉담(봉담신도시/와우리)', lat: 37.2185, lng: 126.9542 },
  { name: '경기 화성 매송/비봉(비봉IC/수인산업도로)', lat: 37.2425, lng: 126.8852 },
  { name: '경기 화성 남양읍(화성시청/남양뉴타운)', lat: 37.2015, lng: 126.8215 },
  { name: '경기 화성 마도/송산(마도공단/송산그린시티)', lat: 37.2188, lng: 126.7625 },
  { name: '경기 화성 서신(전곡항/제부도입구)', lat: 37.1785, lng: 126.6952 },
  { name: '경기 화성 팔탄(팔탄교차로/국도39호선)', lat: 37.1612, lng: 126.8925 },
  { name: '경기 화성 향남읍(향남1·2신도시)', lat: 37.1318, lng: 126.9206 },
  { name: '경기 화성 향남(발안IC/제약공단)', lat: 37.1125, lng: 126.9045 },
  { name: '경기 화성 양감(양감IC/초록로)', lat: 37.0815, lng: 126.9485 },
  { name: '경기 화성 우정/장안(조암/기아화성공장)', lat: 37.0615, lng: 126.8215 },

  // 5. 평택시 (남부/고덕/송탄/서부안중/포승: 12개)
  { name: '경기 평택 남부(평택역/합정)', lat: 36.9921, lng: 127.0925 },
  { name: '경기 평택 비전/용이(소사벌/안성IC인근)', lat: 37.0025, lng: 127.1325 },
  { name: '경기 평택 세교/지제역(세교공단/평택지제)', lat: 37.0185, lng: 127.0745 },
  { name: '경기 평택 팽성읍(안정리/객사리)', lat: 36.9665, lng: 127.0542 },
  { name: '경기 평택 고덕국제신도시(고덕/여염)', lat: 37.0435, lng: 127.0485 },
  { name: '경기 평택 송탄(서정리/이충/장당)', lat: 37.0650, lng: 127.0558 },
  { name: '경기 평택 진위(진위역/가곡/하북)', lat: 37.1052, lng: 127.0625 },
  { name: '경기 평택 청북읍(청북신도시/청북IC)', lat: 37.0485, lng: 126.9285 },
  { name: '경기 평택 오성(오성IC/숙성리)', lat: 37.0125, lng: 126.9785 },
  { name: '경기 평택 안중/현덕(안중/현화지구/국도39호선)', lat: 36.9765, lng: 126.9225 },
  { name: '경기 평택 포승읍(포승국가산단/서평택IC)', lat: 36.9825, lng: 126.8542 },
  { name: '경기 평택 포승(평택항/만호리)', lat: 36.9615, lng: 126.8425 },

  // 6. 안산시 (단원/상록/반월공단/대부도: 9개)
  { name: '경기 안산 단원구(고잔/중앙)', lat: 37.3219, lng: 126.8309 },
  { name: '경기 안산 단원구(초지/원곡)', lat: 37.3145, lng: 126.7985 },
  { name: '경기 안산 단원구(선부/서안산IC)', lat: 37.3425, lng: 126.8095 },
  { name: '경기 안산 단원구(성곡/반월국가산단)', lat: 37.3095, lng: 126.7625 },
  { name: '경기 안산 단원구(대부도/방아머리)', lat: 37.2452, lng: 126.5825 },
  { name: '경기 안산 상록구(사동/한양대ERICA)', lat: 37.2985, lng: 126.8425 },
  { name: '경기 안산 상록구(본오/상록수역)', lat: 37.3025, lng: 126.8685 },
  { name: '경기 안산 상록구(이동/일동)', lat: 37.3155, lng: 126.8595 },
  { name: '경기 안산 상록구(부곡/수암/안산IC)', lat: 37.3452, lng: 126.8685 },

  // 7. 고양시 (일산동구/일산서구/덕양구: 12개)
  { name: '경기 고양 일산동구(백석/마두/일산IC)', lat: 37.6485, lng: 126.7852 },
  { name: '경기 고양 일산동구(장항/정발산)', lat: 37.6584, lng: 126.7730 },
  { name: '경기 고양 일산동구(식사/풍동)', lat: 37.6745, lng: 126.8065 },
  { name: '경기 고양 일산동구(중산/고봉/설문)', lat: 37.6985, lng: 126.7925 },
  { name: '경기 고양 일산서구(주엽/대화)', lat: 37.6725, lng: 126.7525 },
  { name: '경기 고양 일산서구(탄현/덕이)', lat: 37.6952, lng: 126.7542 },
  { name: '경기 고양 일산서구(킨텍스/가좌/구산)', lat: 37.6785, lng: 126.7185 },
  { name: '경기 고양 덕양구(화정/행신/능곡)', lat: 37.6245, lng: 126.8327 },
  { name: '경기 고양 덕양구(원당/성사/주교)', lat: 37.6552, lng: 126.8385 },
  { name: '경기 고양 덕양구(삼송/원흥/스타필드)', lat: 37.6515, lng: 126.8925 },
  { name: '경기 고양 덕양구(향동/덕은/창릉)', lat: 37.6045, lng: 126.8852 },
  { name: '경기 고양 덕양구(관산/고양동/통일로)', lat: 37.7045, lng: 126.8985 },

  // 8. 남양주시 (다산/별내/진접/화도/와부: 11개)
  { name: '경기 남양주 다산신도시(지금/도농)', lat: 37.6125, lng: 127.1565 },
  { name: '경기 남양주 별내신도시(별내/별내IC)', lat: 37.6485, lng: 127.1265 },
  { name: '경기 남양주 갈매/퇴계원(퇴계원IC)', lat: 37.6425, lng: 127.1425 },
  { name: '경기 남양주 진건읍(사능/용정)', lat: 37.6585, lng: 127.1825 },
  { name: '경기 남양주 진접읍(진접지구/장현)', lat: 37.7185, lng: 127.1865 },
  { name: '경기 남양주 오남읍(오남/양지리)', lat: 37.6985, lng: 127.2045 },
  { name: '경기 남양주 호평/평내(평내호평역/국도46호선)', lat: 37.6531, lng: 127.2435 },
  { name: '경기 남양주 금곡/양정(남양주시청)', lat: 37.6360, lng: 127.2165 },
  { name: '경기 남양주 화도읍(마석/화도IC)', lat: 37.6515, lng: 127.3035 },
  { name: '경기 남양주 와부읍(덕소/팔당)', lat: 37.5845, lng: 127.2185 },
  { name: '경기 남양주 수동/조안(운길산/국도45호선)', lat: 37.6985, lng: 127.3185 },

  // 9. 파주시 (운정/금촌/문산/조리/자유로: 10개)
  { name: '경기 파주 운정신도시(와동/야당)', lat: 37.7185, lng: 126.7585 },
  { name: '경기 파주 운정서부(다율/교하)', lat: 37.7285, lng: 126.7225 },
  { name: '경기 파주 출판단지(문발/자유로IC)', lat: 37.7125, lng: 126.6925 },
  { name: '경기 파주 금촌(파주시청/아동)', lat: 37.7599, lng: 126.7802 },
  { name: '경기 파주 조리읍(봉일천/통일로)', lat: 37.7425, lng: 126.8095 },
  { name: '경기 파주 광탄(신산리/비암리)', lat: 37.7825, lng: 126.8525 },
  { name: '경기 파주 탄현(성동리/헤이리/통일동산)', lat: 37.7915, lng: 126.7025 },
  { name: '경기 파주 파주읍(연풍/월롱LG디스플레이)', lat: 37.8125, lng: 126.7852 },
  { name: '경기 파주 문산읍(문산/당동IC)', lat: 37.8585, lng: 126.7885 },
  { name: '경기 파주 법원/적성(국도37호선)', lat: 37.8525, lng: 126.8825 },

  // 10. 김포시 (한강신도시/풍무/고촌/양촌/통진: 9개)
  { name: '경기 김포 고촌읍(김포IC/신곡)', lat: 37.6015, lng: 126.7685 },
  { name: '경기 김포 사우/풍무(김포시청/풍무)', lat: 37.6152, lng: 126.7156 },
  { name: '경기 김포 걸포/운양(한강신도시동부)', lat: 37.6485, lng: 126.6885 },
  { name: '경기 김포 장기(한강신도시중부)', lat: 37.6442, lng: 126.6652 },
  { name: '경기 김포 구래/마산(한강신도시서부)', lat: 37.6425, lng: 126.6285 },
  { name: '경기 김포 양촌읍(양촌산단/학운산단)', lat: 37.6225, lng: 126.6185 },
  { name: '경기 김포 통진읍(마송/서암/국도48호선)', lat: 37.6885, lng: 126.5985 },
  { name: '경기 김포 대곶(율생/대명항)', lat: 37.6485, lng: 126.5625 },
  { name: '경기 김포 월곶/하성(전류리/김포북부)', lat: 37.7185, lng: 126.6325 },

  // 11. 부천시 (중동/상동/부천역/소사/오정/옥길: 7개)
  { name: '경기 부천 원미구(중동신도시/부천시청)', lat: 37.5034, lng: 126.7660 },
  { name: '경기 부천 원미구(상동/송내IC)', lat: 37.4985, lng: 126.7515 },
  { name: '경기 부천 원미구(부천역/심곡/춘의)', lat: 37.4885, lng: 126.7835 },
  { name: '경기 부천 소사구(소사본동/괴안/역곡)', lat: 37.4795, lng: 126.8025 },
  { name: '경기 부천 소사구(옥길지구/범박)', lat: 37.4665, lng: 126.8185 },
  { name: '경기 부천 오정구(원종/오정산단/부천IC)', lat: 37.5225, lng: 126.7885 },
  { name: '경기 부천 오정구(고강/삼정)', lat: 37.5265, lng: 126.8185 },

  // 12. 시흥시 (배곧/정왕/은계/목감/장현: 8개)
  { name: '경기 시흥 배곧신도시(배곧/정왕남부)', lat: 37.3685, lng: 126.7285 },
  { name: '경기 시흥 정왕(시화국가산단/오이도)', lat: 37.3452, lng: 126.7385 },
  { name: '경기 시흥 거북섬(시화MTV)', lat: 37.3225, lng: 126.6885 },
  { name: '경기 시흥 장현/능곡(시흥시청)', lat: 37.3800, lng: 126.8028 },
  { name: '경기 시흥 월곶/군자(월곶JC)', lat: 37.3885, lng: 126.7485 },
  { name: '경기 시흥 신천/대야(은계신도시/시흥IC)', lat: 37.4425, lng: 126.7885 },
  { name: '경기 시흥 매화/과림(매화산단)', lat: 37.4185, lng: 126.8185 },
  { name: '경기 시흥 목감신도시(조남JC/물왕)', lat: 37.3825, lng: 126.8585 },

  // 13. 안양시 (동안구 평촌/인덕원, 만안구 안양역/석수: 6개)
  { name: '경기 안양 동안구(평촌/범계/안양시청)', lat: 37.3943, lng: 126.9568 },
  { name: '경기 안양 동안구(인덕원/관양)', lat: 37.4015, lng: 126.9765 },
  { name: '경기 안양 동안구(비산/호계/평촌IC)', lat: 37.3785, lng: 126.9525 },
  { name: '경기 안양 만안구(안양역/안양일번가)', lat: 37.4018, lng: 126.9225 },
  { name: '경기 안양 만안구(박달/안양대교)', lat: 37.4085, lng: 126.9025 },
  { name: '경기 안양 만안구(석수/경수대로)', lat: 37.4285, lng: 126.9065 },

  // 14. 하남시 (미사/신장/감일/서하남IC: 6개)
  { name: '경기 하남 미사강변신도시(망월/풍산)', lat: 37.5625, lng: 127.1915 },
  { name: '경기 하남 신장/덕풍(하남시청/스타필드)', lat: 37.5393, lng: 127.2149 },
  { name: '경기 하남 천현/창우(하남IC/검단산)', lat: 37.5285, lng: 127.2352 },
  { name: '경기 하남 춘궁/초이(상산곡/국도43호선)', lat: 37.5085, lng: 127.1985 },
  { name: '경기 하남 감일신도시(감일/서하남IC)', lat: 37.5065, lng: 127.1625 },
  { name: '경기 하남 학암(위례하남)', lat: 37.4795, lng: 127.1525 },

  // 15. 광주시 (경안/태전/오포/초월/곤지암/퇴촌: 8개)
  { name: '경기 광주 경안/송정(광주시청/광주IC)', lat: 37.4294, lng: 127.2551 },
  { name: '경기 광주 태전/고산(태전지구/성남이천로)', lat: 37.3885, lng: 127.2285 },
  { name: '경기 광주 신현/능평(분당경계/국지도57호선)', lat: 37.3625, lng: 127.1685 },
  { name: '경기 광주 오포(문형/추자/매산)', lat: 37.3585, lng: 127.2185 },
  { name: '경기 광주 초월읍(쌍동/대쌍령/초월역)', lat: 37.3925, lng: 127.2925 },
  { name: '경기 광주 곤지암읍(곤지암IC/삼리)', lat: 37.3525, lng: 127.3425 },
  { name: '경기 광주 도척(진우리/곤지암리조트)', lat: 37.3185, lng: 127.3285 },
  { name: '경기 광주 퇴촌/남종(광동리/팔당호)', lat: 37.4685, lng: 127.3085 },

  // 16. 의정부시 (의정부역/민락/고산/신곡/호원: 6개)
  { name: '경기 의정부 의정부역(의정부동/가능)', lat: 37.7381, lng: 127.0437 },
  { name: '경기 의정부 신곡/장암(동부간선도로)', lat: 37.7215, lng: 127.0585 },
  { name: '경기 의정부 호원(회룡/망월사/의정부IC)', lat: 37.7125, lng: 127.0425 },
  { name: '경기 의정부 민락2지구(민락/낙양)', lat: 37.7465, lng: 127.0952 },
  { name: '경기 의정부 고산지구(고산/산곡)', lat: 37.7252, lng: 127.1085 },
  { name: '경기 의정부 녹양/자일(국도3호선/국도43호선)', lat: 37.7615, lng: 127.0452 },

  // 17. 양주시 (옥정/회천/고읍/주내/백석/장흥: 7개)
  { name: '경기 양주 양주시청(남방/마전)', lat: 37.7853, lng: 127.0458 },
  { name: '경기 양주 고읍/삼숭(고읍지구/만송)', lat: 37.7952, lng: 127.0825 },
  { name: '경기 양주 옥정신도시(옥정/율정)', lat: 37.8265, lng: 127.0925 },
  { name: '경기 양주 회천신도시(덕계/덕정)', lat: 37.8385, lng: 127.0625 },
  { name: '경기 양주 백석/광적(복지리/가납리)', lat: 37.8015, lng: 126.9885 },
  { name: '경기 양주 은현/남면(봉암/신산)', lat: 37.8785, lng: 127.0185 },
  { name: '경기 양주 장흥(일영/송추IC)', lat: 37.7225, lng: 126.9725 },

  // 18. 오산시 (오산시청/세교1·2/원동: 5개)
  { name: '경기 오산 오산시청(오산동/운암)', lat: 37.1499, lng: 127.0772 },
  { name: '경기 오산 원동/갈곶(오산IC/국도1호선)', lat: 37.1325, lng: 127.0725 },
  { name: '경기 오산 세교1신도시(금암/수청)', lat: 37.1752, lng: 127.0542 },
  { name: '경기 오산 세교2신도시(궐동/가수)', lat: 37.1565, lng: 127.0515 },
  { name: '경기 오산 부산동/양산동(동부대로)', lat: 37.1625, lng: 127.0885 },

  // 19. 이천시 (중리/부발/마장/장호원/호법: 7개)
  { name: '경기 이천 이천시청(중리/창전/증포)', lat: 37.2785, lng: 127.4425 },
  { name: '경기 이천 부발읍(아미리/SK하이닉스/이천IC)', lat: 37.2525, lng: 127.4885 },
  { name: '경기 이천 신둔/백사(수광리/국도3호선)', lat: 37.3125, lng: 127.4085 },
  { name: '경기 이천 마장(오천리/덕평IC)', lat: 37.2465, lng: 127.3585 },
  { name: '경기 이천 호법/모가(호법JC/남이천IC)', lat: 37.2025, lng: 127.4225 },
  { name: '경기 이천 대월/설성(초지리/성남이천로)', lat: 37.2125, lng: 127.5085 },
  { name: '경기 이천 장호원읍(감곡IC인근/국도38호선)', lat: 37.1185, lng: 127.6225 },

  // 20. 안성시 (시내/공도/대덕/원곡/죽산/일죽: 7개)
  { name: '경기 안성 안성시청(당왕/석정/옥산)', lat: 37.0080, lng: 127.2652 },
  { name: '경기 안성 대덕(내리/중앙대/국도38호선)', lat: 37.0125, lng: 127.2285 },
  { name: '경기 안성 공도읍(만정/진사/안성IC)', lat: 37.0025, lng: 127.1752 },
  { name: '경기 안성 원곡/양성(남안성IC/물류단지)', lat: 37.0485, lng: 127.1625 },
  { name: '경기 안성 미양/고삼(남안성JC/안성맞춤IC)', lat: 36.9685, lng: 127.2485 },
  { name: '경기 안성 보개/금광(가사동/안성동부)', lat: 37.0325, lng: 127.3185 },
  { name: '경기 안성 죽산/일죽(일죽IC/죽산교차로)', lat: 37.0825, lng: 127.4485 },

  // 21. 구리시 (인창/교문/갈매/토평: 4개)
  { name: '경기 구리 인창/교문(구리역/돌다리)', lat: 37.5985, lng: 127.1365 },
  { name: '경기 구리 수택/토평(구리시청/구리IC)', lat: 37.5842, lng: 127.1452 },
  { name: '경기 구리 갈매신도시(갈매/담터)', lat: 37.6315, lng: 127.1185 },
  { name: '경기 구리 아천(워커힐방면/강변북로)', lat: 37.5685, lng: 127.1225 },

  // 22. 포천시 (소흘/포천시청/가산/내촌/일동/영북: 7개)
  { name: '경기 포천 소흘읍(송우리/소흘IC)', lat: 37.8285, lng: 127.1425 },
  { name: '경기 포천 가산/내촌(가산리/국도87호선)', lat: 37.8385, lng: 127.2025 },
  { name: '경기 포천 선단/설운(대진대/선단IC)', lat: 37.8585, lng: 127.1625 },
  { name: '경기 포천 포천시청(신읍/어룡/포천IC)', lat: 37.8949, lng: 127.2003 },
  { name: '경기 포천 신북/군내(만세교/하성북)', lat: 37.9325, lng: 127.2125 },
  { name: '경기 포천 일동/이동(기산리/장암리/국도47호선)', lat: 37.9585, lng: 127.3185 },
  { name: '경기 포천 영중/영북(운천리/산정호수)', lat: 38.0585, lng: 127.2685 },

  // 23. 의왕시 (고천/내손/백운/부곡: 4개)
  { name: '경기 의왕 고천/오전(의왕시청/경수대로)', lat: 37.3448, lng: 126.9683 },
  { name: '경기 의왕 내손/포일(인덕원역남부)', lat: 37.3865, lng: 126.9825 },
  { name: '경기 의왕 청계/백운밸리(북의왕IC/학의JC)', lat: 37.3785, lng: 127.0125 },
  { name: '경기 의왕 부곡/삼동(의왕역/의왕ICD)', lat: 37.3215, lng: 126.9525 },

  // 24. 양평군 (양평읍/양서/서종/용문/지평: 7개)
  { name: '경기 양평 양평읍(양평군청/양근리)', lat: 37.4915, lng: 127.4875 },
  { name: '경기 양평 양서(양수리/국도6호선)', lat: 37.5425, lng: 127.3285 },
  { name: '경기 양평 옥천/아신(옥천리/아신역)', lat: 37.5185, lng: 127.4425 },
  { name: '경기 양평 서종(문호리/서종IC)', lat: 37.6025, lng: 127.3525 },
  { name: '경기 양평 강상/강하(교평리/양평IC)', lat: 37.4785, lng: 127.4685 },
  { name: '경기 양평 용문(다문리/용문역)', lat: 37.4885, lng: 127.5925 },
  { name: '경기 양평 지평/단월/청운(국도6호선동부)', lat: 37.5325, lng: 127.6885 },

  // 25. 여주시 (여주시청/오학/가남/능서/대신: 6개)
  { name: '경기 여주 여주시청(홍문/하동/교동)', lat: 37.2983, lng: 127.6374 },
  { name: '경기 여주 오학/현암(강북권역)', lat: 37.3125, lng: 127.6485 },
  { name: '경기 여주 연라/여주IC(여주프리미엄아울렛)', lat: 37.2452, lng: 127.6185 },
  { name: '경기 여주 세종대왕면(능서/왕대리/서여주IC)', lat: 37.3025, lng: 127.5785 },
  { name: '경기 여주 가남읍(태평리/국도3호선)', lat: 37.2025, lng: 127.5425 },
  { name: '경기 여주 대신/흥천(율촌리/동여주IC)', lat: 37.3685, lng: 127.5885 },

  // 26. 동두천시 (생연/지행/소요산: 3개)
  { name: '경기 동두천 지행/송내(동두천중앙)', lat: 37.8925, lng: 127.0552 },
  { name: '경기 동두천 생연/보산(구시가지)', lat: 37.9125, lng: 127.0585 },
  { name: '경기 동두천 상패/소요산(국도3호선북부)', lat: 37.9425, lng: 127.0625 },

  // 27. 과천시 (중앙/갈현/주암: 3개)
  { name: '경기 과천 중앙/별양(과천시청/정부청사)', lat: 37.4292, lng: 126.9877 },
  { name: '경기 과천 갈현(과천지식정보타운)', lat: 37.4125, lng: 126.9825 },
  { name: '경기 과천 과천동/주암(선바위/경마공원)', lat: 37.4515, lng: 127.0085 },

  // 28. 가평군 (가평읍/청평/설악/조종/북면: 5개)
  { name: '경기 가평 가평읍(읍내리/자라섬)', lat: 37.8315, lng: 127.5095 },
  { name: '경기 가평 청평(청평리/대성리/국도46호선)', lat: 37.7365, lng: 127.4165 },
  { name: '경기 가평 설악(신천리/설악IC)', lat: 37.6785, lng: 127.4925 },
  { name: '경기 가평 상면/조종(현리/아침고요수목원)', lat: 37.8185, lng: 127.3525 },
  { name: '경기 가평 북면(목동리/명지산)', lat: 37.8825, lng: 127.5425 },

  // 29. 연천군 (전곡/연천읍/청산: 3개)
  { name: '경기 연천 전곡읍(전곡리/은대리)', lat: 38.0252, lng: 127.0685 },
  { name: '경기 연천 연천읍(차탄리/연천군청)', lat: 38.0965, lng: 127.0752 },
  { name: '경기 연천 청산/백학(초성리/국도37호선)', lat: 37.9885, lng: 127.0885 },

  // 30. 광명시 (철산/하안/일직/소하: 4개)
  { name: '경기 광명 철산/광명동(광명시청/광명사거리)', lat: 37.4785, lng: 126.8646 },
  { name: '경기 광명 하안(하안사거리/범안로)', lat: 37.4625, lng: 126.8785 },
  { name: '경기 광명 소하(소하지구/서부간선)', lat: 37.4425, lng: 126.8852 },
  { name: '경기 광명 일직/가학(광명역KTX/광명IC)', lat: 37.4185, lng: 126.8825 },

  // 31. 군포시 (산본/금정/부곡/대야미: 4개)
  { name: '경기 군포 산본신도시(산본/군포시청)', lat: 37.3617, lng: 126.9352 },
  { name: '경기 군포 금정/당동(군포역/경수대로)', lat: 37.3585, lng: 126.9485 },
  { name: '경기 군포 부곡/당정(군포복합물류/동군포IC)', lat: 37.3352, lng: 126.9425 },
  { name: '경기 군포 대야미/속달(대야미역/국도47호선)', lat: 37.3285, lng: 126.9185 },
];

// 기존 코드와의 하위 호환성을 위한 별칭 export
export const NATIONWIDE_WGS84_HUBS = CAPITAL_AREA_WGS84_HUBS;

/**
 * 3대 유종 및 전담 API 키 매핑 정의
 * - 1번 키(OPINET_API_KEY): 보통휘발유(B027) -> gasoline_price (280 Call)
 * - 2번 키(OPINET_API_KEY_2): 자동차용경유(D047) -> diesel_price (280 Call)
 * - 3번 키(OPINET_API_KEY_3): 자동차용부탄 LPG(K015) -> lpg_price (280 Call)
 */
export const OPINET_PROD_CODES = [
  {
    prodcd: 'B027' as const,
    label: '보통휘발유',
    field: 'gasolinePrice' as const,
    envKeyName: 'OPINET_API_KEY' as const,
    getApiKey: (): string => (process.env.OPINET_API_KEY || process.env.OPINET_KEY || '').trim(),
  },
  {
    prodcd: 'D047' as const,
    label: '자동차용경유',
    field: 'dieselPrice' as const,
    envKeyName: 'OPINET_API_KEY_2' as const,
    getApiKey: (): string => (process.env.OPINET_API_KEY_2 || '').trim(),
  },
  {
    prodcd: 'K015' as const,
    label: '자동차용부탄(LPG)',
    field: 'lpgPrice' as const,
    envKeyName: 'OPINET_API_KEY_3' as const,
    getApiKey: (): string => (process.env.OPINET_API_KEY_3 || '').trim(),
  },
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
}

export interface MergedStationData {
  stationId: string;
  name: string;
  brand: string;
  roadType: 'HIGHWAY' | 'CITY';
  lat: number;
  lng: number;
  katecX: number;
  katecY: number;
  gasolinePrice: number;
  dieselPrice: number;
  lpgPrice: number;
}

export interface OpinetSyncResult {
  fuel: FuelCodeOption;
  syncedFuels: string[];
  skippedFuels: string[];
  hubCount: number;
  totalApiCalls: number;
  totalMergedStations: number;
  upsertedCount: number;
  syncedAt: string;
  chunk?: SyncChunkOption;
}

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
 * 주유소 상표코드(POLL_DIV_CD) 및 상호명(OS_NM) 기반으로 도로 유형(HIGHWAY / CITY) 판별
 */
function resolveRoadType(brandCode: string, stationName: string): 'HIGHWAY' | 'CITY' {
  if (
    brandCode === 'RTX' ||
    stationName.includes('고속도로') ||
    stationName.includes('휴게소') ||
    stationName.includes('(주)ex')
  ) {
    return 'HIGHWAY';
  }
  return 'CITY';
}

/**
 * 단일 거점(WGS84 -> KATEC 변환) + 단일 유종 오피넷 반경 검색(aroundAll.do) API 호출
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

/**
 * gas_station 테이블에 병합된 주유소 데이터를 Upsert(INSERT ... ON DUPLICATE KEY UPDATE)
 * - 컬럼: station_id, name, brand, road_type, gasoline_price, diesel_price, lpg_price, lat, lng, location, updated_at
 * - 가격 업데이트 시 기존에 저장된 다른 유종 가격이 0으로 덮어써지지 않도록 IF(VALUES(col) > 0, VALUES(col), col) 사용
 * - location 컬럼(SRID 4326)에는 ST_GeomFromText('POINT(위도 경도)', 4326) 순서로 적재
 */
async function upsertStationsToGasStationTable(stations: MergedStationData[]): Promise<number> {
  if (stations.length === 0) {
    return 0;
  }

  const BATCH_SIZE = 100;
  let upsertedCount = 0;

  const singleRowPlaceholder = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ST_GeomFromText(?, 4326), NOW())';
  const updateClause = `
    \`name\` = VALUES(\`name\`),
    \`brand\` = VALUES(\`brand\`),
    \`road_type\` = VALUES(\`road_type\`),
    \`gasoline_price\` = IF(VALUES(\`gasoline_price\`) > 0, VALUES(\`gasoline_price\`), \`gasoline_price\`),
    \`diesel_price\` = IF(VALUES(\`diesel_price\`) > 0, VALUES(\`diesel_price\`), \`diesel_price\`),
    \`lpg_price\` = IF(VALUES(\`lpg_price\`) > 0, VALUES(\`lpg_price\`), \`lpg_price\`),
    \`lat\` = VALUES(\`lat\`),
    \`lng\` = VALUES(\`lng\`),
    \`location\` = VALUES(\`location\`),
    \`updated_at\` = NOW()
  `;

  for (let i = 0; i < stations.length; i += BATCH_SIZE) {
    const batch = stations.slice(i, i + BATCH_SIZE);
    const valuesSql = batch.map(() => singleRowPlaceholder).join(', ');

    const sql = `
      INSERT INTO gas_station (
        \`station_id\`,
        \`name\`,
        \`brand\`,
        \`road_type\`,
        \`gasoline_price\`,
        \`diesel_price\`,
        \`lpg_price\`,
        \`lat\`,
        \`lng\`,
        \`location\`,
        \`updated_at\`
      )
      VALUES ${valuesSql}
      ON DUPLICATE KEY UPDATE ${updateClause}
    `;

    const params: (string | number)[] = [];
    for (const s of batch) {
      params.push(
        s.stationId,
        s.name,
        s.brand,
        s.roadType,
        s.gasolinePrice,
        s.dieselPrice,
        s.lpgPrice,
        s.lat,
        s.lng,
        `POINT(${s.lat} ${s.lng})`
      );
    }

    await pool.query(sql, params);
    upsertedCount += batch.length;
  }

  return upsertedCount;
}

let activeSyncPromise: Promise<OpinetSyncResult> | null = null;

/**
 * 수도권 전역 280개 거점 반경 5000m 내 주유소 3대 유종(B027, D047, K015) 데이터를
 * 3개 API 키로 1:1 전담 수집 후 UNI_ID 기준으로 병합하여 gas_station 테이블에 적재
 */
export async function syncOpinetStations(options?: {
  fuel?: FuelCodeOption;
  chunk?: SyncChunkOption;
}): Promise<OpinetSyncResult> {
  if (activeSyncPromise) {
    console.log('[Opinet Sync] 이미 동기화 작업이 진행 중이므로 기존 작업을 대기합니다.');
    return activeSyncPromise;
  }

  const targetFuel: FuelCodeOption = options?.fuel ?? 'all';

  activeSyncPromise = (async () => {
    const targetHubs = CAPITAL_AREA_WGS84_HUBS;

    // 요청된 유종(all 또는 단일 유종) 필터링
    const targetProdConfigs =
      targetFuel === 'all'
        ? OPINET_PROD_CODES
        : OPINET_PROD_CODES.filter((cfg) => cfg.prodcd === targetFuel);

    const activeConfigs: typeof OPINET_PROD_CODES[number][] = [];
    const skippedFuels: string[] = [];

    for (const cfg of targetProdConfigs) {
      const key = cfg.getApiKey();
      if (!key) {
        console.warn(
          `[Opinet Sync] 안내: 환경변수 ${cfg.envKeyName}가 등록되지 않아 ${cfg.label}(${cfg.prodcd}) 유종 수집을 건너뜁니다.`
        );
        skippedFuels.push(cfg.prodcd);
      } else {
        activeConfigs.push(cfg);
      }
    }

    if (activeConfigs.length === 0) {
      console.warn(
        `[Opinet Sync] 안내: 요청된 유종(${targetFuel})에 대해 사용할 수 있는 오피넷 API 키가 없어 수집을 종료합니다.`
      );
      return {
        fuel: targetFuel,
        syncedFuels: [],
        skippedFuels,
        hubCount: targetHubs.length,
        totalApiCalls: 0,
        totalMergedStations: 0,
        upsertedCount: 0,
        syncedAt: new Date().toISOString(),
        chunk: options?.chunk ?? 'all',
      };
    }

    console.log(
      `[Opinet Sync] 수도권 전역 ${targetHubs.length}개 거점 × ${activeConfigs.length}개 유종(${activeConfigs
        .map((c) => `${c.prodcd}:${c.envKeyName}`)
        .join(', ')}) 데이터 수집을 시작합니다...`
    );

    const stationMap = new Map<string, MergedStationData>();
    let totalApiCalls = 0;

    // 각 API 키가 전담 유종 1개에 대해 수도권 280개 거점을 순회 (키당 정확히 280 Call 소모)
    for (const cfg of activeConfigs) {
      const apiKey = cfg.getApiKey();
      console.log(
        `[Opinet Sync] [${cfg.prodcd} - ${cfg.label}] 전담 키(${cfg.envKeyName})로 ${targetHubs.length}개 거점 순회 시작...`
      );

      for (let hIdx = 0; hIdx < targetHubs.length; hIdx++) {
        const hub = targetHubs[hIdx];

        try {
          const items = await fetchAroundAllByHubAndProd(apiKey, hub, cfg.prodcd);
          totalApiCalls++;

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

              const name = String(item.OS_NM || '').trim();
              const brand = String(item.POLL_DIV_CD || 'ETC').trim();

              existing = {
                stationId: uniId,
                name,
                brand,
                roadType: resolveRoadType(brand, name),
                lat,
                lng,
                katecX,
                katecY,
                gasolinePrice: 0,
                dieselPrice: 0,
                lpgPrice: 0,
              };
              stationMap.set(uniId, existing);
            }

            if (Number.isFinite(price) && price > 0) {
              existing[cfg.field as PriceFieldKey] = Math.round(price);
            }
          }
        } catch (err) {
          console.error(`[Opinet Sync] 거점(${hub.name}) 유종(${cfg.prodcd}) 조회 실패:`, err);
        }

        // 연속 호출 시 오피넷 서버 부하 방지를 위한 90ms (80~100ms) 딜레이
        await delay(REQUEST_DELAY_MS);

        if ((hIdx + 1) % 40 === 0 || hIdx === targetHubs.length - 1) {
          console.log(
            `[Opinet Sync] [${cfg.prodcd}] 진행율: ${hIdx + 1}/${targetHubs.length} 거점 완료 (누적 병합 주유소: ${stationMap.size}개)`
          );
        }
      }
    }

    const mergedStations = Array.from(stationMap.values());
    console.log(
      `[Opinet Sync] 수도권 총 ${mergedStations.length}개 주유소 병합 완료 (총 API 호출: ${totalApiCalls}회). DB Upsert를 시작합니다...`
    );

    const upsertedCount = await upsertStationsToGasStationTable(mergedStations);
    const syncedAt = new Date().toISOString();

    console.log(
      `[Opinet Sync] gas_station 테이블 ${upsertedCount}건 적재/갱신 완료 (${syncedAt})`
    );

    return {
      fuel: targetFuel,
      syncedFuels: activeConfigs.map((c) => c.prodcd),
      skippedFuels,
      hubCount: targetHubs.length,
      totalApiCalls,
      totalMergedStations: mergedStations.length,
      upsertedCount,
      syncedAt,
      chunk: options?.chunk ?? 'all',
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
 * 매일 오전 09:10 (Asia/Seoul 기준) 하루 1회 수도권 전역(280개 거점) 3대 유종 자동 수집 스케줄러 등록
 */
export function startOpinetSyncScheduler(): void {
  if (isCronScheduled) {
    return;
  }

  cron.schedule(
    '10 9 * * *',
    async () => {
      console.log(
        '[Opinet Cron] 매일 09:10 정기 오피넷 수도권 전역(280개 거점, 3대 유종) 주유소 데이터 동기화 실행 (Asia/Seoul)...'
      );
      try {
        await syncOpinetStations({ fuel: 'all' });
      } catch (error) {
        console.error('[Opinet Cron] 정기 오피넷 동기화 실패:', error);
      }
    },
    {
      timezone: 'Asia/Seoul',
    }
  );

  isCronScheduled = true;
  console.log(
    '[Opinet Cron] 스케줄러 등록 완료 (10 9 * * * / Asia/Seoul, 매일 오전 09:10 수도권 280개 거점 하루 1회 실행)'
  );
}
