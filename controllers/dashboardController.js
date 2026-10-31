const mongoose = require('mongoose');
const User = require('./../models/userModel');
const Subcourse = require('./../models/subcourseModel');
const Lesson = require('./../models/lessonModel');
const StudentGroup = require('./../models/studentGroupModel');
const QuizAttempt = require('./../models/quizAttemptModel');
const GeneralTest = require('./../models/generalTestModel');
const TestAttempt = require('./../models/testAttemptModel');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/AppError');
const { resourceCounts, progressOf } = require('./../utils/courseStats');
const { lessonPointer, isFile } = require('./../utils/courseProgress');
const { finalizeResults } = require('./generalTestController');

const layout = { brandHref: '/dashboard', brandBadge: 'لوحة الطلاب', brandIcon: 'fa-chart-line', styles: ['/css/dashboard.css'] };
const PAGE_SIZE = 30;
const BIRTHDAY_DAYS = 7;
const TIME_ZONE = 'Asia/Damascus';
const STUDENT = { role: { $nin: ['admin', 'supervisor'] } };
const STUDENT_FIELDS = 'name email studentId parentPhone dob value subcourses active';

const notFound = () => new AppError('هذا الطالب غير موجود', 404);
const escapeRegex = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isAdmin = user => user.role === 'admin';

// groups the viewer can see: admins all, supervisors only the ones given to them
const groupsFor = user => StudentGroup.find(isAdmin(user) ? {} : { supervisors: user._id }).sort('name');

// null = every student (admin), else the ids of the students in the viewer's groups
const allowedIds = groups => [...new Set(groups.flatMap(g => g.students.map(String)))];

const canSee = async (user, studentId) => isAdmin(user) || !!await StudentGroup.exists({ supervisors: user._id, students: studentId });

/* ------------------------------ dates ------------------------------ */
// YYYY-MM-DD of today in Syria
const todayParts = () => {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()).split('-').map(Number);
  return { y, m, d };
};
const pad = n => String(n).padStart(2, '0');
const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// dob is 'YYYY-MM-DD' from <input type=date>
const parseDob = dob => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob || ''));
  return match ? { y: +match[1], m: +match[2], d: +match[3] } : null;
};

// days until the next birthday (0 = today) and the age reached on it
const birthdayInfo = dob => {
  const b = parseDob(dob);
  if(!b) return null;
  const t = todayParts();
  const today = Date.UTC(t.y, t.m - 1, t.d);
  const dateIn = y => Date.UTC(y, b.m - 1, b.m === 2 && b.d === 29 && !isLeap(y) ? 28 : b.d);
  let year = t.y;
  if(dateIn(year) < today) year++;
  return { days: Math.round((dateIn(year) - today) / 86400000), age: year - b.y, ageNow: year - b.y - (dateIn(year) === today ? 0 : 1) };
};

// '-MM-DD' endings of the next n days (Feb 29 birthdays are shown on Feb 28 in other years)
const comingDayEndings = n => {
  const t = todayParts();
  const endings = [];
  for(let i = 0; i < n; i++) {
    const date = new Date(Date.UTC(t.y, t.m - 1, t.d + i));
    const m = date.getUTCMonth() + 1, d = date.getUTCDate();
    endings.push(`${pad(m)}-${pad(d)}`);
    if(m === 2 && d === 28 && !isLeap(date.getUTCFullYear())) endings.push('02-29');
  }
  return endings;
};

/* ------------------------------ pages ------------------------------ */
exports.getDashboard = catchAsync(async function(req, res, next) {
  const user = res.locals.user;
  const groups = await groupsFor(user);
  const group = groups.find(g => g._id.toString() === req.query.group) || null;
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 40) : '';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  // what the viewer may see, then the chosen group / search inside it
  const scope = { ...STUDENT };
  if(group) scope._id = { $in: group.students };
  else if(!isAdmin(user)) scope._id = { $in: allowedIds(groups) };
  const filter = { ...scope };
  if(q) filter.$or = [{ name: { $regex: escapeRegex(q), $options: 'i' } }, { studentId: { $regex: escapeRegex(q) } }, { parentPhone: { $regex: escapeRegex(q) } }];

  const [total, students, birthdays] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter).select(STUDENT_FIELDS).sort('name').skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE),
    User.find({ ...scope, dob: { $regex: `-(${comingDayEndings(BIRTHDAY_DAYS).join('|')})$` } }).select('name studentId parentPhone dob')
  ]);

  const ids = students.map(s => s._id);
  const [quizStats, testCounts] = await Promise.all([
    QuizAttempt.aggregate([
      { $match: { user: { $in: ids } } },
      { $group: { _id: '$user', count: { $sum: 1 }, avg: { $avg: { $cond: [{ $gt: ['$total', 0] }, { $divide: ['$correct', '$total'] }, 0] } } } }
    ]),
    TestAttempt.aggregate([{ $match: { user: { $in: ids } } }, { $group: { _id: '$user', count: { $sum: 1 } } }])
  ]);
  const quizOf = Object.fromEntries(quizStats.map(s => [s._id.toString(), { count: s.count, avg: Math.round(s.avg * 100) }]));
  const testsOf = Object.fromEntries(testCounts.map(s => [s._id.toString(), s.count]));
  const groupNames = id => groups.filter(g => g.students.some(s => s.toString() === id.toString())).map(g => g.name);

  res.status(200).render('dashboard', {
    ...layout,
    pageTitle: 'لوحة الطلاب',
    user,
    groups,
    group,
    q,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    total,
    rows: students.map(s => ({
      student: s,
      groups: groupNames(s._id),
      courses: s.subcourses.length,
      quiz: quizOf[s._id.toString()] || { count: 0, avg: null },
      tests: testsOf[s._id.toString()] || 0
    })),
    birthdays: birthdays
      .map(s => ({ student: s, ...birthdayInfo(s.dob) }))
      .filter(b => b.days !== undefined && b.days < BIRTHDAY_DAYS)
      .sort((a, b) => a.days - b.days || a.student.name.localeCompare(b.student.name))
  });
});

exports.getStudent = catchAsync(async function(req, res, next) {
  const user = res.locals.user;
  const { userId } = req.params;
  if(!mongoose.isValidObjectId(userId) || !await canSee(user, userId)) return next(notFound());
  const student = await User.findOne({ _id: userId, ...STUDENT }).select(`${STUDENT_FIELDS} courseProgress reasonToBlock`);
  if(!student) return next(notFound());

  const [groups, courses, counts, quizAttempts, testAttempts, lessons] = await Promise.all([
    StudentGroup.find({ students: student._id, ...(isAdmin(user) ? {} : { supervisors: user._id }) }).select('name').sort('name'),
    Subcourse.find({ _id: { $in: student.subcourses } }).select('title finished'),
    resourceCounts(student.subcourses),
    QuizAttempt.find({ user: student._id }).sort({ createdAt: -1 }).limit(300).lean(),
    TestAttempt.find({ user: student._id }).sort({ startedAt: -1 }),
    Lesson.find({ subcourse: { $in: student.subcourses } }).select('title num subcourse videos.title videos.fileType videos.num').sort('num').lean()
  ]);

  // general test marks exist only after a test ends
  const tests = await GeneralTest.find({ _id: { $in: testAttempts.map(a => a.test) } });
  await Promise.all(tests.filter(t => !t.resultsReady && t.stateAt() === 'ended').map(finalizeResults));
  const testById = Object.fromEntries(tests.map(t => [t._id.toString(), t]));
  const freshAttempts = await TestAttempt.find({ user: student._id }).select('test score rank startedAt submittedAt').sort({ startedAt: -1 });

  // number each quiz attempt per quiz (1 = first time)
  const tries = {};
  [...quizAttempts].reverse().forEach(a => {
    const key = `${a.lesson}-${a.resourceNum}`;
    tries[key] = (tries[key] || 0) + 1;
    a.tryNum = tries[key];
  });
  // latest mark per quiz (attempts are newest first)
  const lastMark = {};
  quizAttempts.forEach(a => { lastMark[`${a.lesson}-${a.resourceNum}`] ??= a; });

  // lessons can be opened in any order; inside a lesson resources unlock one by one
  const lessonsOf = (courseId, progress) => lessons.filter(l => l.subcourse?.toString() === courseId.toString()).map(l => {
    const videos = l.videos || [];
    const pointer = lessonPointer(progress, l.num, videos);
    const resources = videos.map((v, i) => ({ v, i })).filter(({ v }) => !isFile(v)).map(({ v, i }) => {
      const mark = v.fileType === 'quiz' && lastMark[`${l._id}-${v.num ?? i}`];
      return { title: v.title, type: v.fileType === 'quiz' ? 'quiz' : 'video', done: i < pointer, mark: mark ? `${mark.correct} / ${mark.total}` : null };
    });
    return { num: l.num, title: l.title, resources, done: resources.filter(r => r.done).length };
  });

  const courseTitle = Object.fromEntries(courses.map(c => [c._id.toString(), c.title]));

  res.status(200).render('dashboardStudent', {
    ...layout,
    pageTitle: student.name,
    user,
    student,
    groups,
    joinedAt: student._id.getTimestamp(),
    birthday: birthdayInfo(student.dob),
    courses: courses.map(c => {
      const p = student.courseProgress.find(cp => cp.courseId?.toString() === c._id.toString());
      return { title: c.title, finished: c.finished, lastLesson: p?.lastLesson || null, lessons: lessonsOf(c._id, p), ...progressOf(student, c._id, counts[c._id.toString()] || 0) };
    }).sort((a, b) => b.percent - a.percent),
    quizAttempts: quizAttempts.map(a => ({ ...a, courseTitle: courseTitle[a.subcourse.toString()] || '—' })),
    tests: freshAttempts.map(a => {
      const t = testById[a.test.toString()];
      return t && { title: t.title, startedAt: a.startedAt, ended: t.stateAt() === 'ended', score: a.score, rank: a.rank, total: t.questionsPerUser(), submitted: !!a.submittedAt, attemptsCount: t.attemptsCount };
    }).filter(Boolean)
  });
});

exports.getGroups = catchAsync(async function(req, res, next) {
  const [groups, supervisors] = await Promise.all([
    StudentGroup.find().populate('students', 'name studentId').populate('supervisors', 'name').sort('name'),
    User.find({ role: 'supervisor' }).select('name email studentId').sort('name')
  ]);
  res.status(200).render('dashboardGroups', { ...layout, pageTitle: 'المجموعات', user: res.locals.user, groups, supervisors });
});

// admin: current supervisors with their groups + account search to make new ones
exports.getSupervisors = catchAsync(async function(req, res, next) {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 40) : '';
  const rx = new RegExp(escapeRegex(q), 'i');
  const [supervisors, groups, matches] = await Promise.all([
    User.find({ role: 'supervisor' }).select('name email studentId').sort('name'),
    StudentGroup.find({ 'supervisors.0': { $exists: true } }).select('name supervisors').sort('name'),
    q ? User.find({ ...STUDENT, $or: [{ name: rx }, { studentId: rx }] }).select('name email studentId').sort('name').limit(20) : []
  ]);
  res.status(200).render('dashboardSupervisors', {
    ...layout,
    pageTitle: 'المشرفون',
    user: res.locals.user,
    q,
    matches,
    supervisors: supervisors.map(s => ({ s, groups: groups.filter(g => g.supervisors.some(id => id.equals(s._id))) }))
  });
});

/* ---------------------------- admin api ---------------------------- */
const findGroup = async id => mongoose.isValidObjectId(id) && await StudentGroup.findById(id);
const groupNotFound = () => new AppError('هذه المجموعة غير موجودة', 404);
const cleanName = name => typeof name === 'string' ? name.trim() : '';

exports.createGroup = catchAsync(async function(req, res, next) {
  const name = cleanName(req.body.name);
  if(!name) return next(new AppError('الرجاء كتابة اسم المجموعة', 400));
  const group = await StudentGroup.create({ name });
  res.status(201).json({ status: 'success', message: 'تم إنشاء المجموعة', group: { _id: group._id, name: group.name } });
});

exports.renameGroup = catchAsync(async function(req, res, next) {
  const name = cleanName(req.body.name);
  if(!name) return next(new AppError('الرجاء كتابة اسم المجموعة', 400));
  const group = await findGroup(req.params.groupId);
  if(!group) return next(groupNotFound());
  group.name = name;
  await group.save();
  res.status(200).json({ status: 'success', message: 'تم تعديل اسم المجموعة' });
});

exports.deleteGroup = catchAsync(async function(req, res, next) {
  const group = await findGroup(req.params.groupId);
  if(!group) return next(groupNotFound());
  await group.deleteOne();
  res.status(200).json({ status: 'success', message: 'تم حذف المجموعة' });
});

// body.students: names or phone numbers (one string or a list)
exports.addStudents = catchAsync(async function(req, res, next) {
  const group = await findGroup(req.params.groupId);
  if(!group) return next(groupNotFound());
  const raw = Array.isArray(req.body.students) ? req.body.students : [req.body.students];
  const keys = [...new Set(raw.filter(k => typeof k === 'string').flatMap(k => k.split(/[\n,،]+/)).map(k => k.trim()).filter(Boolean))].slice(0, 500);
  if(!keys.length) return next(new AppError('الرجاء كتابة اسم الطالب أو رقمه', 400));

  const found = await User.find({ ...STUDENT, $or: [{ name: { $in: keys } }, { studentId: { $in: keys } }] }).select('name studentId');
  const notFoundKeys = keys.filter(k => !found.some(u => u.name === k || u.studentId === k));
  await StudentGroup.updateOne({ _id: group._id }, { $addToSet: { students: { $each: found.map(u => u._id) } } });
  res.status(200).json({ status: 'success', message: `تمت إضافة ${found.length} طالب`, added: found.length, notFound: notFoundKeys });
});

exports.removeStudent = catchAsync(async function(req, res, next) {
  const group = await findGroup(req.params.groupId);
  if(!group || !mongoose.isValidObjectId(req.params.userId)) return next(groupNotFound());
  await StudentGroup.updateOne({ _id: group._id }, { $pull: { students: req.params.userId } });
  res.status(200).json({ status: 'success', message: 'تم إخراج الطالب من المجموعة' });
});

exports.addSupervisor = catchAsync(async function(req, res, next) {
  const group = await findGroup(req.params.groupId);
  if(!group || !mongoose.isValidObjectId(req.body.userId)) return next(groupNotFound());
  const supervisor = await User.findOne({ _id: req.body.userId, role: 'supervisor' });
  if(!supervisor) return next(new AppError('هذا المشرف غير موجود', 404));
  await StudentGroup.updateOne({ _id: group._id }, { $addToSet: { supervisors: supervisor._id } });
  res.status(200).json({ status: 'success', message: `أصبح ${supervisor.name} مشرفا على المجموعة` });
});

exports.removeSupervisor = catchAsync(async function(req, res, next) {
  const group = await findGroup(req.params.groupId);
  if(!group || !mongoose.isValidObjectId(req.params.userId)) return next(groupNotFound());
  await StudentGroup.updateOne({ _id: group._id }, { $pull: { supervisors: req.params.userId } });
  res.status(200).json({ status: 'success', message: 'تم سحب صلاحية المشرف من المجموعة' });
});

// turn a normal account into a supervisor account (by name or phone)
exports.makeSupervisor = catchAsync(async function(req, res, next) {
  const { userId } = req.body;
  const byId = typeof userId === 'string' && mongoose.isValidObjectId(userId);
  const key = cleanName(req.body.user);
  if(!byId && !key) return next(new AppError('الرجاء كتابة اسم الحساب أو رقمه', 400));
  const target = await User.findOne(byId ? { _id: userId } : { $or: [{ name: key }, { studentId: key }] }).select('+role');
  if(!target) return next(new AppError('هذا الحساب غير موجود', 404));
  if(target.role === 'admin') return next(new AppError('هذا الحساب ادمن', 400));
  if(target.role === 'supervisor') return next(new AppError('هذا الحساب مشرف بالفعل', 400));
  await User.updateOne({ _id: target._id }, { role: 'supervisor' });
  // a supervisor is not a student of any group
  await StudentGroup.updateMany({ students: target._id }, { $pull: { students: target._id } });
  res.status(200).json({ status: 'success', message: `أصبح ${target.name} مشرفا` });
});

exports.removeSupervisorRole = catchAsync(async function(req, res, next) {
  if(!mongoose.isValidObjectId(req.params.userId)) return next(new AppError('هذا المشرف غير موجود', 404));
  const { matchedCount } = await User.updateOne({ _id: req.params.userId, role: 'supervisor' }, { role: 'user' });
  if(!matchedCount) return next(new AppError('هذا المشرف غير موجود', 404));
  await StudentGroup.updateMany({ supervisors: req.params.userId }, { $pull: { supervisors: req.params.userId } });
  res.status(200).json({ status: 'success', message: 'أصبح الحساب حساب طالب' });
});

exports.birthdayInfo = birthdayInfo;
