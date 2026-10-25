// Codex website consultation requests: public submit (cross-origin) + admin dashboard API
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const CodexRequest = require('./../models/codexRequestModel');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/AppError');

const PROJECT_TYPES = ['متجر إلكتروني', 'منصة تعليمية', 'منصة تداول', 'موقع شخصي', 'تطبيق جوال', 'مشروع آخر'];
const BUDGETS = ['أقل من 500$', '500$ – 1,500$', '1,500$ – 5,000$', 'أكثر من 5,000$', 'غير محددة'];
const DEADLINES = ['غير مستعجل', 'خلال شهر', 'خلال أسبوعين', 'عاجل'];

const fail = msg => new AppError(msg, 400, 'message');
// xssClean turns "<" into "&lt;"; these are shown with textContent, so undo it
const text = (value, max) => String(value ?? '').replace(/&lt;/g, '<').trim().slice(0, max);

// Optional CODEX_ORIGINS: comma separated origins allowed to submit, e.g. https://codex.dev,https://www.codex.dev
// When unset any site may submit (public form, no cookies, rate limited)
const codexOrigins = () => (process.env.CODEX_ORIGINS || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);

exports.cors = cors({
  origin: (origin, cb) => {
    const allowed = codexOrigins();
    cb(null, !allowed.length || allowed.includes(origin));
  },
  methods: ['POST'],
  allowedHeaders: ['Content-Type']
});

exports.submitLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ status: 'fail', message: 'أرسلت طلبات كثيرة، حاول مرة أخرى بعد قليل' })
});

exports.createRequest = catchAsync(async (req, res, next) => {
  const b = req.body || {};
  // honeypot: real visitors never fill this hidden field
  if(text(b.website, 200)) return res.status(201).json({ status: 'success' });

  const data = {
    projectType: text(b.projectType, 60),
    budget: text(b.budget, 60),
    deadline: text(b.deadline, 60),
    name: text(b.name, 100),
    phone: text(b.phone, 30),
    location: text(b.location, 120),
    email: text(b.email, 120),
    details: text(b.details, 3000)
  };

  if(!PROJECT_TYPES.includes(data.projectType)) return next(fail('اختر نوع المشروع'));
  if(!BUDGETS.includes(data.budget)) return next(fail('اختر الميزانية'));
  if(!DEADLINES.includes(data.deadline)) data.deadline = DEADLINES[0];
  if(data.name.length < 3) return next(fail('أدخل اسمك'));
  if(!/^[+\d][\d\s-]{7,}$/.test(data.phone)) return next(fail('أدخل رقم هاتف صحيح'));
  if(!data.location) return next(fail('أدخل مكان السكن'));
  if(data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return next(fail('البريد الإلكتروني غير صحيح'));
  if(data.details.length < 10) return next(fail('اكتب وصفاً مختصراً'));

  await CodexRequest.create(data);
  res.status(201).json({ status: 'success' });
});

exports.getRequests = catchAsync(async (req, res) => {
  const [requests, grouped] = await Promise.all([
    CodexRequest.find().sort({ createdAt: -1 }).limit(1000).lean(),
    CodexRequest.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }])
  ]);
  const counts = { all: 0, new: 0, contacted: 0, done: 0 };
  grouped.forEach(g => { counts[g._id] = g.n; counts.all += g.n; });
  res.status(200).json({ status: 'success', counts, requests });
});

exports.updateRequest = catchAsync(async (req, res, next) => {
  if(!mongoose.isValidObjectId(req.params.id)) return next(new AppError('الطلب غير موجود', 404, 'message'));
  const update = {};
  if(req.body.status !== undefined) {
    if(!CodexRequest.STATUSES.includes(req.body.status)) return next(fail('حالة غير صحيحة'));
    update.status = req.body.status;
  }
  if(req.body.note !== undefined) update.note = text(req.body.note, 2000);
  const request = await CodexRequest.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
  if(!request) return next(new AppError('الطلب غير موجود', 404, 'message'));
  res.status(200).json({ status: 'success', request });
});

exports.deleteRequest = catchAsync(async (req, res, next) => {
  if(!mongoose.isValidObjectId(req.params.id)) return next(new AppError('الطلب غير موجود', 404, 'message'));
  const request = await CodexRequest.findByIdAndDelete(req.params.id);
  if(!request) return next(new AppError('الطلب غير موجود', 404, 'message'));
  res.status(200).json({ status: 'success' });
});
