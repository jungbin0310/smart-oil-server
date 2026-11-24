import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { pool } from '../config/db';
import { DiscountCardRule, FuelType, InputType } from '../types/engine.types';
import { UpdateUserProfileRequest, UserProfileDto } from '../types/api.types';

export interface UserEntity {
  userId: number;
  kakaoId: string;
  nickname: string;
}

export const DEFAULT_USER_PROFILE = {
  fuelType: 'GASOLINE' as FuelType,
  officialEfficiency: 13.0,
  customEfficiency: null as number | null,
  appliedEfficiency: 13.0,
  recordCount: 0,
  inputType: 'FIXED_AMOUNT' as InputType,
  defaultAmountMoney: 50000,
  defaultAmountLiter: 30,
};

const tableColumnCache = new Map<string, Set<string>>();

async function getTableColumns(tableName: string): Promise<Set<string>> {
  const cached = tableColumnCache.get(tableName);
  if (cached) {
    return cached;
  }
  const [rows] = await pool.query<RowDataPacket[]>(`SHOW COLUMNS FROM \`${tableName}\``);
  const cols = new Set(rows.map((r) => String(r.Field).toLowerCase()));
  tableColumnCache.set(tableName, cols);
  return cols;
}

function parseTargetBrands(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
      if (typeof parsed === 'string') {
        return [parsed.trim()].filter(Boolean);
      }
    } catch {
      return trimmed
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function mapCardRow(row: RowDataPacket): DiscountCardRule {
  const cardId = Number(row.card_id ?? row.policy_id ?? row.id ?? 0);
  const cardName = String(row.card_name ?? row.policy_name ?? row.name ?? '');
  const discountTypeRaw = String(row.discount_type ?? 'PER_LITER').toUpperCase();
  const discountType: DiscountCardRule['discountType'] =
    discountTypeRaw === 'PERCENT' || discountTypeRaw === 'FLAT' ? discountTypeRaw : 'PER_LITER';

  return {
    cardId,
    cardName,
    targetBrands: parseTargetBrands(row.target_brands),
    discountType,
    discountValue: Number(row.discount_value ?? 0),
    maxDiscountLimit: Number(row.max_discount_limit ?? 0),
  };
}

/**
 * 카카오 ID 기준 users 테이블 Upsert 후 유저 정보 반환
 */
export async function upsertUserByKakaoId(kakaoId: string, nickname: string): Promise<UserEntity> {
  const cols = await getTableColumns('users');
  const pkCol = cols.has('user_id') ? 'user_id' : 'id';

  await pool.query<ResultSetHeader>(
    `
      INSERT INTO users (\`kakao_id\`, \`nickname\`)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE \`nickname\` = VALUES(\`nickname\`)
    `,
    [kakaoId, nickname]
  );

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT \`${pkCol}\` AS userId, \`kakao_id\` AS kakaoId, \`nickname\` FROM users WHERE \`kakao_id\` = ? LIMIT 1`,
    [kakaoId]
  );

  if (rows.length === 0) {
    throw new Error('사용자 정보를 생성 또는 조회하지 못했습니다.');
  }

  return {
    userId: Number(rows[0].userId),
    kakaoId: String(rows[0].kakaoId),
    nickname: String(rows[0].nickname),
  };
}

/**
 * discount_policy_master 전체 할인카드 목록 조회 (target_brands JSON 파싱 포함)
 */
export async function findAllDiscountCards(): Promise<DiscountCardRule[]> {
  const cols = await getTableColumns('discount_policy_master');
  const pkCol = cols.has('card_id') ? 'card_id' : cols.has('policy_id') ? 'policy_id' : 'id';

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM discount_policy_master ORDER BY \`${pkCol}\` ASC`
  );

  return rows.map(mapCardRow);
}

/**
 * 특정 사용자가 보유한 할인카드 목록 조회 (user_owned_discount JOIN discount_policy_master)
 */
export async function findUserOwnedCards(userId: number): Promise<DiscountCardRule[]> {
  const masterCols = await getTableColumns('discount_policy_master');
  const ownedCols = await getTableColumns('user_owned_discount');

  const masterPk = masterCols.has('card_id')
    ? 'card_id'
    : masterCols.has('policy_id')
      ? 'policy_id'
      : 'id';
  const ownedFk = ownedCols.has('card_id')
    ? 'card_id'
    : ownedCols.has('policy_id')
      ? 'policy_id'
      : 'discount_id';

  const [rows] = await pool.query<RowDataPacket[]>(
    `
      SELECT m.*
      FROM user_owned_discount uod
      INNER JOIN discount_policy_master m ON uod.\`${ownedFk}\` = m.\`${masterPk}\`
      WHERE uod.\`user_id\` = ?
      ORDER BY m.\`${masterPk}\` ASC
    `,
    [userId]
  );

  return rows.map(mapCardRow);
}

/**
 * 사용자 차량 프로필 + 보유 할인카드 조회
 */
export async function findUserProfile(userId: number): Promise<UserProfileDto> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM user_vehicle_profile WHERE \`user_id\` = ? LIMIT 1`,
    [userId]
  );

  const ownedCards = await findUserOwnedCards(userId);
  const ownedCardIds = ownedCards.map((c) => c.cardId);

  if (rows.length === 0) {
    return {
      userId,
      ...DEFAULT_USER_PROFILE,
      ownedCardIds,
      ownedCards,
    };
  }

  const row = rows[0];
  const officialEfficiency = Number(row.official_efficiency ?? DEFAULT_USER_PROFILE.officialEfficiency);
  const customEfficiencyRaw = row.custom_efficiency;
  const customEfficiency =
    customEfficiencyRaw !== null && customEfficiencyRaw !== undefined && Number(customEfficiencyRaw) > 0
      ? Number(customEfficiencyRaw)
      : null;
  const recordCount = Number(row.record_count ?? 0);
  const appliedEfficiency = customEfficiency ?? (officialEfficiency > 0 ? officialEfficiency : 13.0);

  const fuelType = (String(row.fuel_type || 'GASOLINE').toUpperCase() as FuelType) || 'GASOLINE';
  const inputType =
    String(row.input_type || 'FIXED_AMOUNT').toUpperCase() === 'FIXED_LITER'
      ? 'FIXED_LITER'
      : 'FIXED_AMOUNT';

  return {
    userId,
    fuelType,
    officialEfficiency,
    customEfficiency,
    appliedEfficiency,
    recordCount,
    inputType,
    defaultAmountMoney: Number(row.default_amount_money ?? DEFAULT_USER_PROFILE.defaultAmountMoney),
    defaultAmountLiter: Number(row.default_amount_liter ?? DEFAULT_USER_PROFILE.defaultAmountLiter),
    ownedCardIds,
    ownedCards,
  };
}

/**
 * 사용자 차량 프로필(user_vehicle_profile) 및 보유 할인카드(user_owned_discount) 저장/수정
 */
export async function upsertUserProfile(
  userId: number,
  payload: UpdateUserProfileRequest
): Promise<UserProfileDto> {
  const current = await findUserProfile(userId);
  const profileCols = await getTableColumns('user_vehicle_profile');
  const ownedCols = await getTableColumns('user_owned_discount');
  const ownedFk = ownedCols.has('card_id')
    ? 'card_id'
    : ownedCols.has('policy_id')
      ? 'policy_id'
      : 'discount_id';

  const fuelType = payload.fuelType ?? current.fuelType;
  const officialEfficiency =
    payload.officialEfficiency !== undefined && payload.officialEfficiency > 0
      ? Number(payload.officialEfficiency)
      : current.officialEfficiency;
  const customEfficiency =
    payload.customEfficiency !== undefined ? payload.customEfficiency : current.customEfficiency;
  const inputType = payload.inputType ?? current.inputType;
  const defaultAmountMoney =
    payload.defaultAmountMoney !== undefined && payload.defaultAmountMoney > 0
      ? Math.round(payload.defaultAmountMoney)
      : current.defaultAmountMoney;
  const defaultAmountLiter =
    payload.defaultAmountLiter !== undefined && payload.defaultAmountLiter > 0
      ? Number(payload.defaultAmountLiter)
      : current.defaultAmountLiter;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const insertCols: string[] = ['user_id'];
    const insertVals: (string | number | null)[] = [userId];
    const updateAssigns: string[] = [];

    const addField = (colName: string, val: string | number | null) => {
      if (profileCols.has(colName)) {
        insertCols.push(colName);
        insertVals.push(val);
        updateAssigns.push(`\`${colName}\` = VALUES(\`${colName}\`)`);
      }
    };

    addField('fuel_type', fuelType);
    addField('official_efficiency', officialEfficiency);
    addField('custom_efficiency', customEfficiency);
    addField('record_count', current.recordCount);
    addField('input_type', inputType);
    addField('default_amount_money', defaultAmountMoney);
    addField('default_amount_liter', defaultAmountLiter);

    const colSql = insertCols.map((c) => `\`${c}\``).join(', ');
    const placeholderSql = insertCols.map(() => '?').join(', ');

    await conn.query(
      `
        INSERT INTO user_vehicle_profile (${colSql})
        VALUES (${placeholderSql})
        ON DUPLICATE KEY UPDATE ${updateAssigns.join(', ')}
      `,
      insertVals
    );

    if (Array.isArray(payload.ownedCardIds)) {
      await conn.query(`DELETE FROM user_owned_discount WHERE \`user_id\` = ?`, [userId]);

      const uniqueCardIds = Array.from(
        new Set(payload.ownedCardIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))
      );

      if (uniqueCardIds.length > 0) {
        const placeholders = uniqueCardIds.map(() => '(?, ?)').join(', ');
        const params: number[] = [];
        for (const cardId of uniqueCardIds) {
          params.push(userId, cardId);
        }
        await conn.query(
          `INSERT INTO user_owned_discount (\`user_id\`, \`${ownedFk}\`) VALUES ${placeholders}`,
          params
        );
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return findUserProfile(userId);
}

/**
 * 주유 기록 기반 최근 5회 가중 이동평균 연비 계산 및 user_vehicle_profile 업데이트
 */
export async function updateEfficiencyWithFuelRecord(
  userId: number,
  drivenDistanceKm: number,
  fueledLiter: number
): Promise<{
  singleTripEfficiency: number;
  customEfficiency: number;
  recordCount: number;
}> {
  const current = await findUserProfile(userId);
  const singleTripEfficiency = Number((drivenDistanceKm / fueledLiter).toFixed(2));

  const prevCount = Math.max(0, current.recordCount);
  const prevBaseEfficiency =
    current.customEfficiency && current.customEfficiency > 0
      ? current.customEfficiency
      : current.officialEfficiency;

  // 최근 5회 가중 이동평균: 기존 기록 최대 4회 + 신규 1회 (총 윈도우 5회)
  const effectivePrevWeight = Math.min(prevCount, 4);
  const weightedMovingAvg =
    prevCount === 0
      ? singleTripEfficiency
      : (prevBaseEfficiency * effectivePrevWeight + singleTripEfficiency) / (effectivePrevWeight + 1);

  const newCustomEfficiency = Number(weightedMovingAvg.toFixed(2));
  const newRecordCount = prevCount + 1;

  const profileCols = await getTableColumns('user_vehicle_profile');
  const insertCols: string[] = ['user_id'];
  const insertVals: (string | number | null)[] = [userId];
  const updateAssigns: string[] = [];

  const addField = (colName: string, val: string | number | null) => {
    if (profileCols.has(colName)) {
      insertCols.push(colName);
      insertVals.push(val);
      updateAssigns.push(`\`${colName}\` = VALUES(\`${colName}\`)`);
    }
  };

  addField('fuel_type', current.fuelType);
  addField('official_efficiency', current.officialEfficiency);
  addField('custom_efficiency', newCustomEfficiency);
  addField('record_count', newRecordCount);
  addField('input_type', current.inputType);
  addField('default_amount_money', current.defaultAmountMoney);
  addField('default_amount_liter', current.defaultAmountLiter);

  const colSql = insertCols.map((c) => `\`${c}\``).join(', ');
  const placeholderSql = insertCols.map(() => '?').join(', ');

  await pool.query(
    `
      INSERT INTO user_vehicle_profile (${colSql})
      VALUES (${placeholderSql})
      ON DUPLICATE KEY UPDATE ${updateAssigns.join(', ')}
    `,
    insertVals
  );

  return {
    singleTripEfficiency,
    customEfficiency: newCustomEfficiency,
    recordCount: newRecordCount,
  };
}
