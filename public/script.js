
const API = '/api';

let students = [];
let attendanceRecords = [];
let currentReport = [];

const $ = (id) => document.getElementById(id);

function todayString() {
    const date = new Date();
    const offset = date.getTimezoneOffset();

    return new Date(date.getTime() - offset * 60000)
        .toISOString().slice(0, 10);
}

function showMessage(message, type = 'success', target = 'saveMessage') {
    const element = $(target);

    if (!element) {
        console.log(message);
        return;
    }

    element.textContent = message;
    element.style.color = type === 'error' ? '#dc2626' : '#15803d';
}

async function apiRequest(url, options = {}) {
    const response = await fetch(API + url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });

    const text = await response.text();

    let data;

    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('Server returned an invalid response. Restart server.js.');
    }

    if (!response.ok) {
        throw new Error(data.error || 'Request failed');
    }

    return data;
}

// Attach the student form submit event
function ensureStudentForm() {
    const form = $('addStudentForm');

    if (!form) {
        console.error('Student form not found in index.html');
        return;
    }

    if (!form.dataset.submitBound) {
        form.addEventListener('submit', addStudent);
        form.dataset.submitBound = 'true';
    }
}

// Load all students
async function loadStudents() {
    try {
        students = await apiRequest('/students');

        renderStudentTable();
        updateStatistics();

    } catch (error) {
        showMessage(error.message, 'error');
    }
}

// Add a new student
async function addStudent(event) {
    event.preventDefault();

    const roll_no = $('rollNo').value.trim();
    const name = $('studentName').value.trim();
    const department = $('department').value.trim();

    if (!roll_no || !name || !department) {
        showMessage('Please fill in all student details.', 'error', 'studentMessage');
        return;
    }

    try {
        await apiRequest('/students', {
            method: 'POST',
            body: JSON.stringify({
                roll_no,
                name,
                department
            })
        });

        $('addStudentForm').reset();

        showMessage(
            'Student added successfully!',
            'success',
            'studentMessage'
        );

        await loadStudents();
        await loadAttendance();
        await generateReport();

    } catch (error) {
        showMessage(error.message, 'error', 'studentMessage');
    }
}

// Selected attendance date
function getSelectedDate() {
    return $('attendanceDate')?.value || todayString();
}

// Load attendance records
async function loadAttendance() {
    if (!students.length) {
        attendanceRecords = [];
        renderStudentTable();
        updateStatistics();
        return;
    }

    try {
        attendanceRecords = await apiRequest(
            '/attendance?date=' + encodeURIComponent(getSelectedDate())
        );

        renderStudentTable();
        updateStatistics();

    } catch (error) {
        showMessage(error.message, 'error');
    }
}

// Find a student's attendance status
function getStatus(studentId, period) {
    const record = attendanceRecords.find(item =>
        Number(item.student_id) === Number(studentId) &&
        Number(item.period) === Number(period)
    );

    return record ? record.status : '';
}

// Change attendance status
function setStatus(studentId, period, status) {
    const existing = attendanceRecords.find(item =>
        Number(item.student_id) === Number(studentId) &&
        Number(item.period) === Number(period)
    );

    if (existing) {
        existing.status = status;
    } else {
        attendanceRecords.push({
            student_id: Number(studentId),
            period: Number(period),
            status
        });
    }

    renderStudentTable();
    updateStatistics();
}

// Prevent HTML injection in student details
function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

// Display all students and seven periods
function renderStudentTable() {
    const tbody = $('studentTableBody');

    if (!tbody) return;

    tbody.innerHTML = '';

    if (!students.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10">No students added yet.</td>
            </tr>
        `;
        return;
    }

    students.forEach(student => {
        const row = document.createElement('tr');

        let html = `
            <td>${escapeHTML(student.roll_no)}</td>
            <td>${escapeHTML(student.name)}</td>
            <td>${escapeHTML(student.department)}</td>
        `;

        for (let period = 1; period <= 7; period++) {
            const status = getStatus(student.id, period);

            html += `
                <td>
                    <button
                        type="button"
                        class="attendance-btn ${status.toLowerCase() || 'unmarked'}"
                        data-student="${student.id}"
                        data-period="${period}">
                        ${status || '—'}
                    </button>
                </td>
            `;
        }

        row.innerHTML = html;
        tbody.appendChild(row);
    });

    tbody.querySelectorAll('.attendance-btn').forEach(button => {
        button.addEventListener('click', () => {
            const nextStatus =
                button.textContent.trim() === 'Present'
                    ? 'Absent'
                    : 'Present';

            setStatus(
                button.dataset.student,
                button.dataset.period,
                nextStatus
            );
        });
    });
}

// Mark all students present or absent
function markAll(status) {
    students.forEach(student => {
        for (let period = 1; period <= 7; period++) {
            const existing = attendanceRecords.find(record =>
                Number(record.student_id) === Number(student.id) &&
                Number(record.period) === period
            );

            if (existing) {
                existing.status = status;
            } else {
                attendanceRecords.push({
                    student_id: Number(student.id),
                    period,
                    status
                });
            }
        }
    });

    renderStudentTable();
    updateStatistics();
}

// Update dashboard statistics
function updateStatistics() {
    const total = students.length;

    const marked = attendanceRecords.filter(record =>
        record.status === 'Present' || record.status === 'Absent'
    );

    const present = marked.filter(record =>
        record.status === 'Present'
    ).length;

    const absent = marked.filter(record =>
        record.status === 'Absent'
    ).length;

    const percentage = marked.length
        ? (present / marked.length * 100).toFixed(1)
        : 0;

    if ($('totalStudents')) {
        $('totalStudents').textContent = total;
    }

    if ($('presentCount')) {
        $('presentCount').textContent = present;
    }

    if ($('absentCount')) {
        $('absentCount').textContent = absent;
    }

    if ($('attendancePercentage')) {
        $('attendancePercentage').textContent = percentage + '%';
    }
}

// Save attendance in SQLite
async function saveAttendance() {
    if (!students.length) {
        showMessage('Add students before saving attendance.', 'error');
        return;
    }

    if (!attendanceRecords.length) {
        showMessage('Please mark attendance first.', 'error');
        return;
    }

    try {
        await apiRequest('/attendance/bulk', {
            method: 'POST',
            body: JSON.stringify({
                attendance_date: getSelectedDate(),
                records: attendanceRecords
            })
        });

        showMessage('Attendance saved successfully!');

    } catch (error) {
        showMessage(error.message, 'error');
    }
}

// Generate monthly report
async function generateReport() {
    const month = $('reportMonth')?.value ||
        getSelectedDate().slice(0, 7);

    try {
        const data = await apiRequest(
            '/reports/monthly?month=' + encodeURIComponent(month)
        );

        currentReport = data.students || [];

        renderReport();

    } catch (error) {
        showMessage(error.message, 'error');
    }
}

// Display monthly report
function renderReport() {
    const tbody = $('reportTableBody');

    if (!tbody) return;

    tbody.innerHTML = '';

    if (!currentReport.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6">No student records found.</td>
            </tr>
        `;
        return;
    }

    currentReport.forEach(student => {
        const row = document.createElement('tr');

        row.innerHTML = `
            <td>${escapeHTML(student.roll_no)}</td>
            <td>${escapeHTML(student.name)}</td>
            <td>${student.working_periods}</td>
            <td>${student.present}</td>
            <td>${student.absent}</td>
            <td>${student.percentage}%</td>
        `;

        tbody.appendChild(row);
    });
}

// Export monthly report as CSV
function exportCSV() {
    if (!currentReport.length) {
        showMessage('Generate the monthly report first.', 'error');
        return;
    }

    const headings = [
        'Roll No',
        'Student Name',
        'Working Periods',
        'Present',
        'Absent',
        'Attendance Percentage'
    ];

    const rows = currentReport.map(student => [
        student.roll_no,
        student.name,
        student.working_periods,
        student.present,
        student.absent,
        student.percentage + '%'
    ]);

    const csv = [headings, ...rows]
        .map(row => row.map(value =>
            '"' + String(value).replace(/"/g, '""') + '"'
        ).join(','))
        .join('\n');

    const blob = new Blob([csv], {
        type: 'text/csv;charset=utf-8;'
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'monthly-attendance-report.csv';
    link.click();

    URL.revokeObjectURL(url);
}

// Start application
document.addEventListener('DOMContentLoaded', async () => {
    ensureStudentForm();

    if ($('attendanceDate')) {
        $('attendanceDate').value = todayString();
        $('attendanceDate').addEventListener('change', loadAttendance);
    }

    if ($('reportMonth')) {
        $('reportMonth').value = todayString().slice(0, 7);
    }

    if ($('markAllBtn')) {
        $('markAllBtn').addEventListener('click', () => {
            markAll('Present');
        });
    }

    if ($('markAllAbsentBtn')) {
        $('markAllAbsentBtn').addEventListener('click', () => {
            markAll('Absent');
        });
    }

    if ($('saveAttendanceBtn')) {
        $('saveAttendanceBtn').addEventListener('click', saveAttendance);
    }

    if ($('generateReportBtn')) {
        $('generateReportBtn').addEventListener('click', generateReport);
    }

    if ($('exportCsvBtn')) {
        $('exportCsvBtn').addEventListener('click', exportCSV);
    }

    await loadStudents();
    await loadAttendance();
    await generateReport();
});
