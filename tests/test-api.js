
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, db } = require('../server');

let server;
let baseUrl;
const testRollNo = `TEST-${Date.now()}`;

before(async () => {
    server = app.listen(0);

    await new Promise((resolve) => {
        server.once('listening', resolve);
    });

    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
});

test('TC-API-01: Health check API', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.status, 'OK');
});

test('TC-API-02: Add a student successfully', async () => {
    const response = await fetch(`${baseUrl}/api/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            roll_no: testRollNo,
            name: 'Jenkins Test Student',
            department: 'CSE'
        })
    });

    const data = await response.json();

    assert.equal(response.status, 201);
    assert.equal(data.message, 'Student added successfully');
});

test('TC-API-03: Prevent duplicate student roll number', async () => {
    const response = await fetch(`${baseUrl}/api/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            roll_no: testRollNo,
            name: 'Duplicate Student',
            department: 'CSE'
        })
    });

    const data = await response.json();

    assert.equal(response.status, 400);
    assert.equal(data.error, 'This roll number already exists');
});

after(async () => {
    await new Promise((resolve, reject) => {
        db.run(
            'DELETE FROM students WHERE roll_no = ?',
            [testRollNo],
            (err) => err ? reject(err) : resolve()
        );
    });

    await new Promise((resolve) => server.close(resolve));

    db.close();
});
