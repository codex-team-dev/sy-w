const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./../models/userModel');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/AppError');
const sendMail = require('./../utils/email.js');
const crypto = require('crypto');
const BAD_CREDENTIALS = 'Validation Error: الاسم أو كلمة السر غير صحيحة';
// a real hash to compare against when the account does not exist (constant-time-ish login)
const DUMMY_HASH = bcrypt.hashSync('unused-placeholder-password', 12);
const { promisify } = require('util');
const Workshop = require('./../models/workshopsModel.js');
const Lesson = require('./../models/lessonModel');
const { lessonPointer } = require('./../utils/courseProgress');

const signToken = user => jwt.sign({id: user._id}, process.env.JWT_SECRET_KEY, {expiresIn: process.env.JWT_EXPIRES_IN});

exports.checkLink = function(req, res, next) {
  if(req.originalUrl.startsWith('/login') || req.originalUrl.startsWith('/sign-up') || req.originalUrl.startsWith('/api/v1/users/login') || req.originalUrl.startsWith('/api/v1/users/signup')) {
    req.nextLink = true;
  }
  next();
}

exports.checkJWT = catchAsync(async function(req, res, next) {
  if(req.nextLink) {
    req.nextLink = false;
    return next();
  }

  //1) Check if a token exists: PT 
  let token;

  if(req.cookies.jwtStudyou){
    token = req.cookies.jwtStudyou;
  } else if((req.headers.authorization && req.headers.authorization.startsWith('Bearer'))) {
    token = req.headers.authorization.split(' ')[1];
    } else {
        if(!req.originalUrl.startsWith('/api')){ 
          return next();
        }
  return next(new AppError('انت غير مسجل, الرجاء تسجيل الدخول', 401));
} 

  // if(!token) return next(new AppError('انت غير مسجل, الرجاء تسجيل الدخول', 401));
  //2) Validate the token PT
  let decoded;
  try {
    decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET_KEY);
  } catch(err) {
    if(!req.originalUrl.startsWith('/api') ){
      return next();
    }
    return next(new AppError('انت غير مسجل, الرجاء تسجيل الدخول', 401));
  }
  const { id } = decoded;

  if(!id) {
    if(!req.originalUrl.startsWith('/api') ) return next();    
    return next(new AppError('انت غير مسجل, الرجاء تسجيل الدخول', 401))
  }

  
  //3) Check if a user exists PT

    const user = await User.findOne({_id: id, active: true}).select('+role +active +solveBook');
    if(!user) {
      if(!req.originalUrl.startsWith('/api') ) return next();
      return next(new AppError('انت غير مسجل, الرجاء تسجيل الدخول', 401));
    }
  //4) Check if user changed password after the token was issued PT

  if(user.checkChangedPassword(decoded.iat)) {
    if(!req.originalUrl.startsWith('/api') ) return next();
    return next(new AppError('لقد تم تغيير كلمة السر, الرجاء تسجيل الدخول مرة أخرى', 401))
} 
  //5) If valid token, call next(); PT
    if(!req.originalUrl.startsWith('/api') ) res.locals.user = user;
    else req.user = user;

    next();
})

exports.restrictTo = function(...roles) {
  return catchAsync(async function(req, res, next) {
    const user = req.user ?? res.locals.user;
    if(!user) return next(new AppError('ليس لديك الاذن لاجراء هذه العملية', 403))
    if(!roles.includes(user.role)) return next(new AppError('ليس لديك الاذن لاجراء هذه العملية', 403));

    next();
  })
}


exports.signup = catchAsync(async function(req, res, next) {  
    const { name, email, password, passwordConfirm, screenWidth, screenHeight, userAgent, studentId, parentPhone, dob, referral } = req.body;

    if(!screenWidth || !screenHeight || !userAgent) return next(new AppError('Validation Error: حدث خطأ', 400, 'name'));

    const user = await User.create({name, email, password, passwordConfirm, screenWidth, screenHeight, userAgent, studentId, parentPhone, dob, referral});
    const token = signToken(user);

    const cookieOptions = {
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      httpOnly: true,
      sameSite: 'Lax',
      path: '/'
    };

    if(process.env.NODE_ENV === 'production') cookieOptions.secure = true; 

    res.cookie('jwtStudyou', token, cookieOptions);

    res.status(201).json({
      status: 'success'
    })
})

exports.login = catchAsync(async function(req, res, next) {
  const {name, password, screenWidth, screenHeight, userAgent} = req.body;

  if(!name) return next(new AppError('Validation Error: الرجاء ادخال الاسم الكامل', 400, 'name'));
  if(!password) return next(new AppError('Validation Error: الرجاء ادخال كلمة السر', 400, 'password'));

  const user = await User.findOne({name, active: true}).select('+role');
  // Same message/status whether the name or the password is wrong, so the login form
  // cannot be used to discover which accounts exist. The dummy compare keeps the
  // response time of an unknown name close to that of a wrong password.
  if(!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    return next(new AppError(BAD_CREDENTIALS, 400, 'password'));
  }

  if(user.role !== 'admin'){

  if((!(user.screenWidth == screenWidth && user.screenHeight == screenHeight) && !(user.screenWidth == screenHeight && user.screenHeight == screenWidth))){
    // user.active = false;
    user.reasonToBlock += `Wrong Height and Width: 
    Saved (Width/Height) = (${user.screenWidth}/${user.screenHeight})
    Entered (Width/Height) = (${screenWidth}/${screenHeight})`;
    
    await user.save({validateBeforeSave: false});
    // return next(new AppError('Validation Error: هذا المستخدم غير موجود', 404, 'name'))
  }
   if(user.userAgent !== userAgent) {
    // user.active = false;
    user.reasonToBlock += `Wrong useragent:
    Saved: ${user.userAgent}
    Entered: ${userAgent}`;

    await user.save({validateBeforeSave: false});
    // return next(new AppError('Validation Error: هذا المستخدم غير موجود', 404, 'name'))
  }
}

  if(!(await user.correctPassword(password, user.password))) return next(new AppError(BAD_CREDENTIALS, 400, 'password'));

  const token = signToken(user);

  const cookieOptions = {
    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    httpOnly: true,
    sameSite: 'Lax',
    path: '/'
  };

  if(process.env.NODE_ENV === 'production') cookieOptions.secure = true; 

  res.cookie('jwtStudyou', token, cookieOptions);

  res.status(200).json({
    status: 'success',
  })

})

exports.logout = (req, res) => {
  res.cookie('jwtStudyou', 'loggedout', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true
  });
  res.status(200).json({ status: 'success' });
};
// exports.forgotPassword = catchAsync(async function(req, res, next) {
//   const { email } = req.body;
//   if(!email) return next(new AppError('Please enter your email', 400));

//   const user = await User.findOne({email});
//   if(!user) return next(new AppError('There is no account with this email', 404));

//   const resetToken = await user.createResetToken();

//   await sendMail(user.email, `To reset your password follow this link: http://127.0.0.1/api/v1/users/reset-password/${resetToken}`, 'Reseting the password');

//   res.status(200).json({
//     status: 'success'
//   })
// })

// exports.resetPassword = catchAsync(async function(req, res, next) {
//   const { resetToken } = req.params;
//   if(!resetToken) return next(new AppError('You need a reset token', 400));

//   const hashedResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');

//   const user = await User.findOne({passwordResetToken: hashedResetToken, passwordResetTokenExpiresIn: {$gt: Date.now()}});

//   if(!user) return next(new AppError('Reset Token unvalid or outdated', 400));

//   const { curPassword, password, passwordConfirm } = req.body;
//   if(!(await user.correctPassword((curPassword + ''), user.password))) return next(new AppError('Sorry, your password is incorrect, please try again', 400));

  
//   user.password = password;
//   user.passwordConfirm = passwordConfirm;

//   const err = user.validateSync('password');
//   if(err) return next(new AppError(err.message, 400));

//   const err2 = user.validateSync('passwordConfirm');
//   if(err2) return next(new AppError(err2.message, 400));

//   user.passwordResetToken = undefined;
//   user.passwordResetTokenExpiresIn = undefined;

//   await user.save({validateBeforeSave: false});


//   res.status(200).json({
//     status: 'success'
//   })
// })

exports.checkFingerPrint = function(req, res, next) {
  const userAgent = req.headers['user-agent'];

  next();
}

exports.updatePassword = catchAsync(async function(req, res, next) {
  const { user } = req;

  const {password} = req.body;

  if(!password) return next(new AppError('الرجاء ادخال كلمة السر الجديدة', 400, 'password'));
  
  // if(! await user.correctPassword(currentPassword, user.password)) return next(new AppError('كلمة السر غير صحيحة', 400, 'current-password'));

  user.password = password;
  user.passwordConfirm = password;

  const err1 = user.validateSync('password');
  const err2 = user.validateSync('passwordConfirm')
  if(err1) throw err1;
  if(err2) throw err2;
 
  await user.save({ validateBeforeSave: false});

  res.status(200).json({
    status: 'success',
    message: 'تم تحديث كلمة السر بنجاح'
  })
})

exports.updateCertainPassword = catchAsync(async function(req, res, next) {

  const {password, userID} = req.body;

  const user = await User.findOne({name: userID});


  if(!password) return next(new AppError('الرجاء ادخال كلمة السر الجديدة', 400, 'password'));
  if(!user) return next(new AppError('الرجاء ادخال المستخدم', 400, 'password-confirm'));
  
  user.password = password;

  const err1 = user.validateSync('password');
  if(err1) {
    throw err1};
 
  await user.save({ validateBeforeSave: false});

  res.status(200).json({
    status: 'success',
    message: 'تم تحديث كلمة السر بنجاح'
  })
})

exports.updateEmailName = catchAsync(async function(req, res, next) {
  const { user } = req;
  
  const { email, name } = req.body;
  if(!email) return next(new AppError('الرجاء ادخال البريد الالكتروني', 400, 'email'));
  if(!name) return next(new AppError('الرجاء ادخال الاسم', 400, 'name'));

  const checkEmail = user.email === email;
  const checkName = user.name === name;

  if(checkEmail && checkName) return res.status(400).json({
    status: 'fail',
    message: 'لم تقم بتحديث اي شيء',
    path: 'message'
  })

  if(!checkEmail) {
    const exact = await User.findOne({email});

    if(exact) return next(new AppError('هذا البريد غير صالح', 400, 'email'));
  }

  if(!checkName) {
    const exact = await User.findOne({name});
    if(exact) return next(new AppError('هذا الاسم غير صالح', 400, 'name'));
  }

  if(!checkEmail) {
    user.email = email;
    const err1 = user.validateSync('email');
    if(err1) throw err1;
  } 
  if(!checkName) {
    user.name = name;
    const err2 = user.validateSync('name');
    if(err2) throw err2;
  } 

  if(!checkEmail || !checkName) await user.save( { validateBeforeSave: false });



  res.status(200).json({
    status: 'success',
    message: 'تم تحديث الاسم و البريد بنجاح',
    path: 'message'
  })
})

exports.checkActivatedSubcourse = catchAsync(async function(req, res, next) {
  if(!res.locals.user && !req.user) return res.status(400).render('toSign') 

  let { subcourseId } = req.body;
  if(!subcourseId) subcourseId  = req.params.subcourseId;
  if(!subcourseId) return next(new AppError('هذا الكورس غير موجود', 400));
  let { user } = req;
  if(!user) user = res.locals.user;
  
  if(user.subcourses.includes(subcourseId)) return next();

  res.status(400).json({
    status: 'fail',
    message: 'لم تشتري هذا الكورس، لا تخبص'
  })
})

exports.checkActivatedWorkshop = catchAsync(async function(req, res, next) {
  if(!res.locals.user && !req.user) return res.status(400).render('toSign') 

  let { workshopId } = req.body;
  if(!workshopId) workshopId  = req.params.workshopId;
  if(!workshopId) return next(new AppError('هذه الورشة غير موجودة', 400));
  let { user } = req;
  if(!user) user = res.locals.user;
  
  if(user.workshops.includes(workshopId)) return next();

  res.status(400).json({
    status: 'fail',
    message: 'لم تشتري هذه الورشة, لا تخبص -_-'
  })
})

exports.activateUser = catchAsync(async function(req, res, next) {
  const { username } = req.body;
  const user = await User.findOne({name: username});
  if(!user) return next(new AppError('هذا المستخدم غير موجود', 404));

  user.active = true;
  await user.save({validateBeforeSave: false});

  res.status(200).json({
    status: 'success',
    message: "User actiivated successfully"
  })
})

exports.addPackage = catchAsync(async function(req, res, next) {
  const { username } = req.body;

  const user = await User.findOne({name: username});
  if(!user) return next(new AppError('هذا المستخدم غير موجود', 404));

  user.solveBook = true;
  if(!user.subcourses.includes('69f5aa26233985ae8767a9f8')) user.subcourses.push('69f5aa26233985ae8767a9f8')
  await user.save({validateBeforeSave: false});

  res.status(200).json({
    status: 'success',
    message: "package added successfully"
  })
})

exports.updateProgress = catchAsync(async function(req, res, next) {
  const { user } = req;
  const { subcourseId } = req.body;
  const lessonNum = Number(req.body.newLesson);
  const newRes = Number(req.body.newRes);

  const progress = user.courseProgress.find(course => course.courseId == subcourseId);
  if(!progress || !Number.isInteger(lessonNum) || !Number.isInteger(newRes)) return next(new AppError('بيانات التقدم غير صحيحة', 400));

  const lesson = await Lesson.findOne({ subcourse: subcourseId, num: lessonNum });
  if(!lesson) return next(new AppError('هذا الدرس غير موجود', 400));

  const current = lessonPointer(progress, lessonNum, lesson.videos);

  let updatedCourseProgress;
  if(newRes === current + 1 && newRes <= lesson.videos.length) {
    const saved = progress.lessons.find(l => l.lessonNum === lessonNum);
    if(saved) saved.videoNumber = newRes;
    else progress.lessons.push({ lessonNum, videoNumber: newRes });
    if(lesson.videos[newRes - 1].fileType !== 'file') progress.achievedVideos.achievedVideosCount++;
    updatedCourseProgress = progress;
  }
  progress.lastLesson = lessonNum;

  await user.save({validateBeforeSave: false});

  res.status(200).json({
    status: "success",
    message: "تم تحديث التقدم",
    data: updatedCourseProgress
  })
})