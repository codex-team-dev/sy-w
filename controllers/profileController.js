const User = require('./../models/userModel');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/AppError');

const PROFILE_PAGE = '/complete-profile';
const PHONE = /^09\d{8}$/;

// accounts made before sign-up asked for phones and birthday must add them before using the site
const needsProfile = user => !!user && user.role !== 'admin' && user.role !== 'supervisor' &&
  (!user.studentId || !user.parentPhone || !user.dob);

exports.needsProfile = needsProfile;

exports.profileGate = function(req, res, next) {
  if(req.originalUrl.startsWith('/api') || req.path.startsWith(PROFILE_PAGE)) return next();
  if(!needsProfile(res.locals.user)) return next();
  if(req.method !== 'GET') return next(new AppError('الرجاء إكمال معلومات حسابك أولا', 403));
  res.redirect(PROFILE_PAGE);
};

exports.profileApiGate = function(req, res, next) {
  if(req.path === '/v1/users/logout' || !needsProfile(req.user)) return next();
  next(new AppError('الرجاء إكمال معلومات حسابك أولا', 403));
};

const toLatinDigits = v => String(v ?? '').trim().replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

// <input type="date"> sends YYYY-MM-DD; stored as DD.MM.YYYY like the sign-up form
const parseDate = v => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if(!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if(date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  const year = new Date().getUTCFullYear();
  if(y < 1950 || y > year - 5) return null;
  return `${m[3]}.${m[2]}.${m[1]}`;
};

const render = (res, status, values, error) => res.status(status).render('completeProfile', {
  values,
  error,
  maxDate: `${new Date().getUTCFullYear() - 5}-12-31`
});

exports.getCompleteProfile = function(req, res) {
  const user = res.locals.user;
  if(!needsProfile(user)) return res.redirect('/');
  render(res, 200, { studentId: user.studentId || '', parentPhone: user.parentPhone || '', dob: '' });
};

exports.postCompleteProfile = catchAsync(async function(req, res) {
  const user = res.locals.user;
  if(!needsProfile(user)) return res.redirect('/');

  const body = req.body || {};
  const values = { studentId: toLatinDigits(body.studentId), parentPhone: toLatinDigits(body.parentPhone), dob: toLatinDigits(body.dob) };
  const dob = parseDate(values.dob);

  if(!PHONE.test(values.studentId)) return render(res, 400, values, 'رقم هاتف الطالب غير صالح، يجب أن يبدأ بـ 09 ويتكون من 10 أرقام');
  if(!PHONE.test(values.parentPhone)) return render(res, 400, values, 'رقم هاتف ولي الأمر غير صالح، يجب أن يبدأ بـ 09 ويتكون من 10 أرقام');
  if(values.parentPhone === values.studentId) return render(res, 400, values, 'رقم ولي الأمر يجب أن يختلف عن رقم الطالب');
  if(!dob) return render(res, 400, values, 'تاريخ الميلاد غير صالح');

  await User.updateOne({ _id: user._id }, { studentId: values.studentId, parentPhone: values.parentPhone, dob }, { runValidators: true });
  res.redirect('/');
});
