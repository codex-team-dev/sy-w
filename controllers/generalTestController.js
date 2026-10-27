const mongoose = require('mongoose');
const GeneralTest = require('./../models/generalTestModel');
const TestAttempt = require('./../models/testAttemptModel');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/AppError');

const MAX_QUESTIONS = 300;
const DIFFICULTIES = GeneralTest.DIFFICULTIES;
const DIFFICULTY_NAMES = { easy: 'سهل', medium: 'متوسط', hard: 'صعب' };
const DIFFICULTY_PLURALS = { easy: 'السهلة', medium: 'المتوسطة', hard: 'الصعبة' };

const clean = v => typeof v === 'string' ? v.trim() : '';
const fail = message => new AppError(message, 400, 'message');
const testNotFound = () => new AppError('هذا الاختبار غير موجود', 404);
const parseDate = v => { const d = new Date(v); return v && !isNaN(d) ? d : null; };
const range = n => Array.from({ length: n }, (_, i) => i);
const shuffle = function(list) {
  for(let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

const findTest = id => mongoose.isValidObjectId(id) ? GeneralTest.findById(id) : null;
exports.findTest = findTest;

// validated test fields from the admin form, or { error }
const buildTest = function(body) {
  const title = clean(body.title);
  if(!title) return { error: 'الرجاء كتابة عنوان الاختبار' };
  if(title.length > 120) return { error: 'العنوان طويل جداً' };
  const description = clean(body.description);
  if(description.length > 1000) return { error: 'الوصف طويل جداً' };

  const startAt = parseDate(body.startAt);
  const endAt = parseDate(body.endAt);
  if(!startAt || !endAt) return { error: 'الرجاء تحديد وقت البداية ووقت النهاية' };
  if(endAt <= startAt) return { error: 'يجب أن يكون وقت النهاية بعد وقت البداية' };

  const duration = Math.round(Number(body.duration));
  if(!Number.isFinite(duration) || duration < 1 || duration > 600) return { error: 'مدة الاختبار يجب أن تكون بين 1 و600 دقيقة' };

  const raw = Array.isArray(body.questions) ? body.questions : [];
  if(!raw.length) return { error: 'أضف سؤالاً واحداً على الأقل' };
  if(raw.length > MAX_QUESTIONS) return { error: `الحد الأقصى ${MAX_QUESTIONS} سؤال` };

  const questions = [];
  for(const [i, q] of raw.entries()) {
    const n = i + 1;
    const text = clean(q && q.text);
    const choices = (Array.isArray(q && q.choices) ? q.choices : []).map(clean);
    const correct = Number(q && q.correct);
    if(!text) return { error: `السؤال ${n} بدون نص` };
    if(text.length > 1000) return { error: `نص السؤال ${n} طويل جداً` };
    if(choices.length < 2 || choices.length > 6) return { error: `السؤال ${n} يحتاج من 2 إلى 6 خيارات` };
    if(choices.some(c => !c)) return { error: `لا يمكن ترك خيار فارغ في السؤال ${n}` };
    if(choices.some(c => c.length > 300)) return { error: `أحد خيارات السؤال ${n} طويل جداً` };
    if(!Number.isInteger(correct) || correct < 0 || correct >= choices.length) return { error: `اختر الإجابة الصحيحة للسؤال ${n}` };
    const difficulty = DIFFICULTIES.includes(q.difficulty) ? q.difficulty : 'medium';
    questions.push({ text, choices, correct, difficulty });
  }

  const pool = !!body.pool;
  const pick = { easy: 0, medium: 0, hard: 0 };
  if(pool) {
    const rawPick = body.pick && typeof body.pick === 'object' ? body.pick : {};
    for(const d of DIFFICULTIES) {
      const count = Number(rawPick[d] || 0);
      if(!Number.isInteger(count) || count < 0) return { error: `عدد الأسئلة ${DIFFICULTY_PLURALS[d]} غير صحيح` };
      const available = questions.filter(q => q.difficulty === d).length;
      if(count > available) return { error: `يوجد ${available} سؤال ${DIFFICULTY_NAMES[d]} فقط، لا يمكن سحب ${count}` };
      pick[d] = count;
    }
    if(!(pick.easy + pick.medium + pick.hard)) return { error: 'حدد عدد الأسئلة التي تظهر لكل طالب' };
  }

  return { data: { title, description, startAt, endAt, duration, questions, pool, pick, shuffle: !!body.shuffle, showAnswers: !!body.showAnswers } };
};

exports.createTest = catchAsync(async function(req, res, next) {
  const { data, error } = buildTest(req.body);
  if(error) return next(fail(error));
  const test = await GeneralTest.create({ ...data, createdBy: req.user._id });
  res.status(201).json({ status: 'success', message: 'تم إنشاء الاختبار', data: { test: { _id: test._id } } });
});

const sameQuestions = (test, data) =>
  JSON.stringify(test.questions.map(q => ({ text: q.text, choices: [...q.choices], correct: q.correct, difficulty: q.difficulty || 'medium' }))) === JSON.stringify(data.questions);
const samePool = (test, data) =>
  !!test.pool === data.pool && (!data.pool || DIFFICULTIES.every(d => ((test.pick || {})[d] || 0) === data.pick[d]));

exports.updateTest = catchAsync(async function(req, res, next) {
  const test = await findTest(req.params.testId);
  if(!test) return next(testNotFound());
  const { data, error } = buildTest(req.body);
  if(error) return next(fail(error));

  // users already started: what they answered and how long they had must stay the same
  if(test.attemptsCount && (!sameQuestions(test, data) || !samePool(test, data) || data.shuffle !== test.shuffle ||
    data.duration !== test.duration || +data.startAt !== +test.startAt))
    return next(fail('بدأ طلاب بتقديم هذا الاختبار، يمكن تعديل العنوان والوصف ووقت النهاية وإظهار الإجابات فقط'));

  if(+data.endAt !== +test.endAt) data.resultsReady = false;
  test.set(data);
  await test.save();
  res.status(200).json({ status: 'success', message: 'تم حفظ الاختبار', data: { test: { _id: test._id } } });
});

exports.deleteTest = catchAsync(async function(req, res, next) {
  const test = await findTest(req.params.testId);
  if(!test) return next(testNotFound());
  await TestAttempt.deleteMany({ test: test._id });
  await test.deleteOne();
  res.status(200).json({ status: 'success', message: 'تم حذف الاختبار' });
});

exports.getLiveTests = catchAsync(async function(req, res, next) {
  const now = new Date();
  const tests = await GeneralTest.find({ startAt: { $lte: now }, endAt: { $gt: now } }).select('title endAt duration').sort('endAt');
  const attempts = await TestAttempt.find({ user: req.user._id, test: { $in: tests.map(t => t._id) } }).select('test submittedAt deadline');
  const byTest = new Map(attempts.map(a => [a.test.toString(), a]));

  res.status(200).json({
    status: 'success',
    data: {
      now,
      tests: tests
        .filter(t => !(byTest.get(t._id.toString()) || { isFinished: () => false }).isFinished(now.getTime()))
        .map(t => ({ _id: t._id, title: t.title, endAt: t.endAt, duration: t.duration, started: byTest.has(t._id.toString()) }))
    }
  });
});

// what the user sees while answering: no correct answers
const payloadOf = (test, attempt) => ({
  now: new Date(),
  deadline: attempt.deadline,
  answers: attempt.answers,
  questions: attempt.order.map(qi => {
    const q = test.questions[qi];
    return { index: qi, text: q.text, choices: attempt.choiceOrder[qi].map(ci => ({ index: ci, text: q.choices[ci] })) };
  })
});

// indexes of the questions one user answers, in the order they are shown
const pickQuestions = function(test) {
  let order = range(test.questions.length);
  if(test.pool) {
    order = DIFFICULTIES.flatMap(d =>
      shuffle(order.filter(qi => (test.questions[qi].difficulty || 'medium') === d)).slice(0, (test.pick || {})[d] || 0));
    order.sort((a, b) => a - b);
  }
  return test.shuffle ? shuffle(order) : order;
};

exports.startTest = catchAsync(async function(req, res, next) {
  const test = await findTest(req.params.testId);
  if(!test) return next(testNotFound());
  const now = Date.now();
  const state = test.stateAt(now);
  if(state === 'upcoming') return next(fail('لم يبدأ الاختبار بعد'));
  if(state === 'ended') return next(fail('انتهى وقت الاختبار'));

  let attempt = await TestAttempt.findOne({ test: test._id, user: req.user._id });
  if(!attempt) {
    const order = pickQuestions(test);
    const picked = new Set(order);
    // choice orders are kept by question index; questions not picked get none
    const choiceOrder = test.questions.map((q, qi) => {
      if(!picked.has(qi)) return [];
      const choices = range(q.choices.length);
      return test.shuffle ? shuffle(choices) : choices;
    });
    try {
      attempt = await TestAttempt.create({
        test: test._id,
        user: req.user._id,
        startedAt: now,
        // starting late: only the time left until the end of the test
        deadline: new Date(Math.min(now + test.duration * 60000, test.endAt.getTime())),
        order,
        choiceOrder,
        answers: test.questions.map(() => -1)
      });
      await GeneralTest.updateOne({ _id: test._id }, { $inc: { attemptsCount: 1 } });
    } catch (err) {
      // the same user pressed start twice at once
      if(err.code !== 11000) throw err;
      attempt = await TestAttempt.findOne({ test: test._id, user: req.user._id });
    }
  }

  if(attempt.isFinished(now)) return next(fail('لقد قدّمت هذا الاختبار، تظهر النتائج بعد انتهاء وقته'));
  res.status(200).json({ status: 'success', data: payloadOf(test, attempt) });
});

// answers: { questionIndex: choiceIndex (-1 = none) }
const applyAnswers = function(attempt, test, answers) {
  if(!answers || typeof answers !== 'object') return;
  const list = [...attempt.answers];
  // only the questions this user was given
  const given = new Set(attempt.order);
  Object.entries(answers).forEach(([qi, ci]) => {
    const q = given.has(Number(qi)) && test.questions[Number(qi)];
    ci = Number(ci);
    if(!q || !Number.isInteger(ci) || ci < -1 || ci >= q.choices.length) return;
    list[Number(qi)] = ci;
  });
  attempt.answers = list;
};

const openAttempt = async function(req) {
  const test = await findTest(req.params.testId);
  if(!test) return { error: testNotFound() };
  const attempt = await TestAttempt.findOne({ test: test._id, user: req.user._id });
  if(!attempt) return { error: fail('لم تبدأ هذا الاختبار') };
  if(attempt.submittedAt) return { error: fail('تم تسليم هذا الاختبار') };
  if(attempt.isFinished()) return { error: fail('انتهى وقتك، تم حفظ إجاباتك السابقة') };
  applyAnswers(attempt, test, req.body.answers);
  return { test, attempt };
};

exports.saveAnswers = catchAsync(async function(req, res, next) {
  const { attempt, error } = await openAttempt(req);
  if(error) return next(error);
  await attempt.save();
  res.status(200).json({ status: 'success', message: 'تم حفظ الإجابات' });
});

exports.submitTest = catchAsync(async function(req, res, next) {
  const { attempt, error } = await openAttempt(req);
  if(error) return next(error);
  attempt.submittedAt = new Date(Math.min(Date.now(), attempt.deadline.getTime()));
  await attempt.save();
  res.status(200).json({ status: 'success', message: 'تم تسليم الاختبار، تظهر النتائج بعد انتهاء وقته' });
});

// once the test is over: score every attempt (finished or not) and give dense ranks
exports.finalizeResults = async function(test) {
  if(test.resultsReady || Date.now() < test.endAt.getTime()) return;
  const attempts = await TestAttempt.find({ test: test._id }).select('answers order');
  const scored = attempts.map(a => ({
    id: a._id,
    score: a.order.reduce((sum, qi) => sum + (test.questions[qi] && a.answers[qi] === test.questions[qi].correct ? 1 : 0), 0)
  }));
  const marks = [...new Set(scored.map(s => s.score))].sort((a, b) => b - a);
  const rankOf = new Map(marks.map((mark, i) => [mark, i + 1]));
  if(scored.length) await TestAttempt.bulkWrite(scored.map(({ id, score }) => ({
    updateOne: { filter: { _id: id }, update: { $set: { score, rank: rankOf.get(score) } } }
  })));
  test.resultsReady = true;
  await GeneralTest.updateOne({ _id: test._id }, { resultsReady: true });
};
