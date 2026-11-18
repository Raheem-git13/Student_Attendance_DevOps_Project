
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, db } = require('../server');

let server;
let driver;
let baseUrl;
let downloadDir;

const testRollNo = `SEL-${Date.now()}`;
const testStudentName = 'Selenium Test Student';
const testDepartment = 'CSE';

function todayString() {
    const date = new Date();
    const offset = date.getTimezoneOffset();

    return new Date(date.getTime() - offset * 60000)
        .toISOString().slice(0, 10);
}

const attendanceDate = todayString();
const reportMonth = attendanceDate.slice(0, 7);

// Find the test student's row, retrying if the table refreshes
async function findStudentRow() {
    for (let attempt = 0; attempt < 10; attempt++) {
        try {
            const rows = await driver.findElements(
                By.css('#studentTableBody tr')
            );

            for (const row of rows) {
                const text = await row.getText();

                if (text.includes(testRollNo)) {
                    return row;
                }
            }
        } catch (error) {
            if (error.name !== 'StaleElementReferenceError') {
                throw error;
            }
        }

        await new Promise(resolve => setTimeout(resolve, 300));
    }

    return false;
}

async function waitForStudentRow() {
    return driver.wait(
        async () => await findStudentRow(),
        15000,
        'Test student was not displayed'
    );
}

async function waitForReportRow() {
    return driver.wait(async () => {
        const rows = await driver.findElements(
            By.css('#reportTableBody tr')
        );

        for (const row of rows) {
            try {
                const text = await row.getText();

                if (text.includes(testRollNo)) {
                    return row;
                }
            } catch (error) {
                if (error.name !== 'StaleElementReferenceError') {
                    throw error;
                }
            }
        }

        return false;
    }, 15000, 'Student was not displayed in monthly report');
}

async function waitForMessage(elementId, expectedText) {
    await driver.wait(async () => {
        const message = await driver.findElement(By.id(elementId));
        return (await message.getText()).includes(expectedText);
    }, 15000);
}

// Start temporary server and Chrome
before(async () => {
    downloadDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'attendance-selenium-')
    );

    server = app.listen(0);

    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });

    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    const options = new chrome.Options();
    options.addArguments('--window-size=1440,1000');

    options.setUserPreferences({
        'download.default_directory': downloadDir,
        'download.prompt_for_download': false,
        'download.directory_upgrade': true,
        'safebrowsing.enabled': true
    });

    driver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();

    await driver.manage().setTimeouts({
        implicit: 0,
        pageLoad: 30000,
        script: 10000
    });

    await driver.get(baseUrl);

    await driver.wait(
        until.elementLocated(By.id('addStudentForm')),
        15000
    );
});

// TC-01: Student registration and listing
test('TC-01: Student registration and listing', async () => {
    await driver.findElement(By.id('rollNo')).sendKeys(testRollNo);
    await driver.findElement(By.id('studentName')).sendKeys(testStudentName);
    await driver.findElement(By.id('department')).sendKeys(testDepartment);

    await driver.findElement(
        By.css('#addStudentForm button[type="submit"]')
    ).click();

    await driver.wait(
        async () => {
            const row = await findStudentRow();
            return row !== false;
        },
        15000,
        'New student was not added'
    );

    const row = await waitForStudentRow();
    const text = await row.getText();

    assert.ok(text.includes(testRollNo));
    assert.ok(text.includes(testStudentName));
    assert.ok(text.includes(testDepartment));
});

// TC-02: Seven attendance periods
test('TC-02: Seven attendance periods displayed', async () => {
    const row = await waitForStudentRow();

    const buttons = await row.findElements(
        By.css('button.attendance-btn')
    );

    assert.equal(buttons.length, 7);
});

// TC-03: Mark all present and absent
test('TC-03: Mark All Present and Mark All Absent', async () => {
    await driver.findElement(By.id('markAllBtn')).click();

    let row = await waitForStudentRow();
    let buttons = await row.findElements(
        By.css('button.attendance-btn')
    );

    for (const button of buttons) {
        assert.equal(await button.getText(), 'Present');
    }

    await driver.findElement(By.id('markAllAbsentBtn')).click();

    row = await waitForStudentRow();
    buttons = await row.findElements(
        By.css('button.attendance-btn')
    );

    for (const button of buttons) {
        assert.equal(await button.getText(), 'Absent');
    }

    await driver.findElement(By.id('markAllBtn')).click();
});

// TC-04: Save attendance
test('TC-04: Save attendance successfully', async () => {
    await driver.findElement(By.id('saveAttendanceBtn')).click();

    await waitForMessage(
        'saveMessage',
        'Attendance saved successfully'
    );

    const message = await driver.findElement(
        By.id('saveMessage')
    ).getText();

    assert.ok(message.includes('Attendance saved successfully'));
});

// TC-05: Generate monthly report
test('TC-05: Generate monthly attendance report', async () => {
    const monthInput = await driver.findElement(By.id('reportMonth'));

    await monthInput.clear();
    await monthInput.sendKeys(reportMonth);

    await driver.findElement(By.id('generateReportBtn')).click();

    const row = await waitForReportRow();

    assert.ok((await row.getText()).includes(testRollNo));
});

// TC-06: Required field validation
test('TC-06: Required field validation', async () => {
    await driver.findElement(By.id('rollNo')).clear();
    await driver.findElement(By.id('studentName')).clear();
    await driver.findElement(By.id('department')).clear();

    const isValid = await driver.executeScript(
        'return document.getElementById("addStudentForm").checkValidity();'
    );

    assert.equal(isValid, false);

    await driver.findElement(By.id('rollNo')).sendKeys(testRollNo);
    await driver.findElement(By.id('studentName')).sendKeys(testStudentName);
    await driver.findElement(By.id('department')).sendKeys(testDepartment);
});

// TC-07: Repeated attendance save consistency
test('TC-07: Repeated attendance save consistency', async () => {
    await driver.findElement(By.id('markAllBtn')).click();

    await driver.findElement(By.id('saveAttendanceBtn')).click();

    await waitForMessage(
        'saveMessage',
        'Attendance saved successfully'
    );

    await driver.findElement(By.id('saveAttendanceBtn')).click();

    await waitForMessage(
        'saveMessage',
        'Attendance saved successfully'
    );

    const studentsResponse = await fetch(`${baseUrl}/api/students`);
    const students = await studentsResponse.json();

    const student = students.find(
        item => item.roll_no === testRollNo
    );

    assert.ok(student);

    const response = await fetch(
        `${baseUrl}/api/attendance?date=${attendanceDate}`
    );

    const records = await response.json();

    const studentRecords = records.filter(
        item => Number(item.student_id) === Number(student.id)
    );

    assert.equal(studentRecords.length, 7);

    const periods = new Set(
        studentRecords.map(item => Number(item.period))
    );

    assert.equal(periods.size, 7);
});

// TC-08: Monthly attendance totals
test('TC-08: Monthly attendance totals and percentage', async () => {
    await driver.findElement(By.id('generateReportBtn')).click();

    const row = await waitForReportRow();
    const cells = await row.findElements(By.css('td'));

    assert.equal(cells.length, 6);
    assert.equal(await cells[2].getText(), '7');
    assert.equal(await cells[3].getText(), '7');
    assert.equal(await cells[4].getText(), '0');

    const percentage = parseFloat(await cells[5].getText());

    assert.equal(percentage, 100);
});

// TC-09: CSV export
test('TC-09: Monthly report CSV export', async () => {
    await driver.findElement(By.id('generateReportBtn')).click();

    await waitForReportRow();

    await driver.findElement(By.id('exportCsvBtn')).click();

    let csvPath;

    for (let attempt = 0; attempt < 30; attempt++) {
        const files = fs.readdirSync(downloadDir);

        csvPath = files.includes('monthly-attendance-report.csv')
            ? path.join(downloadDir, 'monthly-attendance-report.csv')
            : null;

        if (
            csvPath &&
            !files.some(file => file.endsWith('.crdownload'))
        ) {
            break;
        }

        await new Promise(resolve => setTimeout(resolve, 500));
    }

    assert.ok(csvPath, 'CSV file was not downloaded');
    assert.ok(fs.existsSync(csvPath));

    const csvContent = fs.readFileSync(csvPath, 'utf8');

    assert.ok(csvContent.includes(testRollNo));
    assert.ok(csvContent.includes(testStudentName));
    assert.ok(csvContent.includes('Attendance Percentage'));
});

// TC-10: Data persistence after reload
test('TC-10: Attendance persistence after page reload', async () => {
    await driver.navigate().refresh();

    await driver.wait(
        until.elementLocated(By.id('studentTableBody')),
        15000
    );

    const row = await waitForStudentRow();

    assert.ok((await row.getText()).includes(testRollNo));

    const buttons = await row.findElements(
        By.css('button.attendance-btn')
    );

    assert.equal(buttons.length, 7);

    for (const button of buttons) {
        assert.equal(await button.getText(), 'Present');
    }

    const reportRow = await waitForReportRow();

    assert.ok((await reportRow.getText()).includes(testRollNo));
});

// Cleanup test data and close browser
after(async () => {
    if (driver) {
        await driver.quit();
    }

    if (server) {
        await new Promise(resolve => server.close(resolve));
    }

    if (db) {
        await new Promise((resolve, reject) => {
            db.run(
                `DELETE FROM attendance
                 WHERE student_id IN (
                     SELECT id FROM students WHERE roll_no = ?
                 )`,
                [testRollNo],
                err => err ? reject(err) : resolve()
            );
        });

        await new Promise((resolve, reject) => {
            db.run(
                'DELETE FROM students WHERE roll_no = ?',
                [testRollNo],
                err => err ? reject(err) : resolve()
            );
        });

        await new Promise((resolve, reject) => {
            db.close(err => err ? reject(err) : resolve());
        });
    }

    if (downloadDir && fs.existsSync(downloadDir)) {
        fs.rmSync(downloadDir, {
            recursive: true,
            force: true
        });
    }
});
