// admin.js

// 오늘 날짜 YYYY-MM-DD
function getToday() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function loadAdminReservations() {
  const dateInput = document.getElementById('admin-date');
  const date = dateInput.value;
  const tbody = document.getElementById('admin-reservations-body');
  const msg = document.getElementById('admin-message');

  if (!date) return;

  tbody.innerHTML = '';
  msg.textContent = '예약을 불러오는 중입니다...';

  try {
    const res = await fetch(
      `/api/admin/reservations?date=${encodeURIComponent(date)}`
    );
    let data = null;

    try {
      data = await res.json();
    } catch (e) {
      // JSON 파싱 실패해도 일단 진행
    }

    if (!res.ok) {
      msg.textContent =
        (data && data.error) ||
        `예약 조회 실패 (status ${res.status})`;
      return;
    }

    if (!data || data.length === 0) {
      msg.textContent = '해당 날짜에 예약이 없습니다.';
      return;
    }

    msg.textContent = '';

    data.forEach((item) => {
      const tr = document.createElement('tr');

      // 1) 이름 컬럼 후보들
      const rawName =
        item.student_name ||
        item.student ||
        item.name ||
        '';

      // 2) 시작/끝 시간 컬럼 후보들
      const rawStart =
        item.start_time ||
        item.start ||
        item.begin_time ||
        item.begin ||
        item.from_time ||
        '';

      const rawEnd =
        item.end_time ||
        item.end ||
        item.finish_time ||
        item.finish ||
        item.to_time ||
        '';

      // 3) 관리코드 후보들
      const rawCode =
        item.manage_code ||
        item.code ||
        '';

      // 문자열이 아니면 그냥 빈 문자열 처리
      const start =
        typeof rawStart === 'string'
          ? rawStart.slice(0, 5)
          : '';
      const end =
        typeof rawEnd === 'string'
          ? rawEnd.slice(0, 5)
          : '';

      const name =
        typeof rawName === 'string'
          ? rawName
          : '';
      const code =
        typeof rawCode === 'string'
          ? rawCode
          : '';

      tr.innerHTML = `
        <td>${start} ~ ${end}</td>
        <td>연습실 ${item.room}</td>
        <td>${name}</td>
        <td>${code}</td>
        <td>
          <button class="btn btn-primary btn-sm" data-id="${item.id}">
            강제 취소
          </button>
        </td>
      `;

      tbody.appendChild(tr);
    });

    // 강제 취소 버튼 이벤트
    tbody.querySelectorAll('button[data-id]').forEach((btn) => {
      btn.addEventListener('click', onForceCancel);
    });
  } catch (err) {
    console.error(err);
    msg.textContent = '예약을 불러오는 중 알 수 없는 오류가 발생했습니다.';
  }
}

async function onForceCancel(event) {
  const id = event.currentTarget.getAttribute('data-id');
  const msg = document.getElementById('admin-message');

  const adminCode = prompt('관리자 코드를 입력하세요:');
  if (!adminCode) return;

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
    loadAdminReservations(); // 목록 새로고침
  } catch (err) {
    console.error(err);
    msg.textContent = '취소 요청 중 오류가 발생했습니다.';
  }
}

// 초기화
window.addEventListener('DOMContentLoaded', () => {
  const dateInput = document.getElementById('admin-date');
  dateInput.value = getToday();

  dateInput.addEventListener('change', loadAdminReservations);

  loadAdminReservations();
});
