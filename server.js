// server.js
// 연세스트링아카데미 연습실 예약 시스템 (Render + PostgreSQL)

const express = require('express');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
// ------------------------------
//  수업시간표관리
// ------------------------------
let classTimes = [
  { start: "09:00", end: "12:00" }
];
app.get("/api/class-times", (req, res) => {
  res.json(classTimes);
});
app.post("/api/class-times", (req, res) => {
  const { newTimes, adminCode } = req.body;

  if (adminCode !== ADMIN_CODE) {
    return res.status(403).json({ message: "관리자 코드가 다릅니다" });
  }

  classTimes = newTimes;
  res.json({ message: "수업시간이 수정되었습니다" });
});
// ------------------------------
//  환경 변수
// ------------------------------
const ADMIN_CODE = process.env.ADMIN_CODE || '9999';
const DATABASE_URL = process.env.DATABASE_URL || '';
const PORT = process.env.PORT || 3000;

// ------------------------------
//  PostgreSQL 연결 설정
//  - Render Managed Postgres는 보통 SSL 필요
//  - 로컬(localhost)에서는 SSL 끄기
// ------------------------------
function shouldUseSsl(connectionString) {
  if (!connectionString) return false;
  return !(
    connectionString.includes('localhost') ||
    connectionString.includes('127.0.0.1')
  );
}

/** @type {Pool|null} */
let pool = null;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: shouldUseSsl(DATABASE_URL) ? { rejectUnauthorized: false } : false,
  });
} else {
  console.warn(
    '[WARN] DATABASE_URL이 설정되어 있지 않습니다. (Render 환경변수에 Postgres External Database URL을 넣어주세요)'
  );
}

// DB 준비 상태
let dbReady = false;
let dbLastError = null;
let dbInitAttempts = 0;

// ------------------------------
//  주간 수업 시간표 (class_schedule.csv에서 읽기)
//  weekday: 1=월, ..., 7=일
//  room: 연습실 번호
//  start, end: "HH:MM"
// ------------------------------
let weeklyLessons = []; // { weekday, room, start, end }

function loadWeeklyLessons() {
  const filePath = path.join(__dirname, 'class_schedule.csv');

  if (!fs.existsSync(filePath)) {
    console.log(
      'class_schedule.csv 파일이 없어 수업 블록 없이 동작합니다. (검은 칸 없음)'
    );
    weeklyLessons = [];
    return;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (!content) {
      weeklyLessons = [];
      console.log('class_schedule.csv 내용이 비어 있습니다.');
      return;
    }

    const lines = content.split(/\r?\n/);

    weeklyLessons = lines
      .slice(1)
      .map((line) => line.split(','))
      .map(([weekdayStr, roomStr, start, end]) => {
        const weekday = parseInt((weekdayStr || '').trim(), 10);
        const room = parseInt((roomStr || '').trim(), 10);
        return {
          weekday,
          room,
          start: (start || '').trim(),
          end: (end || '').trim(),
        };
      })
      .filter(
        (item) =>
          !Number.isNaN(item.weekday) &&
          !Number.isNaN(item.room) &&
          item.start &&
          item.end
      );

    console.log('주간 수업 시간표 로드 완료:', weeklyLessons);
  } catch (err) {
    console.error('class_schedule.csv 읽기 중 오류:', err);
    weeklyLessons = [];
  }
}

// 특정 날짜(YYYY-MM-DD)에 해당하는 수업 블록 가져오기
function getLessonsForDate(dateStr) {
  if (!weeklyLessons.length) return [];

  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return [];

  // JS: 0=일, 1=월, ... 6=토 → 1~7로 변환
  const jsDay = d.getDay();
  const weekday = jsDay === 0 ? 7 : jsDay;

  return weeklyLessons.filter((l) => l.weekday === weekday);
}

// ------------------------------
//  DB 초기화 (테이블/컬럼 준비)
//  - Render에서 DB 연결이 잠깐 불안정해도 서버 자체는 죽지 않도록 "재시도"로 구성
// ------------------------------
async function initDbOnce() {
  if (!pool) {
    throw new Error('DATABASE_URL이 설정되어 있지 않아 DB에 연결할 수 없습니다.');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reservations (
      id SERIAL PRIMARY KEY,
      room TEXT NOT NULL,
      date TEXT NOT NULL,   -- 'YYYY-MM-DD'
      start TEXT NOT NULL,  -- 'HH:MM'
      "end" TEXT NOT NULL,  -- 'HH:MM'
      student TEXT NOT NULL
    );
  `);

  await pool.query(`
    ALTER TABLE reservations
    ADD COLUMN IF NOT EXISTS manage_code TEXT;
  `);
}

function initDbWithRetry() {
  const attempt = async () => {
    dbInitAttempts += 1;
    try {
      await initDbOnce();
      dbReady = true;
      dbLastError = null;
      console.log('DB 초기화 완료 (reservations 테이블 + manage_code 컬럼)');
    } catch (err) {
      dbReady = false;
      dbLastError = err;
      const msg = err && err.message ? err.message : String(err);
      console.error(`[DB] 초기화 실패 (시도 ${dbInitAttempts}):`, msg);
      // 5초 후 재시도 (무한 재시도)
      setTimeout(attempt, 5000);
    }
  };

  attempt();
}

function requireDb(req, res, next) {
  if (dbReady) return next();
  const msg =
    dbLastError && dbLastError.message
      ? dbLastError.message
      : 'DB 연결이 준비되지 않았습니다.';
  return res.status(503).json({
    error:
      '서버가 DB에 연결 중입니다. 잠시 후 다시 시도해 주세요. (Render 환경변수 DATABASE_URL 확인 필요)',
    detail: msg,
  });
}

// ------------------------------
//  미들웨어 / 정적 파일
// ------------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 홈(학생 페이지) - static이 있어도 Render에서 라우팅이 애매할 때 대비해 명시
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 관리자 페이지
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 헬스 체크 (Render 로그/디버깅용)
app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    dbReady,
    dbInitAttempts,
    hasDatabaseUrl: Boolean(DATABASE_URL),
  });
});

// ------------------------------
//  관리자 API
// ------------------------------

// ------------------------------
//  관리자: 수업시간표 조회
// ------------------------------
app.get('/api/admin/class-schedule', (req, res) => {
  res.json(weeklyLessons);
});

// ------------------------------
//  관리자: 수업시간표 수정
// ------------------------------
app.post('/api/admin/class-schedule', (req, res) => {
  const { adminCode, lessons } = req.body || {};

  if (adminCode !== ADMIN_CODE) {
    return res.status(403).json({ error: '관리자 코드가 올바르지 않습니다.' });
  }

  if (!Array.isArray(lessons)) {
    return res.status(400).json({ error: 'lessons 배열이 필요합니다.' });
  }

  weeklyLessons = lessons.map(l => ({
    weekday: Number(l.weekday),
    room: Number(l.room),
    start: l.start,
    end: l.end,
  }));

  res.json({ success: true });
});
// 날짜별 예약 조회 (관리자용)
app.get('/api/admin/reservations', requireDb, async (req, res) => {
  const { date } = req.query;
  if (!date) {
    return res.status(400).json({ error: 'date 파라미터가 필요합니다.' });
  }

  try {
    const result = await pool.query(
      `
      SELECT *
      FROM reservations
      WHERE date = $1
      ORDER BY room, start
      `,
      [date]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('관리자 예약 조회 오류:', err);
    res.status(500).json({ error: '예약 조회 중 오류가 발생했습니다.' });
  }
});

// 관리자: 강제 취소
app.delete('/api/admin/reservations/:id', requireDb, async (req, res) => {
  const { adminCode } = req.body || {};
  const { id } = req.params;

  if (!adminCode) {
    return res.status(400).json({ error: '관리자 코드를 입력해 주세요.' });
  }
  if (adminCode !== ADMIN_CODE) {
    return res.status(403).json({ error: '관리자 코드가 올바르지 않습니다.' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM reservations WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: '해당 예약을 찾을 수 없습니다.' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('관리자 강제 취소 오류:', err);
    res.status(500).json({ error: '예약 취소 중 오류가 발생했습니다.' });
  }
});

// ------------------------------
//  학생/일반용 API
// ------------------------------

// 날짜별 예약 조회
app.get('/api/reservations', requireDb, async (req, res) => {
  const date = req.query.date;
  if (!date) {
    return res
      .status(400)
      .json({ error: 'date 파라미터가 필요합니다. (예: ?date=2025-12-05)' });
  }

  try {
    const result = await pool.query(
      `SELECT id, room, date, start, "end", student
       FROM reservations
       WHERE date = $1
       ORDER BY room, start`,
      [date]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('예약 목록 조회 중 오류:', err);
    res
      .status(500)
      .json({ error: '예약 목록을 불러오는 중 오류가 발생했습니다.' });
  }
});

// 날짜별 수업 블록(검은 칸) 조회 (DB 불필요)
app.get('/api/blocks', (req, res) => {
  const date = req.query.date;
  if (!date) {
    return res
      .status(400)
      .json({ error: 'date 파라미터가 필요합니다. (예: ?date=2025-12-05)' });
  }

  const blocks = getLessonsForDate(date).map((b) => ({
    room: String(b.room),
    date,
    start: b.start,
    end: b.end,
  }));

  res.json(blocks);
});

// 새 예약 추가
// body: { room, date, start, end, student }
app.post('/api/reservations', requireDb, async (req, res) => {
  const { room, date, start, end, student } = req.body || {};

  if (!room || !date || !start || !end || !student) {
    return res.status(400).json({
      error:
        '모든 항목(연습실, 날짜, 시작시간, 끝시간, 학생이름)을 입력해주세요.',
    });
  }

  if (end <= start) {
    return res.status(400).json({ error: '끝나는 시간이 시작 시간보다 빨라요.' });
  }

  try {
    // 1) 수업 블록과 겹치는지 체크
    const lessonBlocks = getLessonsForDate(date);
    const lessonConflict = lessonBlocks.find(
      (b) => String(b.room) === String(room) && !(end <= b.start || start >= b.end)
    );

    if (lessonConflict) {
      return res.status(400).json({
        error: '이 시간은 수업이 있어서 연습실을 예약할 수 없습니다.',
      });
    }

    // 2) 기존 예약과 겹치는지 체크
    const conflictResult = await pool.query(
      `
      SELECT 1
      FROM reservations
      WHERE room = $1
        AND date = $2
        AND NOT ("end" <= $3 OR start >= $4)
      LIMIT 1
      `,
      [room, date, start, end]
    );

    if (conflictResult.rowCount > 0) {
      return res.status(400).json({ error: '이미 예약이 있는 시간입니다.' });
    }

    // 4자리 관리코드 생성
    const manageCode = Math.floor(1000 + Math.random() * 9000).toString();

    // 예약 저장
    const insertResult = await pool.query(
      `
      INSERT INTO reservations (room, date, start, "end", student, manage_code)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, room, date, start, "end", student, manage_code
      `,
      [room, date, start, end, student, manageCode]
    );

    res.json(insertResult.rows[0]);
  } catch (err) {
    console.error('예약 저장 중 오류:', err);
    res.status(500).json({ error: '예약을 저장하는 중 오류가 발생했습니다.' });
  }
});

// 예약 취소 (학생 측: 관리코드 필요)
app.delete('/api/reservations/:id', requireDb, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { manageCode } = req.body || {};

  if (Number.isNaN(id)) {
    return res.status(400).json({ error: '잘못된 예약 ID입니다.' });
  }
  if (!manageCode) {
    return res.status(400).json({ error: '관리코드를 입력해주세요.' });
  }

  try {
    const result = await pool.query(
      `SELECT manage_code FROM reservations WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: '예약을 찾을 수 없습니다.' });
    }

    const row = result.rows[0];
    if (!row.manage_code || row.manage_code !== manageCode) {
      return res.status(403).json({ error: '관리코드가 일치하지 않습니다.' });
    }

    await pool.query(`DELETE FROM reservations WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('예약 삭제 중 오류:', err);
    res.status(500).json({ error: '예약을 삭제하는 중 오류가 발생했습니다.' });
  }
});

// ------------------------------
// 서버 실행
// ------------------------------
loadWeeklyLessons();

app.listen(PORT, () => {
  console.log(`서버 실행 중: 포트 ${PORT}에서 서버 실행 중`);
  initDbWithRetry();
});
