// admin.js

// 페이지 들어올 때 한 번만 관리자 코드 입력
let adminCode = null;

// 예약 페이지와 동일한 시간대 / 연습실 범위
const HOURS = [9,10,11,12,13,14,15,16,17,18,19,20,21];
const ROOMS = [1,2,3,4,5];

// 서버에서 받아온 수업 칸 목록 (room, hour)
let classSlots = [];

// 오늘 날짜 (YYYY-MM-DD)
function getToday() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// (room, hour)가 수업 칸인지 확인
function isClassSlotLocal(room, hour) {
  return classSlots.some(
    (s) => String(s.room) === String(room) && s.hour === hour
  );
}

// 관리자용 시간표 렌더링
function renderAdminTimetable(date, reservations) {
  const table = document.getElementById('admin-timetable');
  if (!table) return;
  table.innerHTML = '';

  // ----- 헤더 -----
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');

  const timeTh = document.createElement('th');
  timeTh.textContent = '시간';
  headRow.appendChild(timeTh);

  ROOMS.forEach((room) => {
    const th = document.createElement('th');
    th.textContent = `연습실 ${room}`;
    headRow.appendChild(th);
  });

  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  // (room-hour) → 예약 데이터 매핑
  const slotMap = {};

  (reservations || []).forEach((item) => {
    const room = item.room;
    if (!room) return;

    const rawStart = item.start || '';
    const rawEnd = item.end || item['end'] || '';

    if (!rawStart || !rawEnd) return;

    const startHour = parseInt(String(rawStart).slice(0, 2), 10);
    const endHour = parseInt(String(rawEnd).slice(0, 2), 10);

    for (let h = startHour; h < endHour; h++) {
      const key = `${room}-${h}`;
      slotMap[key] = item;
    }
  });

  // ----- 시간별 행 생성 -----
  HOURS.forEach((hour) => {
    const tr = document.createElement('tr');

    // 왼쪽 시간 표시
    const timeTd = document.createElement('td');
    timeTd.className = 'time-cell';
    timeTd.textContent = `${String(hour).padStart(2, '0')}:00`;
    tr.appendChild(timeTd);

    ROOMS.forEach((room) => {
      const td = document.createElement('td');
      td.className = 'slot-cell';

      const key = `${room}-${hour}`;
      const item = slotMap[key];
      const isClass = isClassSlotLocal(room, hour);

      if (isClass) {
        // === 수업 칸 (검은색) ===
        td.classList.add('slot-class');

        if (item) {
          // 수업시간 + 예약까지 있는 경우 → 예약정보 표시 + 클릭시 취소 가능
          const rawName = item.student || '';
          const rawStart = item.start || '';
          const rawEnd = item.end || item['end'] || '';

          const startText =
            typeof rawStart === 'string' ? rawStart.slice(0, 5) : '';
          const endText =
            typeof rawEnd === 'string' ? rawEnd.slice(0, 5) : '';
          const name =
            typeof rawName === 'string' ? rawName : '';

          td.innerHTML = `
            <div class="slot-main">${name || '예약됨'}</div>
            <div class="slot-sub">${startText} ~ ${endText}</div>
          `;
          td.dataset.id = item.id;
          td.dataset.name = name || '예약';
          td.dataset.time = timeTd.textContent;
          td.addEventListener('click', onSlotClick);
        } else {
          // 순수 수업 칸 → "수업" 표시, 클릭해도 아무 일 없음
          td.innerHTML = `<div class="slot-main">수업</div>`;
        }
      } else if (item) {
        // === 일반 예약 칸 (파란색) ===
        td.classList.add('slot-reserved');

        const rawName = item.student || '';
        const rawStart = item.start || '';
        const rawEnd = item.end || item['end'] || '';

        const startText =
          typeof rawStart === 'string' ? rawStart.slice(0, 5) : '';
        const endText =
          typeof rawEnd === 'string' ? rawEnd.slice(0, 5) : '';
        const name =
          typeof rawName === 'string' ? rawName : '';

        td.innerHTML = `
          <div class="slot-main">${name || '예약됨'}</div>
          <div class="slot-sub">${startText} ~ ${endText}</div>
        `;
        td.dataset.id = item.id;
        td.dataset.name = name || '예약';
        td.dataset.time = timeTd.textContent;
        td.addEventListener('click', onSlotClick);
      } else {
        // === 빈 칸 ===
        td.classList.add('slot-empty');
        td.textContent = '';
      }

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
}

// 날짜별 예약 + 수업칸 함께 불러오기
async function loadAdminDay() {
  const dateInput = document.getElementById('admin-date');
  const date = dateInput.value;
  const msg = document.getElementById('admin-message');

  if (!date) return;

  msg.textContent = '예약을 불러오는 중입니다...';

  try {
    const [resRes, blocksRes] = await Promise.all([
      fetch(`/api/admin/reservations?date=${encodeURIComponent(date)}`),
      fetch(`/api/blocks?date=${encodeURIComponent(date)}`),
    ]);

    let reservations = [];
    let blocks = [];

    try {
      reservations = await resRes.json();
    } catch (e) {
      reservations = [];
    }

    try {
      blocks = await blocksRes.json();
    } catch (e) {
      blocks = [];
    }

    if (!resRes.ok) {
      msg.textContent =
        (reservations && reservations.error) ||
        `예약 조회 실패 (status ${resRes.status})`;
      reservations = [];
    }

    if (!blocksRes.ok) {
      console.error('수업 블록 응답 오류:', blocks);
      blocks = [];
    }

    // blocks → classSlots(room, hour)로 변환
    classSlots = [];
    (blocks || []).forEach((b) => {
      const room = b.room;
      const start = b.start || '';
      const end = b.end || '';

      if (!room || !start || !end) return;

      const startHour = parseInt(String(start).slice(0, 2), 10);
      const endHour = parseInt(String(end).slice(0, 2), 10);

      for (let h = startHour; h < endHour; h++) {
        classSlots.push({ room, hour: h });
      }
    });

    renderAdminTimetable(date, reservations);

    if (!reservations || reservations.length === 0) {
      msg.textContent = '해당 날짜에 예약이 없습니다.';
    } else {
      msg.textContent = '';
    }
  } catch (err) {
    console.error(err);
    msg.textContent = '예약을 불러오는 중 알 수 없는 오류가 발생했습니다.';
  }
}

// 칸 클릭 → 강제 취소
async function onSlotClick(event) {
  const msg = document.getElementById('admin-message');
  const td = event.currentTarget;

  const id = td.dataset.id;
  const name = td.dataset.name;
  const timeLabel = td.dataset.time;

  if (!id) return;

  if (!adminCode) {
    alert('관리자 코드가 없습니다. 페이지를 새로고침해서 다시 로그인해 주세요.');
    return;
  }

  const ok = confirm(`${timeLabel} ${name} 예약을 취소할까요?`);
  if (!ok) return;

  try {
    const res = await fetch(`/api/admin/reservations/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminCode }),
    });

    const data = await res.json();

    if (!res.ok) {
      msg.textContent = data.error || '취소 중 오류가 발생했습니다.';
      return;
    }

    msg.textContent = '예약이 강제 취소되었습니다.';
    loadAdminDay();
  } catch (err) {
    console.error(err);
    msg.textContent = '취소 요청 중 오류가 발생했습니다.';
  }
}

// 초기화: 관리자 코드 입력 + 오늘 날짜 설정 + 첫 로딩
window.addEventListener('DOMContentLoaded', () => {
  adminCode = prompt('관리자 코드를 입력하세요:');
  if (!adminCode) {
    alert('관리자 코드가 없으면 취소 기능을 사용할 수 없습니다.');
  }

  const dateInput = document.getElementById('admin-date');
  if (!dateInput) return;

  dateInput.value = getToday();
  dateInput.addEventListener('change', loadAdminDay);

  loadAdminDay();
});
