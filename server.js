
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database setup
const databaseFolder = path.join(__dirname, 'database');
fs.mkdirSync(databaseFolder, { recursive: true });

const db = new sqlite3.Database(
    path.join(databaseFolder, 'attendance.db'),
    (err) => {
        if (err) {
            console.error('Database connection failed:', err.message);
        } else {
            console.log('Connected to SQLite database!');
        }
    }
);

// Create tables
db.serialize(() => {
    db.run('PRAGMA foreign_keys = ON');

    db.run(`
        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            roll_no TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            department TEXT NOT NULL
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            attendance_date TEXT NOT NULL,
            period INTEGER NOT NULL CHECK(period BETWEEN 1 AND 7),
            status TEXT NOT NULL CHECK(status IN ('Present', 'Absent')),
            FOREIGN KEY(student_id) REFERENCES students(id),
            UNIQUE(student_id, attendance_date, period)
        )
    `);
});

// API health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'API is working' });
});

// Get students
app.get('/api/students', (req, res) => {
    db.all(
        'SELECT * FROM students ORDER BY id',
        [],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json(rows);
        }
    );
});

// Add student
app.post('/api/students', (req, res) => {
    const roll_no = String(req.body.roll_no || '').trim();
    const name = String(req.body.name || '').trim();
    const department = String(req.body.department || '').trim();

    if (!roll_no || !name || !department) {
        return res.status(400).json({
            error: 'Please enter roll number, student name and department'
        });
    }

    db.run(
        `INSERT INTO students (roll_no, name, department)
         VALUES (?, ?, ?)`,
        [roll_no, name, department],
        function (err) {
            if (err) {
                return res.status(400).json({
                    error: err.message.includes('UNIQUE')
                        ? 'This roll number already exists'
                        : err.message
                });
            }

            res.status(201).json({
                message: 'Student added successfully',
                id: this.lastID
            });
        }
    );
});

// Get attendance for a date
app.get('/api/attendance', (req, res) => {
    const date = req.query.date;

    if (!date) {
        return res.status(400).json({ error: 'Date is required' });
    }

    db.all(
        `SELECT student_id, period, status
         FROM attendance
         WHERE attendance_date = ?
         ORDER BY student_id, period`,
        [date],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json(rows);
        }
    );
});

// Save attendance
app.post('/api/attendance/bulk', (req, res) => {
    const { attendance_date, records } = req.body;

    if (!attendance_date || !Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ error: 'Invalid attendance data' });
    }

    const valid = records.every(record =>
        Number.isInteger(Number(record.student_id)) &&
        Number(record.student_id) > 0 &&
        Number.isInteger(Number(record.period)) &&
        Number(record.period) >= 1 &&
        Number(record.period) <= 7 &&
        ['Present', 'Absent'].includes(record.status)
    );

    if (!valid) {
        return res.status(400).json({ error: 'Invalid attendance record' });
    }

    db.serialize(() => {
        db.run('BEGIN TRANSACTION', (beginError) => {
            if (beginError) {
                return res.status(500).json({ error: beginError.message });
            }

            const statement = db.prepare(`
                INSERT INTO attendance
                (student_id, attendance_date, period, status)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(student_id, attendance_date, period)
                DO UPDATE SET status = excluded.status
            `);

            let completed = 0;
            let saveError = null;

            const finish = () => {
                if (completed !== records.length) return;

                statement.finalize((finalizeError) => {
                    saveError = saveError || finalizeError;

                    if (saveError) {
                        return db.run('ROLLBACK', () => {
                            res.status(500).json({ error: saveError.message });
                        });
                    }

                    db.run('COMMIT', (commitError) => {
                        if (commitError) {
                            return db.run('ROLLBACK', () => {
                                res.status(500).json({ error: commitError.message });
                            });
                        }

                        res.json({ message: 'Attendance saved successfully' });
                    });
                });
            };

            records.forEach(record => {
                statement.run(
                    [
                        Number(record.student_id),
                        attendance_date,
                        Number(record.period),
                        record.status
                    ],
                    (err) => {
                        if (err && !saveError) saveError = err;
                        completed++;
                        finish();
                    }
                );
            });
        });
    });
});

// Monthly report
app.get('/api/reports/monthly', (req, res) => {
    const month = req.query.month;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ error: 'Month must be YYYY-MM' });
    }

    db.all(
        `SELECT
            s.roll_no,
            s.name,
            COUNT(a.id) AS working_periods,
            SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) AS present,
            SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) AS absent
         FROM students s
         LEFT JOIN attendance a
            ON s.id = a.student_id
            AND substr(a.attendance_date, 1, 7) = ?
         GROUP BY s.id
         ORDER BY s.id`,
        [month],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            const students = rows.map(row => {
                const total = row.working_periods || 0;
                const present = row.present || 0;
                const absent = row.absent || 0;

                return {
                    roll_no: row.roll_no,
                    name: row.name,
                    working_periods: total,
                    present,
                    absent,
                    percentage: total
                        ? Number((present / total * 100).toFixed(2))
                        : 0
                };
            });

            res.json({ students });
        }
    );
});

// Serve the frontend after API routes
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}

module.exports = { app, db };
