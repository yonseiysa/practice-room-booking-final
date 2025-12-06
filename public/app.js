// public/app.js

const dateInput = document.getElementById('date');
const loadBtn = document.getElementById('loadBtn');
const roomSelect = document.getElementById('room');
const startInput = document.getElementById('start');
const endInput = document.getElementById('end');
const studentInput = document.getElementById('student');
const messageEl = document.getElementById('message');
const timetableEl = document.getElementById('timetable');
const form = document.getElementById('reserveForm');

// 연습실 번호
const ROOMS = [1, 2, 3, 4, 5];

// 13:00 ~ 22:00, 1시간 간격
const TIME_SLOTS = generateTimeSlots('13:00', '22:00', 60);

let currentReservations = [];

// 시간 문자열 배열 만들기
function generateTimeSlots(start, end, stepMinutes) {
  const slots = [];
  let [h, m] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);

  while (h < eh || (h === eh && m < em)) {
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    slots.push(`${hh}:${mm}`);

    m += stepMinutes;
    if (m >= 60) {
      h += 1;
      m -= 60;
    }
  }

  return slots;
}

// timeStr("HH:MM")에 분 더하기
function addMinutes(timeStr, deltaMinutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m + deltaMinutes, 0, 0);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

window.addEventListener('DOMContentLoaded', () => {
  const today = new Date().toISOString().slice(0, 10);
  dateInput.value = today;

  loadReservations();

  loadBtn.addEventListener('click', (e) => {
    e.preventDefault();
    loadReservations();
  });

  form.addEventListener('submit', submitReservation);
});

// 예약 데이터 불러오기
async function loadReservations() {
  const date = dateInput.value;
  if (!date) return;

  messageEl.textContent = '';

  try {
    const res = await fetch(
      `/api/reservations?date=${encodeURIComponent(date)}`
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      messageEl.textContent =
        err.error || '예약 목록을 불러오는 중 오류가 발생했습니다.';
      messageEl.style.color = 'red';
      return;
    }

    const data = await res.json();
    currentReservations = data;

    renderTimetable();
  } catch (err) {
    console.error(err);
    messageEl.textContent = '서버와 통신 중 오류가 발생했습니다.';
    messageEl.style.color = 'red';
  }
}

// 시간표 그리기
function renderTimetable() {
  timetableEl.innerHTML = '';

  const table = document.createElement('div');
  table.className = 'timetable-table';

  // 왼쪽 위 코너
  const corner = document.createElement('div');
  corner.className = 'tt-header tt-corner';
  corner.textContent = '시간';
  table.appendChild(corner);

  // 상단 헤더: 연습실들
  ROOMS.forEach((room) => {
    const h = document.createElement('div');
    h.className = 'tt-header';
    h.textContent = `연습실 ${room}`;
    table.appendChild(h);
  });

  // 각 시간줄
  TIME_SLOTS.forEach((time, idx) => {
    // 시간 표시 셀
    const timeCell = document.createElement('div');
    timeCell.className = 'tt-time';
    timeCell.textContent = time;
    table.appendChild(timeCell);

    // 각 연습실 셀
    ROOMS.forEach((room) => {
      const cell = document.createElement('div');
      cell.className = 'tt-cell';

      const reservation = currentReservations.find((r) => {
        return (
          String(r.room) === String(room) &&
          r.start <= time &&
          r.end > time
        );
      });

      if (reservation) {
        // 이미 예약된 칸
        cell.classList.add('tt-busy');
        cell.innerHTML = `
          <div class="tt-student">${reservation.student}</div>
          <div class="tt-range">${reservation.start} ~ ${reservation.end}</div>
        `;

        // 이 칸 클릭 시: 취소 or 폼 채우기
        cell.addEventListener('click', () => {
          const ok = window.confirm(
            `학생: ${reservation.student}\n시간: ${reservation.start} ~ ${reservation.end}\n\n` +
              '이 예약을 취소하시겠습니까?\n\n' +
              '※ [확인] → 취소 시도 (관리코드 필요)\n' +
              '※ [취소] → 아래 예약 폼에 이 정보만 채우기'
          );

          if (ok) {
            // 취소 시도
            const code = window.prompt(
              '이 예약의 관리코드를 입력하세요.\n(처음 예약할 때 안내된 4자리 숫자)'
            );
            if (!code) return;
            cancelReservation(reservation.id, code);
          } else {
            // 변경을 위해 폼만 채워주기 (이후 사용자가 새로 예약)
            roomSelect.value = String(room);
            startInput.value = reservation.start;
            endInput.value = reservation.end;
            studentInput.value = reservation.student;
            studentInput.focus();
          }
        });
      } else {
        // 비어있는 칸
        cell.classList.add('tt-free');
        cell.textContent = '비어있음';

        cell.addEventListener('click', () => {
          roomSelect.value = String(room);
          startInput.value = time;

          const next = TIME_SLOTS[idx + 1] || addMinutes(time, 60);
          endInput.value = next;

          studentInput.focus();
        });
      }

      table.appendChild(cell);
    });
  });

  timetableEl.appendChild(table);
}

// 예약 취소 요청
async function cancelReservation(id, manageCode) {
  messageEl.textContent = '';

  try {
    const res = await fetch(`/api/reservations/${id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ manageCode }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      messageEl.textContent =
        data.error || '예약을 취소하는 중 오류가 발생했습니다.';
      messageEl.style.color = 'red';
      return;
    }

    messageEl.textContent = '예약이 취소되었습니다.';
    messageEl.style.color = 'green';

    // 취소 후 시간표 다시 새로고침
    loadReservations();
  } catch (err) {
    console.error(err);
    messageEl.textContent = '서버 오류가 발생했습니다.';
    messageEl.style.color = 'red';
  }
}

// 예약 폼 전송
async function submitReservation(e) {
  e.preventDefault();
  messageEl.textContent = '';

  const body = {
    room: roomSelect.value,
    date: dateInput.value,
    start: startInput.value,
    end: endInput.value,
    student: studentInput.value.trim(),
  };

  if (!body.date || !body.start || !body.end || !body.student) {
    messageEl.textContent = '모든 항목을 입력해주세요.';
    messageEl.style.color = 'red';
    return;
  }

  try {
    const res = await fetch('/api/reservations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      messageEl.textContent = data.error || '예약에 실패했습니다.';
      messageEl.style.color = 'red';
      return;
    }

    // 서버에서 되돌려준 관리코드 안내
    const code =
      data.manage_code || data.manageCode || '(코드 정보를 받지 못했습니다)';

    messageEl.innerHTML =
      '예약이 저장되었습니다.<br>' +
      `예약 관리코드: <strong>${code}</strong><br>` +
      '<small>※ 이 코드는 나중에 예약 변경/취소할 때 필요합니다. 꼭 메모하거나 사진을 찍어 두세요.</small>';

    studentInput.value = '';

    loadReservations();
  } catch (err) {
    console.error(err);
    messageEl.textContent = '서버 오류가 발생했습니다.';
    messageEl.style.color = 'red';
  }
}
