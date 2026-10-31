// Students dashboard + supervisor access suite: boots app.js against an in-memory MongoDB
// in production mode and drives it over HTTP. Run: npm run test:dashboard
process.env.NODE_ENV = 'production';
process.env.JWT_SECRET_KEY = 'dashboard-test-secret-'.repeat(3);
process.env.JWT_EXPIRES_IN = '1d';
process.env.DOMAIN_ACTIVE = 'local';
process.env.DOMAIN_LOCAL = process.env.DOMAIN_RENDER = 'http://127.0.0.1';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const path = require('path');
const r = p => require(path.join(__dirname, '..', p));

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push([true, name]); } catch(err) { results.push([false, name, err.message]); }
};
const assert = (cond, msg) => { if(!cond) throw new Error(msg); };
const sleep = ms => new Promise(res => setTimeout(res, ms));

(async () => {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const app = r('app.js');
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const User = r('models/userModel'), Subcourse = r('models/subcourseModel'), Lesson = r('models/lessonModel'),
    Question = r('models/questionModel'), StudentGroup = r('models/studentGroupModel'), QuizAttempt = r('models/quizAttemptModel'),
    GeneralTest = r('models/generalTestModel'), TestAttempt = r('models/testAttemptModel');

  let last = 0;
  const call = async (method, url, { body, cookie } = {}) => {
    const wait = last + 450 - Date.now(); if(wait > 0) await sleep(wait); last = Date.now();
    const res = await fetch(base + url, { method, redirect: 'manual',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch {}
    return { status: res.status, text, json };
  };
  const ok = res => res.status < 300 && (!res.json || res.json.status === 'success');

  // fixtures
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Damascus' }).format(new Date());
  const yearsAgo = n => `${+today.slice(0, 4) - n}${today.slice(4)}`;
  let phone = 0;
  const mkUser = (name, extra = {}) => User.create({ name, email: `${name}@t.com`, password: 'password1', passwordConfirm: 'password1',
    studentId: `09${String(10000000 + phone++)}`, parentPhone: `09${String(20000000 + phone++)}`, dob: '2008-01-15', referral: 'friend', telegramJoined: true, ...extra });
  const cookieOf = u => `jwtStudyou=${jwt.sign({ id: u._id }, process.env.JWT_SECRET_KEY)}`;

  const adminU = await mkUser('adminx', { role: 'admin' });
  const supA = await mkUser('superA', { role: 'supervisor' });
  const supB = await mkUser('superB', { role: 'supervisor' });
  const s1 = await mkUser('alphaone', { dob: yearsAgo(16) });
  const s2 = await mkUser('betatwo');
  const s3 = await mkUser('gammathree');
  const plain = await mkUser('plainuser');
  const sub = await Subcourse.create({ title: 'Bio 1', price: 10 });
  const lesson = await Lesson.create({ title: 'L1', num: 1, subcourse: sub._id, videos: [{ fileType: 'quiz', title: 'Quiz A', num: 0 }] });
  const qa = await Question.create({ text: 'q1', answers: ['a', 'b', 'c', 'd'], correctAnswer: 2 });
  const qb = await Question.create({ text: 'q2', answers: ['a', 'b', 'c', 'd'], correctAnswer: 0 });
  lesson.videos[0].questions = [qa._id, qb._id];
  await lesson.save();
  await Lesson.create({ title: 'L2', num: 2, subcourse: sub._id, videos: [{ fileType: 'video', title: 'Intro V' }, { fileType: 'file', title: 'Notes F' }, { fileType: 'video', title: 'Deep V' }, { fileType: 'quiz', title: 'Quiz B' }] });
  await User.updateOne({ _id: s1._id }, { $push: { subcourses: sub._id }, courseProgress: [{ courseId: sub._id, lessons: [{ lessonNum: 2, videoNumber: 2 }] }] });
  await User.updateMany({ _id: { $in: [s2._id, s3._id, plain._id] } }, { $push: { subcourses: sub._id } });
  const groupA = await StudentGroup.create({ name: 'Group A', students: [s1._id], supervisors: [supA._id] });
  const groupB = await StudentGroup.create({ name: 'Group B', students: [s2._id] });
  const test = await GeneralTest.create({ title: 'Mid exam', startAt: new Date(Date.now() - 7200e3), endAt: new Date(Date.now() - 3600e3), duration: 30,
    attemptsCount: 1, questions: [{ text: 'x', choices: ['1', '2'], correct: 1 }, { text: 'y', choices: ['1', '2'], correct: 0 }] });
  await TestAttempt.create({ test: test._id, user: s1._id, startedAt: new Date(Date.now() - 7000e3), deadline: new Date(Date.now() - 6000e3), order: [0, 1], choiceOrder: [[0, 1], [0, 1]], answers: [1, 1], submittedAt: new Date(Date.now() - 6500e3) });

  const admin = cookieOf(adminU), superA = cookieOf(supA), superB = cookieOf(supB), student = cookieOf(s1), other = cookieOf(plain);

  // ---------- access ----------
  await check('guest cannot open /dashboard', async () => { const res = await call('GET', '/dashboard'); assert(!res.text.includes('alphaone'), 'student names leaked'); });
  await check('student cannot open /dashboard', async () => { const res = await call('GET', '/dashboard', { cookie: other }); assert(!res.text.includes('alphaone') && !res.text.includes('superA'), `got ${res.status}`); });
  await check('student cannot open a student page', async () => { const res = await call('GET', `/dashboard/students/${s1._id}`, { cookie: other }); assert(!res.text.includes(s1.parentPhone), 'parent phone leaked'); });
  await check('admin sees every student', async () => {
    const res = await call('GET', '/dashboard', { cookie: admin });
    assert(res.status === 200 && ['alphaone', 'betatwo', 'gammathree', 'plainuser'].every(n => res.text.includes(n)), 'missing students');
    assert(!res.text.includes('superA') && !res.text.includes('superB'), 'staff listed as students');
  });
  await check('supervisor sees only students of their groups', async () => {
    const res = await call('GET', '/dashboard', { cookie: superA });
    assert(res.status === 200 && res.text.includes('alphaone'), 'own student missing');
    assert(!res.text.includes('betatwo') && !res.text.includes('gammathree') && !res.text.includes('Group B'), 'other students/groups leaked');
  });
  await check('supervisor cannot widen scope with ?group=<other group>', async () => {
    const res = await call('GET', `/dashboard?group=${groupB._id}`, { cookie: superA });
    assert(!res.text.includes('betatwo'), 'other group student leaked');
  });
  await check('supervisor search stays inside their groups', async () => {
    const res = await call('GET', '/dashboard?q=beta', { cookie: superA });
    assert(!res.text.includes('betatwo'), 'search leaked');
  });
  await check('search regex is literal', async () => {
    const res = await call('GET', '/dashboard?q=.*', { cookie: admin });
    assert(res.status === 200 && !res.text.includes('betatwo'), 'regex not escaped');
  });
  await check('supervisor without groups sees nobody', async () => {
    const res = await call('GET', '/dashboard', { cookie: superB });
    assert(res.status === 200 && !res.text.includes('alphaone') && !res.text.includes('betatwo'), 'leak');
  });
  await check('supervisor opens own student page with full info', async () => {
    const res = await call('GET', `/dashboard/students/${s1._id}`, { cookie: superA });
    assert(res.status === 200, `got ${res.status}`);
    assert([s1.studentId, s1.parentPhone, s1.email, 'Bio 1', 'Mid exam'].every(v => res.text.includes(v)), 'info missing');
    assert(res.text.includes(`tel:${s1.parentPhone}`), 'no call-parent link');
    assert(!/password|\$2[aby]\$/.test(res.text.replace(/type='password'|"password"/g, '')), 'password data in page');
  });
  await check('supervisor cannot open student outside their groups (IDOR)', async () => {
    for(const u of [s2, s3, adminU, supB]) {
      const res = await call('GET', `/dashboard/students/${u._id}`, { cookie: superA });
      assert(!res.text.includes(u.parentPhone) && !res.text.includes(u.email), `leaked ${u.name}`);
    }
  });
  await check('invalid student id is handled', async () => {
    const res = await call('GET', '/dashboard/students/not-an-id', { cookie: admin });
    assert(res.status < 500 && !res.text.includes('at '), `got ${res.status}`);
  });
  await check('admin cannot open staff accounts as students', async () => {
    const res = await call('GET', `/dashboard/students/${supA._id}`, { cookie: admin });
    assert(!res.text.includes(supA.parentPhone), 'staff shown');
  });

  // ---------- birthdays ----------
  await check('birthday today shows in upcoming birthdays', async () => {
    const res = await call('GET', '/dashboard', { cookie: superA });
    assert(res.text.includes('أعياد الميلاد القادمة') && res.text.includes('اليوم') && res.text.includes('يكمل 16 سنة'), 'birthday missing');
  });
  await check('birthday list respects supervisor scope', async () => {
    await User.updateOne({ _id: s2._id }, { dob: yearsAgo(15) });
    const res = await call('GET', '/dashboard', { cookie: superA });
    assert(!res.text.includes('betatwo'), 'other group birthday leaked');
    await User.updateOne({ _id: s2._id }, { dob: '2008-01-15' });
  });
  await check('birthday math (leap day, year wrap)', async () => {
    const { birthdayInfo } = r('controllers/dashboardController');
    assert(birthdayInfo(yearsAgo(16)).days === 0 && birthdayInfo(yearsAgo(16)).age === 16, 'today');
    assert(birthdayInfo('bad') === null, 'invalid dob');
    const feb29 = birthdayInfo('2008-02-29');
    assert(feb29.days >= 0 && feb29.days <= 366, 'leap');
  });

  // ---------- quiz attempts ----------
  const solve = (answers, cookie = student) => call('POST', '/api/v1/questions/solve-questions', { cookie,
    body: { subcourseId: sub._id, lessonId: lesson._id, resourceNum: 0, solvedQuestions: answers } });
  await check('solving a quiz records an attempt', async () => {
    const res = await solve([{ questionId: qa._id, index: 2 }, { questionId: qb._id, index: 3 }]);
    assert(ok(res) && res.json.correct === 1, res.text);
    const a = await QuizAttempt.findOne({ user: s1._id });
    assert(a && a.correct === 1 && a.total === 2 && a.quizTitle === 'Quiz A' && a.lessonTitle === 'L1', 'attempt not stored');
  });
  await check('repeated answers cannot inflate the mark', async () => {
    const res = await solve(Array(5).fill({ questionId: qa._id, index: 2 }));
    assert(ok(res) && res.json.correct === 1, `correct ${res.json && res.json.correct}`);
  });
  await check('malformed solve body does not crash', async () => {
    const res = await solve([null, 5, 'x']);
    assert(res.status < 500, res.text);
  });
  await check('non-owner solve is rejected and not recorded', async () => {
    const before = await QuizAttempt.countDocuments();
    const res = await solve([{ questionId: qa._id, index: 2 }], cookieOf(await mkUser('strangerq')));
    assert(!ok(res) && await QuizAttempt.countDocuments() === before, 'recorded');
  });
  await check('each attempt is listed with its try number', async () => {
    const res = await call('GET', `/dashboard/students/${s1._id}`, { cookie: admin });
    assert(res.text.includes('Quiz A') && res.text.includes('1 / 2') && (res.text.match(/<td>3<\/td>/) || []).length >= 1, 'attempts missing');
  });
  await check('per-lesson resources show what was finished', async () => {
    const res = await call('GET', `/dashboard/students/${s1._id}`, { cookie: admin });
    const chip = t => res.text.split('class="res-chip').find(c => c.includes(`<span>${t}</span>`)) || '';
    assert(chip('Intro V').startsWith(' video done"'), 'finished video not marked');
    assert(chip('Deep V').startsWith(' video"') && chip('Quiz B').startsWith(' quiz"'), 'unfinished resource marked done');
    assert(!res.text.includes('Notes F'), 'file listed as progress');
    assert(/الدرس 2: L2[\s\S]*?1 \/ 3/.test(res.text), 'lesson count missing');
    assert(/<span>Quiz A<\/span><span class="res-mark">\d+ \/ 2<\/span>/.test(res.text), 'quiz mark missing');
  });
  await check('general test mark and rank shown after the test ends', async () => {
    const res = await call('GET', `/dashboard/students/${s1._id}`, { cookie: admin });
    assert(res.text.includes('1 / 2') && res.text.includes('1 من 1'), 'test mark missing');
  });

  // ---------- group management API ----------
  const api = (method, url, body, cookie = admin) => call(method, `/api/v1/dashboard${url}`, { body, cookie });
  const adminCalls = [
    ['POST', '/groups', { name: 'x' }], ['PATCH', `/groups/${groupA._id}`, { name: 'x' }], ['DELETE', `/groups/${groupB._id}`],
    ['POST', `/groups/${groupA._id}/students`, { students: 'betatwo' }], ['DELETE', `/groups/${groupA._id}/students/${s1._id}`],
    ['POST', `/groups/${groupB._id}/supervisors`, { userId: String(supA._id) }], ['DELETE', `/groups/${groupA._id}/supervisors/${supA._id}`],
    ['POST', '/supervisors', { user: 'plainuser' }], ['DELETE', `/supervisors/${supA._id}`]
  ];
  for(const [who, cookie] of [['guest', ''], ['student', other], ['supervisor', superA]]) {
    await check(`${who} cannot use any group/supervisor API`, async () => {
      for(const [m, u, b] of adminCalls) { const res = await api(m, u, b, cookie); assert(!ok(res), `${m} ${u} allowed`); }
      const g = await StudentGroup.findById(groupA._id);
      assert(g.name === 'Group A' && g.students.length === 1 && g.supervisors.length === 1, 'state changed');
      assert(await StudentGroup.exists({ _id: groupB._id }), 'group deleted');
    });
  }
  await check('supervisor cannot open /dashboard/groups', async () => { const res = await call('GET', '/dashboard/groups', { cookie: superA }); assert(!res.text.includes('Group B'), 'leaked'); });
  await check('admin opens /dashboard/groups', async () => { const res = await call('GET', '/dashboard/groups', { cookie: admin }); assert(res.status === 200 && res.text.includes('Group B') && res.text.includes('superA'), `got ${res.status}`); });

  let newGroup;
  await check('admin creates a group (name is escaped)', async () => {
    const res = await api('POST', '/groups', { name: '<img src=x onerror=alert(1)>' });
    assert(ok(res), res.text); newGroup = res.json.group._id;
    const page = await call('GET', '/dashboard/groups', { cookie: admin });
    assert(!page.text.includes('<img src=x'), 'unescaped');
  });
  await check('empty group name rejected', async () => { assert(!ok(await api('POST', '/groups', { name: '  ' })), 'accepted'); });
  await check('admin adds students by name and phone, reports unknown', async () => {
    const res = await api('POST', `/groups/${newGroup}/students`, { students: `betatwo\n${s3.studentId}\nnobody\nadminx\nsuperB` });
    assert(ok(res) && res.json.added === 2 && res.json.notFound.join() === 'nobody,adminx,superB', res.text);
  });
  await check('object injection in students list is ignored', async () => {
    const res = await api('POST', `/groups/${newGroup}/students`, { students: [{ $ne: null }] });
    assert(!ok(res), 'accepted');
    assert((await StudentGroup.findById(newGroup)).students.length === 2, 'added students');
  });
  await check('only supervisor accounts can be given a group', async () => {
    assert(!ok(await api('POST', `/groups/${newGroup}/supervisors`, { userId: String(plain._id) })), 'plain user accepted');
    assert(!ok(await api('POST', `/groups/${newGroup}/supervisors`, { userId: String(adminU._id) })), 'admin accepted');
    assert(ok(await api('POST', `/groups/${newGroup}/supervisors`, { userId: String(supB._id) })), 'supervisor rejected');
  });
  await check('newly assigned supervisor sees the group students', async () => {
    const res = await call('GET', '/dashboard', { cookie: superB });
    assert(res.text.includes('betatwo') && res.text.includes('gammathree') && !res.text.includes('alphaone'), 'scope wrong');
  });
  await check('removing supervisor from group revokes access at once', async () => {
    assert(ok(await api('DELETE', `/groups/${newGroup}/supervisors/${supB._id}`)), 'remove failed');
    const res = await call('GET', `/dashboard/students/${s2._id}`, { cookie: superB });
    assert(!res.text.includes(s2.parentPhone), 'still visible');
  });
  await check('admin makes a user supervisor (removed from student groups)', async () => {
    await api('POST', `/groups/${newGroup}/students`, { students: 'plainuser' });
    const res = await api('POST', '/supervisors', { user: 'plainuser' });
    assert(ok(res), res.text);
    assert((await User.findById(plain._id).select('+role')).role === 'supervisor', 'role not set');
    assert(!(await StudentGroup.findById(newGroup)).students.some(id => id.equals(plain._id)), 'still a student');
    const page = await call('GET', '/dashboard', { cookie: other });
    assert(page.status === 200, 'new supervisor cannot open dashboard');
  });
  await check('cannot turn an admin into a supervisor', async () => {
    assert(!ok(await api('POST', '/supervisors', { user: 'adminx' })), 'accepted');
    assert((await User.findById(adminU._id).select('+role')).role === 'admin', 'admin demoted');
  });
  await check('demoting a supervisor removes all their group access', async () => {
    assert(ok(await api('DELETE', `/supervisors/${supA._id}`)), 'demote failed');
    assert(!await StudentGroup.exists({ supervisors: supA._id }), 'still supervising');
    const res = await call('GET', `/dashboard/students/${s1._id}`, { cookie: superA });
    assert(!res.text.includes(s1.parentPhone), 'still visible');
  });
  await check('demote endpoint cannot demote an admin', async () => {
    assert(!ok(await api('DELETE', `/supervisors/${adminU._id}`)), 'accepted');
    assert((await User.findById(adminU._id).select('+role')).role === 'admin', 'admin demoted');
  });
  await check('signup cannot create a supervisor', async () => {
    await call('POST', '/api/v1/users/signup', { body: { name: 'sneaky', email: 'sn@t.com', password: 'password1', passwordConfirm: 'password1',
      studentId: '0990000000', parentPhone: '0990000001', dob: '2008-01-01', referral: 'friend', role: 'supervisor', screenWidth: '1', screenHeight: '1', userAgent: 'x' } });
    const u = await User.findOne({ name: 'sneaky' }).select('+role');
    assert(!u || u.role === 'user', 'role injected');
  });
  await check('admin renames and deletes a group', async () => {
    assert(ok(await api('PATCH', `/groups/${newGroup}`, { name: 'Renamed' })), 'rename failed');
    assert(ok(await api('DELETE', `/groups/${newGroup}`)), 'delete failed');
    assert(!await StudentGroup.exists({ _id: newGroup }), 'not deleted');
  });
  await check('bad group ids are handled', async () => {
    for(const u of ['/groups/nope', '/groups/nope/students/nope']) { const res = await api('DELETE', u); assert(!ok(res) && res.status < 500, u); }
  });

  await check('supervisors page is admin-only', async () => {
    for(const cookie of [superB, student, undefined]) {
      const res = await call('GET', '/dashboard/supervisors?q=gamma', { cookie });
      assert(!res.text.includes('gammathree') && !res.text.includes('make-supervisor-btn'), 'page leaked');
    }
  });
  await check('supervisors page search lists student accounts only', async () => {
    const res = await call('GET', '/dashboard/supervisors?q=gamma', { cookie: admin });
    assert(res.status === 200 && /data-name="gammathree"/.test(res.text), 'match missing');
    const staff = await call('GET', '/dashboard/supervisors?q=admin', { cookie: admin });
    assert(!/data-name="adminx"/.test(staff.text), 'admin offered as supervisor');
    const rx = await call('GET', `/dashboard/supervisors?q=${encodeURIComponent('.*')}`, { cookie: admin });
    assert(!rx.text.includes('make-supervisor-btn'), 'regex not literal');
  });
  await check('admin makes a supervisor by account id from the page', async () => {
    const d = await mkUser('deltafour');
    assert(ok(await api('POST', '/supervisors', { userId: String(d._id) })), 'rejected');
    assert((await User.findById(d._id).select('+role')).role === 'supervisor', 'role not set');
    const res = await call('GET', '/dashboard/supervisors', { cookie: admin });
    assert(/class="btn btn-ghost demote-btn"[^>]*data-name="deltafour"/.test(res.text), 'not listed');
  });
  await check('bad userId values are rejected', async () => {
    const before = await User.countDocuments({ role: 'supervisor' });
    for(const userId of [{ $ne: null }, 'nope', String(adminU._id)]) assert(!ok(await api('POST', '/supervisors', { userId })), JSON.stringify(userId));
    assert(await User.countDocuments({ role: 'supervisor' }) === before, 'role changed');
  });
  await check('dashboard entry shown to staff only', async () => {
    const staff = await call('GET', '/', { cookie: admin });
    assert(staff.text.includes('nav-dashboard-link') && staff.text.includes('href="/dashboard"'), 'admin button missing');
    const plainHome = await call('GET', '/');
    assert(!plainHome.text.includes('nav-dashboard-link'), 'shown to guest');
  });

  // ---------- buyers only + complete-profile gate ----------
  const form = async (url, fields, cookie) => {
    const wait = last + 450 - Date.now(); if(wait > 0) await sleep(wait); last = Date.now();
    const res = await fetch(base + url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie }, body: new URLSearchParams(fields) });
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  };
  await check('dashboard lists only students who bought a course', async () => {
    await mkUser('nobuyerzz');
    const res = await call('GET', '/dashboard?q=nobuyer', { cookie: admin });
    assert(res.status === 200 && !res.text.includes('nobuyerzz'), 'non-buyer listed');
    const all = await call('GET', '/dashboard', { cookie: admin });
    assert(all.text.includes('alphaone') && !all.text.includes('nobuyerzz'), 'buyer filter wrong');
  });
  await check('DD.MM.YYYY birthdays show too', async () => {
    const [y, m, d] = today.split('-');
    await mkUser('dottedbday', { dob: `${d}.${m}.${+y - 17}`, subcourses: [sub._id] });
    const res = await call('GET', '/dashboard', { cookie: admin });
    assert(res.text.includes('يكمل 17 سنة'), 'dotted dob birthday missing');
    const { birthdayInfo } = r('controllers/dashboardController');
    assert(birthdayInfo('4.01.2009') && birthdayInfo('4.01.2009').ageNow >= 0, 'single-digit day not parsed');
    for(const [raw, iso] of [['31.10.2009', '2009-10-31'], ['17/12/2008', '2008-12-17'], ['2009.8.14', '2009-08-14'], ['21 1 2010 ', '2010-01-21'], ['6 .1 .2010', '2010-01-06'], ['2008-01-15', '2008-01-15']])
      assert(birthdayInfo(raw)?.date.toISOString().slice(0, 10) === iso, `${raw} parsed wrong`);
    for(const raw of ['200888', '110.7.2009', '31.02.2009', '1.13.2009']) assert(birthdayInfo(raw) === null, `${raw} accepted`);
  });
  await check('student page shows a real date for DD.MM.YYYY dob', async () => {
    const j = await mkUser('joudtest', { dob: '31.10.2009', subcourses: [sub._id] });
    const res = await call('GET', `/dashboard/students/${j._id}`, { cookie: admin });
    assert(res.status === 200 && !res.text.includes('Invalid Date') && res.text.includes('2009'), 'bad date shown');
  });
  await check('dashboard hides students without a phone number', async () => {
    const { insertedId } = await User.collection.insertOne({ name: 'nophonebuyer', email: 'np@t.com', password: 'x', active: true, role: 'user', subcourses: [sub._id], dob: '01.01.2009' });
    const res = await call('GET', '/dashboard', { cookie: admin });
    assert(res.status === 200 && !res.text.includes('nophonebuyer') && res.text.includes('alphaone'), 'no-phone student listed');
    await User.collection.deleteOne({ _id: insertedId });
  });
  const { insertedId: legacyId } = await User.collection.insertOne({ name: 'legacyold', email: 'legacy@t.com', password: 'x', active: true, role: 'user', subcourses: [], value: 50 });
  const legacy = `jwtStudyou=${jwt.sign({ id: legacyId }, process.env.JWT_SECRET_KEY)}`;
  await check('account without phones is sent to /complete-profile', async () => {
    for(const url of ['/', '/settings', '/join-telegram']) {
      const res = await call('GET', url, { cookie: legacy });
      assert(res.status === 302 && res.text.includes('/complete-profile'), `${url} not redirected (${res.status})`);
    }
    const page = await call('GET', '/complete-profile', { cookie: legacy });
    assert(page.status === 200 && page.text.includes('name="parentPhone"'), 'form missing');
  });
  await check('account without phones cannot use the API', async () => {
    const res = await call('POST', '/api/v1/users/update-progress', { cookie: legacy, body: {} });
    assert(!ok(res) && res.text.includes('إكمال معلومات حسابك'), `got ${res.status} ${res.text.slice(0, 80)}`);
    const out = await call('POST', '/api/v1/users/logout', { cookie: legacy });
    assert(!out.text.includes('إكمال معلومات حسابك'), 'logout blocked');
  });
  await check('complete-profile rejects bad input', async () => {
    for(const f of [{ studentId: '123', parentPhone: '0991111111', dob: '2008-01-01' }, { studentId: '0991111111', parentPhone: '0991111111', dob: '2008-01-01' },
      { studentId: '0991111111', parentPhone: '0992222222', dob: '2008-02-30' }, { studentId: '0991111111', parentPhone: '0992222222', dob: '' },
      { 'studentId[$ne]': '1', parentPhone: '0992222222', dob: '2008-01-01' }]) {
      const res = await form('/complete-profile', f, legacy);
      assert(res.status === 400, `${JSON.stringify(f)} -> ${res.status}`);
    }
    const u = await User.collection.findOne({ _id: legacyId });
    assert(!u.studentId && !u.dob, 'bad data saved');
  });
  await check('complete-profile saves valid input (Arabic digits ok) and unlocks the site', async () => {
    const res = await form('/complete-profile', { studentId: '٠٩٩١٢٣٤٥٦٧', parentPhone: '0997654321', dob: '2008-03-05' }, legacy);
    assert(res.status === 302 && res.location === '/', `got ${res.status}`);
    const u = await User.collection.findOne({ _id: legacyId });
    assert(u.studentId === '0991234567' && u.parentPhone === '0997654321' && u.dob === '05.03.2008' && u.value === 50, JSON.stringify(u));
    const home = await call('GET', '/', { cookie: legacy });
    assert(home.status === 200, `still gated (${home.status})`);
    const again = await call('GET', '/complete-profile', { cookie: legacy });
    assert(again.status === 302, 'form shown after completion');
  });
  await check('staff without phones are not gated', async () => {
    await User.collection.updateOne({ _id: supB._id }, { $unset: { studentId: '', parentPhone: '' } });
    const res = await call('GET', '/dashboard', { cookie: superB });
    assert(res.status === 200, `got ${res.status}`);
  });

  const failed = results.filter(x => !x[0]);
  failed.forEach(([, name, msg]) => console.log(`FAIL  ${name}\n      ${msg}`));
  console.log(`${results.length - failed.length}/${results.length} dashboard checks passed`);
  server.close(); await mongoose.disconnect(); await mongo.stop();
  process.exit(failed.length ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
