const GeneralTest = require('./../models/generalTestModel');
const TestAttempt = require('./../models/testAttemptModel');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/AppError');
const { findTest, finalizeResults } = require('./generalTestController');

// tests pages use the anki layout with their own logo + stylesheet
const layout = { brandHref: '/tests', brandBadge: 'الاختبارات', brandIcon: 'fa-file-pen', styles: ['/css/tests.css'] };
const testNotFound = () => new AppError('هذا الاختبار غير موجود', 404);
const infoOf = t => ({ _id: t._id, title: t.title, description: t.description, startAt: t.startAt, endAt: t.endAt, duration: t.duration });

exports.getTests = catchAsync(async function(req, res, next) {
  const user = res.locals.user;
  if(!user) return res.status(200).render('toSign');
  const now = Date.now();
  const tests = await GeneralTest.find().select('title description startAt endAt duration attemptsCount questions._id pool pick').sort({ startAt: -1 }).limit(150);
  const attempts = await TestAttempt.find({ user: user._id, test: { $in: tests.map(t => t._id) } }).select('test submittedAt deadline');
  const status = {};
  attempts.forEach(a => { status[a.test.toString()] = a.isFinished(now) ? 'done' : 'started'; });

  res.status(200).render('tests', {
    ...layout,
    pageTitle: 'الاختبارات',
    user,
    live: tests.filter(t => t.stateAt(now) === 'live').sort((a, b) => a.endAt - b.endAt),
    upcoming: tests.filter(t => t.stateAt(now) === 'upcoming').reverse(),
    ended: tests.filter(t => t.stateAt(now) === 'ended'),
    status
  });
});

exports.getTest = catchAsync(async function(req, res, next) {
  const user = res.locals.user;
  if(!user) return res.status(200).render('toSign');
  const test = await findTest(req.params.testId);
  if(!test) return next(testNotFound());
  const now = Date.now();
  const state = test.stateAt(now);
  if(state === 'ended') return res.redirect(`/tests/${test._id}/results`);

  const attempt = await TestAttempt.findOne({ test: test._id, user: user._id }).select('submittedAt deadline');
  res.status(200).render('testTake', {
    ...layout,
    pageTitle: test.title,
    user,
    test: infoOf(test),
    state,
    questionsCount: test.questionsPerUser(),
    attemptState: !attempt ? 'new' : attempt.isFinished(now) ? 'done' : 'started',
    // a user starting now gets the time left until the end if it is shorter
    availableMinutes: Math.min(test.duration, (test.endAt.getTime() - now) / 60000)
  });
});

exports.getResults = catchAsync(async function(req, res, next) {
  const user = res.locals.user;
  if(!user) return res.status(200).render('toSign');
  const test = await findTest(req.params.testId);
  if(!test) return next(testNotFound());
  const view = { ...layout, pageTitle: `نتائج ${test.title}`, user, test: infoOf(test), total: test.questionsPerUser() };

  if(test.stateAt() !== 'ended') return res.status(200).render('testResults', { ...view, pending: true });

  await finalizeResults(test);
  const [top, mine, all] = await Promise.all([
    TestAttempt.find({ test: test._id, rank: { $lte: 3 } }).populate('user', 'name').sort({ rank: 1, submittedAt: 1 }),
    TestAttempt.findOne({ test: test._id, user: user._id }),
    user.role === 'admin' ? TestAttempt.find({ test: test._id }).populate('user', 'name studentId').sort({ rank: 1, submittedAt: 1 }) : []
  ]);

  // top 3 marks; everyone with the same mark shares the rank
  const podium = [1, 2, 3]
    .map(rank => ({ rank, attempts: top.filter(a => a.rank === rank) }))
    .filter(p => p.attempts.length)
    .map(p => ({ rank: p.rank, score: p.attempts[0].score, names: p.attempts.map(a => a.user ? a.user.name : '—') }));

  const review = mine && test.showAnswers
    ? [...mine.order].sort((a, b) => a - b).map(qi => {
      const q = test.questions[qi];
      return { text: q.text, choices: q.choices, correct: q.correct, chosen: mine.answers[qi] };
    })
    : null;

  res.status(200).render('testResults', { ...view, pending: false, podium, mine, review, all, participants: test.attemptsCount });
});

exports.getTestEditor = catchAsync(async function(req, res, next) {
  const user = res.locals.user;
  if(!user) return res.status(200).render('toSign');
  let test = null;
  if(req.params.testId) {
    test = await findTest(req.params.testId);
    if(!test) return next(testNotFound());
  }
  res.status(200).render('testEditor', {
    ...layout,
    pageTitle: test ? 'تعديل اختبار' : 'اختبار جديد',
    user,
    test,
    locked: !!(test && test.attemptsCount)
  });
});
