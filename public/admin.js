// admin.js (관리자 페이지)

const ADMIN_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const ADMIN_ROOMS = [1, 2, 3, 4, 5];

let adminCode = null;
let adminClassSlots = []; // { room, hour }

function getToday() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function timeToMinutes(t) {
  if (!t || typeof t !== 'string') return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function isAdminClassSlot(room, hour) {
  return adminClassSlots.some(
    (s) => String(s.room) === String(room) && s.hour === hour
  );
}

// 관리자 시간표 렌더링
function renderAdminTimetable(date, reservations) {
  const grid = document.getElementById('admin-timetable');
  if (!grid) return;

  grid.innerHTML = '';

  // --- 헤더 행 ---
  const corner = document.createElement('div');
  corner.className = 'tt-header tt-corner';
  corner.textContent = '시간';
  grid.appendChild(corner);

  ADMIN_ROOMS.forEach((room) => {
    const h = document.createElement('div');
    h.className = 'tt-header';
    h.textContent = `연습실 ${room}`;
    grid.appendChild(h);
  });

  // --- (room-hour) → 예약 배열 매핑 ---
  const slotMap = {};

  (reservations || []).forEach((item) => {
    const room = item.room;
    if (!room) return;

    const rawStart = item.start || '';
    const rawEnd = item.end || item['end'] || '';

    if (!rawStart || !rawEnd) return;

    const startMin = timeToMinutes(rawStart);
    const endMin = timeToMinutes(rawEnd);

    ADMIN_HOURS.forEach((hour) => {
      const hourStart = hour * 60;
      const hourEnd = (hour + 1) * 60;

      if (startMin < hourEnd && endMin > hourStart) {
        const key = `${room}-${hour}`;
        if (!slotMap[key]) slotMap[key] = [];
        slotMap[key].push(item);
      }
    });
  });

  // --- 시간별 행 생성 ---
  ADMIN_HOURS.forEach((hour) => {
    const timeDiv = document.createElement('div');
    timeDiv.className = 'tt-time';
    timeDiv.textContent = `${String(hour).padStart(2, '0')}:00`;
    grid.appendChild(timeDiv);

    ADMIN_ROOMS.forEach((room) => {
      const cell = document.createElement('div');
      cell.className = 'tt-cell';

      const key = `${room}-${hour}`;
      const items = slotMap[key] || [];
      const isClass = isAdminClassSlot(room, hour);

      if (isClass) {
        // 수업 칸 (검은색)
        cell.classList.add('tt-block');

        if (items.length > 0) {
          // 수업 시간에 예약까지 들어간 경우 → 예약 정보 표시 + 취소 가능
          items.forEach((item) => {
            const rawName = item.student || '';
            const rawStart = item.start || '';
            const rawEnd = item.end || item['end'] || '';

            const startText =
              typeof rawStart === 'string' ? rawStart.slice(0, 5) : '';
            const endText =
              typeof rawEnd === 'string' ? rawEnd.slice(0, 5) : '';
            const name = typeof rawName === 'string' ? rawName : '';

            const line = document.createElement('div');
            line.className = 'tt-student';
            line.textContent = `${startText}~${endText} ${name || '예약됨'}`;
            cell.appendChild(line);

            // 마지막 예약 기준으로 취소 대상 정보 저장
            cell.dataset.id = item.id;
            cell.dataset.name = name || '예약';
            cell.dataset.time = timeDiv.textContent;
          });

          cell.classList.add('tt-busy');
          cell.addEventListener('click', onAdminSlotClick);
        } else {
          const labelDiv = document.createElement('div');
          labelDiv.className = 'tt-student';
          labelDiv.textContent = '수업';
          cell.appendChild(labelDiv);
        }
      } else if (items.length > 0) {
        // 예약 칸 (빨간색)
        cell.classList.add('tt-busy');

        items.forEach((item) => {
          const rawName = item.student || '';
          const rawStart = item.start || '';
          const rawEnd = item.end || item['end'] || '';

          const startText =
            typeof rawStart === 'string' ? rawStart.slice(0, 5) : '';
          const endText =
            typeof rawEnd === 'string' ? rawEnd.slice(0, 5) : '';
          const name = typeof rawName === 'string' ? rawName : '';

          const line = document.createElement('div');
          line.className = 'tt-student';
          line.textContent = `${startText}~${endText} ${name || '예약됨'}`;
          cell.appendChild(line);

          cell.dataset.id = item.id;
          cell.dataset.name = name || '예약';
          cell.dataset.time = timeDiv.textContent;
        });

        cell.addEventListener('click', onAdminSlotClick);
      } else {
        // 빈 칸
        cell.classList.add('tt-free');
      }

      grid.appendChild(cell);
    });
  });
}

// 날짜별 예약 + 블록 조회
async function loadAdminDay() {
  const dateInput = document.getElementById('admin-date');
  const msg = document.getElementById('admin-message');
  if (!dateInput) return;

  const date = dateInput.value;
  if (!date) return;

  msg.textContent = '예약을 불러오는 중입니다...';

  try {
    const [resRes, blocksRes] = await Promise.all([
      fetch(
        `/api/admin/reservations?date=${encodeURIComponent(date)}`
      ),
      fetch(`/api/blocks?date=${encodeURIComponent(date)}`),
    ]);

    let reservations = [];
    let blocks = [];

    try {
      reservations = await resRes.json();
    } catch {
      reservations = [];
    }

    try {
      blocks = await blocksRes.json();
    } catch {
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

    // blocks → adminClassSlots(room, hour)
    adminClassSlots = [];
    (blocks || []).forEach((b) => {
      const room = b.room;
      const start = b.start || '';
      const end = b.end || '';
      if (!room || !start || !end) return;

      const startMin = timeToMinutes(start);
      const endMin = timeToMinutes(end);

      const firstHour = Math.floor(startMin / 60);
      const lastHourExclusive = Math.ceil(endMin / 60);

      for (let h = firstHour; h < lastHourExclusive; h++) {
        adminClassSlots.push({ room, hour: h });
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
    msg.textContent = '예약을 불러오는 중 오류가 발생했습니다.';
  }
}

// 예약 칸 클릭 → 관리자 코드로 강제 취소
async function onAdminSlotClick(event) {
  const msg = document.getElementById('admin-message');
  const cell = event.currentTarget;

  const id = cell.dataset.id;
  const name = cell.dataset.name || '예약';
  const timeLabel = cell.dataset.time || '';

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

// 초기화
window.addEventListener('DOMContentLoaded', () => {
  adminCode = prompt('관리자 코드를 입력하세요:');
  if (!adminCode) {
    alert('관리자 코드가 없으면 취소 기능을 사용할 수 없습니다.');
  }

  const dateInput = document.getElementById('admin-date');
  if (dateInput) {
    dateInput.value = getToday();
    dateInput.addEventListener('change', loadAdminDay);
  }

  loadAdminDay();
});
async function updateClassTime() {
  const start = document.getElementById("classStart").value;
  const end = document.getElementById("classEnd").value;
  const adminCode = document.getElementById("adminCode").value;

  const response = await fetch("/api/class-times", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      newTimes: [{ start, end }],
      adminCode
    })
  });

  const result = await response.json();
  alert(result.message);
}
console.log(weekday, room, start, end);
