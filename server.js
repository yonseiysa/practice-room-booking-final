// server.js

const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();

// ------------------------------
//  PostgreSQL 연결 설정
// ------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// 서버 시작 시 테이블이 없으면 만들고, 컬럼도 보정
async function initDb() {
  // 기본 테이블 생성
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

  // 관리코드 컬럼 추가 (이미 있으면 무시)
  await pool.query(`
    ALTER TABLE reservations
    ADD COLUMN IF NOT EXISTS manage_code TEXT;
  `);

  console.log('DB 초기화 완료 (reservations 테이블 준비됨, manage_code 컬럼 포함)');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------------
//  날짜별 예약 조회
// ------------------------------
app.get('/api/reservations', async (req, res) => {
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
    // ⚠ manage_code는 여기서는 보내지 않음 (목록 조회엔 필요X)
    res.json(result.rows);
  } catch (err) {
    console.error('예약 목록 조회 중 오류:', err);
    res.status(500).json({ error: '예약 목록을 불러오는 중 오류가 발생했습니다.' });
  }
});

// ------------------------------
//  새 예약 추가
// ------------------------------
// body: { room, date, start, end, student }
app.post('/api/reservations', async (req, res) => {
  const { room, date, start, end, student } = req.body;

  if (!room || !date || !start || !end || !student) {
    return res.status(400).json({
      error:
        '모든 항목(연습실, 날짜, 시작시간, 끝시간, 학생이름)을 입력해주세요.',
    });
  }

  try {
    // 같은 연습실, 같은 날짜에서 시간 겹치는지 체크
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

    // 6자리 관리코드 생성
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

    const newRes = insertResult.rows[0];

    // 새 예약에는 manage_code를 포함시켜서 돌려보냄 (바로 안내용)
    res.json(newRes);
  } catch (err) {
    console.error('예약 저장 중 오류:', err);
    res
      .status(500)
      .json({ error: '예약을 저장하는 중 오류가 발생했습니다.' });
  }
});

// ------------------------------
//  예약 취소 (삭제)
// ------------------------------
// DELETE /api/reservations/:id
// body: { manageCode }
app.delete('/api/reservations/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { manageCode } = req.body || {};

  if (Number.isNaN(id)) {
    return res.status(400).json({ error: '잘못된 예약 ID입니다.' });
  }
  if (!manageCode) {
    return res.status(400).json({ error: '관리코드를 입력해주세요.' });
  }

  try {
    // 관리코드 확인
    const result = await pool.query(
      `SELECT manage_code FROM reservations WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: '예약을 찾을 수 없습니다.' });
    }

    const row = result.rows[0];

    if (!row.manage_code || row.manage_code !== manageCode) {
      return res
        .status(403)
        .json({ error: '관리코드가 일치하지 않습니다.' });
    }

    // 코드가 맞으면 삭제
    await pool.query(`DELETE FROM reservations WHERE id = $1`, [id]);

    res.json({ success: true });
  } catch (err) {
    console.error('예약 삭제 중 오류:', err);
    res
      .status(500)
      .json({ error: '예약을 삭제하는 중 오류가 발생했습니다.' });
  }
});

// ------------------------------
// 서버 실행
// ------------------------------
const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`서버 실행 중: 포트 ${PORT}에서 서버 실행 중`);
    });
  })
  .catch((err) => {
    console.error('DB 초기화 중 치명적 오류:', err);
    process.exit(1);
  });
