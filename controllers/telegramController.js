const User = require('./../models/userModel');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/AppError');
const { getInviteLink } = require('./../utils/telegramInvite');

const JOIN_PAGE = '/join-telegram';

const needsJoinPage = user => !!user && user.role !== 'admin' && !user.telegramJoined && user.subcourses.length > 0;

// sends students who bought their first course to the join page until they confirm
exports.telegramGate = function(req, res, next) {
  if(req.method !== 'GET' || req.originalUrl.startsWith('/api') || req.path.startsWith(JOIN_PAGE) || req.path.startsWith('/complete-profile')) return next();
  if(!needsJoinPage(res.locals.user)) return next();
  res.redirect(JOIN_PAGE);
};

exports.getJoinPage = function(req, res) {
  if(!needsJoinPage(res.locals.user)) return res.redirect('/');
  res.status(200).render('joinTelegram', {
    mustOpenFirst: req.query.open === 'first'
  });
};

exports.goToTelegram = catchAsync(async function(req, res, next) {
  const user = res.locals.user;
  if(!needsJoinPage(user)) return res.redirect('/');

  const link = await getInviteLink(user);
  if(!link) return next(new AppError('رابط القناة غير متوفر حاليا', 500));

  await User.updateOne({ _id: user._id }, { telegramOpenedAt: Date.now() });
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  res.redirect(link);
});

exports.confirmJoined = catchAsync(async function(req, res) {
  const user = res.locals.user;
  if(!needsJoinPage(user)) return res.redirect('/');

  const { telegramOpenedAt } = await User.findById(user._id).select('+telegramOpenedAt');
  if(!telegramOpenedAt) return res.redirect(`${JOIN_PAGE}?open=first`);

  await User.updateOne({ _id: user._id }, { telegramJoined: true });
  res.redirect('/');
});
