const mongoose = require('mongoose');
// const Course = require('./../models/coursesModel');
const Subcourse = require('./../models/subcourseModel');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/AppError');
const Lesson = require('./../models/lessonModel');
const Question = require('./../models/questionModel');
const QuizAttempt = require('./../models/quizAttemptModel');
const { uploadLessonFile, deleteCardImages } = require('./../utils/ankiImageStorage');
const { lessonPointer, isFile } = require('./../utils/courseProgress');

const filePathsOf = videos => videos.filter(isFile).map(vid => vid.filePath);

// multer reads multipart file names as latin1
const decodeFileName = function(name = '') {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  const clean = (decoded.includes('\uFFFD') ? name : decoded).split(/[\\/]/).pop();
  return clean.slice(0, 150);
};

exports.getlessons = catchAsync(async function(req, res, next) {
  const { subcourseId } = req.params;

  if(!subcourseId) return next(new AppError('حدث خطأ, الرجاء المحاولة مجددا', 400));

  const lessons = await Lesson.find({subcourse: subcourseId});

  if(!lessons) return next(new AppError('حدث خطأ, الرجاء المحاولة مجددا', 400));
  
  res.status(200).json({
    status: "success",
    results: lessons.length,
    data: {
      lessons
    }
  })
});

exports.createLesson = catchAsync(async function(req, res, next) {
  const { title, subTitle, lessonNum } = req.body;
  const { subcourseId } = req.params;
  if(!(await Subcourse.findById(subcourseId))) return next(new AppError('هذا الكورس غير موجود', 400));

  await Lesson.create({title, subtitle: subTitle, num: lessonNum, subcourse: subcourseId, videos: []});

  res.status(201).json({
    status: "success",
    message: 'تم رفع الدرس بنجاح'
  })
});

const isEmpty = value => value === undefined || value === null || String(value).trim() === '';

const getQuizQuestionIds = videos => videos
  .filter(vid => vid.fileType === 'quiz')
  .flatMap(vid => vid.questions || []);

// Keeps lesson numbers in a subcourse continuous (1, 2, 3...) and optionally moves one lesson to a new position
const reorderLessons = async function(subcourseId, movedLesson = null, newNum = null) {
  let lessons = await Lesson.find({ subcourse: subcourseId }).sort({ num: 1 });

  if(movedLesson) {
    lessons = lessons.filter(les => les._id.toString() !== movedLesson._id.toString());
    const index = Math.min(Math.max(newNum - 1, 0), lessons.length);
    lessons.splice(index, 0, movedLesson);
  }

  const ops = lessons
    .map((les, i) => ({ id: les._id, num: i + 1, oldNum: les.num }))
    .filter(les => les.num !== les.oldNum || (movedLesson && les.id.toString() === movedLesson._id.toString()))
    .map(les => ({ updateOne: { filter: { _id: les.id }, update: { $set: { num: les.num } } } }));

  if(ops.length) await Lesson.bulkWrite(ops);
};

exports.deleteLesson = catchAsync(async function(req, res, next) {
  const { lessonId } = req.params;
  const lesson = await Lesson.findById(lessonId);

  if(!lesson) return next(new AppError('هذا الدرس غير موجود', 404, 'message'));

  const questionIds = getQuizQuestionIds(lesson.videos);
  if(questionIds.length) await Question.deleteMany({ _id: { $in: questionIds } });

  await Lesson.findByIdAndDelete(lessonId);
  await deleteCardImages(filePathsOf(lesson.videos));
  await reorderLessons(lesson.subcourse);

  res.status(200).json({
    status: 'success',
    message: 'تم حذف الدرس بنجاح'
  })
})

exports.editLesson = catchAsync(async function(req, res, next) {
  const { lessonId } = req.params;

  const lessonToEdit = await Lesson.findById(lessonId);

  if(!lessonToEdit) return next(new AppError('هذا الدرس غير موجود', 404, 'message'));

  const { title, subtitle = '', num } = req.body;

  if(isEmpty(title)) return next(new AppError('الرجاء ادخال عنوان الدرس', 400, 'message'));
  if(isEmpty(num)) return next(new AppError('الرجاء ادخال رقم الدرس', 400, 'message'));

  const newNum = Number(num);
  if(!Number.isInteger(newNum) || newNum < 1) return next(new AppError('رقم الدرس يجب أن يكون عدداً صحيحاً أكبر من صفر', 400, 'message'));

  const checkTitle = lessonToEdit.title === title.trim();
  const checkSubtitle = (lessonToEdit.subtitle || '') === subtitle.trim();
  const checkNum = lessonToEdit.num === newNum;

  if(checkTitle && checkSubtitle && checkNum) return next(new AppError('لم تقم بتعديل اي شيء', 400, 'message'));

  lessonToEdit.title = title.trim();
  lessonToEdit.subtitle = subtitle.trim();

  await lessonToEdit.save({ validateBeforeSave: false });

  if(!checkNum) await reorderLessons(lessonToEdit.subcourse, lessonToEdit, newNum);

  res.status(200).json({
    status: 'success',
    message: 'تم تعديل الدرس بنجاح'
  })
})

// TODO test
exports.addVideo = catchAsync(async function(req, res, next) {
  const { lessonNum, subcourseId } = req.params;

  const lesson = await Lesson.findOne({num: lessonNum, subcourse: subcourseId});

  if(!lesson) return next(new AppError('هذا الدرس غير موجود', 400));

  const {fileType} = req.body;

  if(fileType === "video") {
    const { title, subTitle, info, videoUrl, duration} = req.body;
    lesson.videos.push({fileType, title, subtitle: subTitle, info, videoUrl, duration, date: new Date(), num: lesson.videos.length - 1});
  }
  else if(fileType === 'quiz') {
    const {title, questionsData} = req.body;

    const fullQuestions = await Question.create(questionsData);
    let questions;
    if(fullQuestions.length) {
      questions = fullQuestions.map(qu => qu._id);
    }
    else
      questions = [fullQuestions._id];

    lesson.videos.push({fileType, title, questions, date: new Date(), num: lesson.videos.length - 1});
  }
  else if(fileType === 'file') {
    const title = String(req.body.title || '').trim();
    const info = String(req.body.info || '').trim();

    if(!title) return next(new AppError('الرجاء كتابة عنوان الملف', 400, 'message'));
    if(!req.file) return next(new AppError('الرجاء اختيار ملف', 400, 'message'));

    const fileName = decodeFileName(req.file.originalname);
    const { fileUrl, filePath } = await uploadLessonFile(req.file.buffer, fileName, lesson._id);

    lesson.videos.push({fileType, title, info, fileUrl, filePath, fileName, fileSize: req.file.size, date: new Date()});
  }
  else return next(new AppError('نوع الملف غير صحيح', 400, 'message'));

  await lesson.save({validateBeforeSave: false})

  res.status(201).json({
    status: "success",
    message: fileType === 'file' ? 'تم رفع الملف بنجاح' : 'تم رفع الفيديو بنجاح'
  })
});

const findVideoIndex = function(videos, videoNum) {
  const num = Number(videoNum);
  if(!Number.isInteger(num)) return -1;
  return videos.findIndex(vid => vid.num === num);
};

const findResource = async function(req, next, fileType) {
  const { lessonId, videoNum } = req.params;

  const lesson = await Lesson.findById(lessonId);
  if(!lesson) return next(new AppError('هذا الدرس غير موجود', 404, 'message'));

  const index = findVideoIndex(lesson.videos, videoNum);
  if(index === -1 || lesson.videos[index].fileType !== fileType)
    return next(new AppError(fileType === 'quiz' ? 'هذا الاختبار غير موجود' : 'هذا الفيديو غير موجود', 404, 'message'));

  return { lesson, index, resource: lesson.videos[index] };
};

// num is the position in the videos array (the pre save hook renumbers by index), so moving = changing position
const moveResource = function(lesson, index, newNum) {
  const videos = lesson.videos.map(vid => vid.toObject());
  const [moved] = videos.splice(index, 1);
  videos.splice(Math.min(newNum, videos.length), 0, moved);
  lesson.videos = videos;
};

const parseResourceNum = function(num, next) {
  if(isEmpty(num)) return next(new AppError('الرجاء ادخال الرقم', 400, 'message'));
  const newNum = Number(num);
  if(!Number.isInteger(newNum) || newNum < 0) return next(new AppError('الرقم يجب أن يكون عدداً صحيحاً', 400, 'message'));
  return newNum;
};

exports.editVideo = catchAsync(async function(req, res, next) {
  const found = await findResource(req, next, 'video');
  if(!found) return;
  const { lesson, index, resource: videoToEdit } = found;

  const fields = ['title', 'subtitle', 'videoUrl', 'info', 'duration'];
  const data = {};
  fields.forEach(field => data[field] = typeof req.body[field] === 'string' ? req.body[field].trim() : '');

  if(!data.title) return next(new AppError('الرجاء ادخال عنوان الفيديو', 400, 'message'));
  if(!data.videoUrl) return next(new AppError('الرجاء ادخال رابط الفيديو', 400, 'message'));
  if(!data.duration) return next(new AppError('الرجاء ادخال مدة الفيديو', 400, 'message'));

  const newNum = parseResourceNum(req.body.num, next);
  if(newNum === undefined) return;

  const checkFields = fields.every(field => (videoToEdit[field] || '') === data[field]);
  const checkNum = videoToEdit.num === newNum;

  if(checkFields && checkNum) return next(new AppError('لم تقم بتعديل اي شيء', 400, 'message'));

  fields.forEach(field => videoToEdit[field] = data[field]);
  if(!checkNum) moveResource(lesson, index, newNum);

  await lesson.save({ validateBeforeSave: false });

  res.status(200).json({
    status: 'success',
    message: 'تم تعديل الفيديو بنجاح'
  })
})

// body: { title, num, questionsData: [{ _id (existing questions only), text, answers: [4], correctAnswer: 0-3 }] }
exports.editQuiz = catchAsync(async function(req, res, next) {
  const found = await findResource(req, next, 'quiz');
  if(!found) return;
  const { lesson, index, resource: quiz } = found;

  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const { questionsData } = req.body;

  if(!title) return next(new AppError('الرجاء ادخال عنوان الاختبار', 400, 'message'));

  const newNum = parseResourceNum(req.body.num, next);
  if(newNum === undefined) return;

  if(!Array.isArray(questionsData) || questionsData.length < 1) return next(new AppError('ادخل سؤال واحد على الأقل', 400, 'message'));

  const quizQuestionIds = quiz.questions.map(id => id.toString());
  const questions = [];

  for(const q of questionsData) {
    const text = typeof q.text === 'string' ? q.text.trim() : '';
    const answers = Array.isArray(q.answers) ? q.answers.map(a => String(a).trim()) : [];
    const correctAnswer = Number(q.correctAnswer);

    if(!text || answers.length !== 4 || answers.some(a => !a)) return next(new AppError('الرجاء اكمال الأسألة', 400, 'message'));
    if(!Number.isInteger(correctAnswer) || correctAnswer < 0 || correctAnswer > 3) return next(new AppError('الاجابة الصحيحة يجب أن تكون بين 1 و 4', 400, 'message'));
    if(q._id && !quizQuestionIds.includes(String(q._id))) return next(new AppError('حدث خطأ, الرجاء المحاولة مجددا', 400, 'message'));

    questions.push({ _id: q._id ? String(q._id) : null, text, answers, correctAnswer });
  }

  const oldQuestions = await Question.find({ _id: { $in: quizQuestionIds } });
  const oldById = new Map(oldQuestions.map(q => [q._id.toString(), q]));

  const sameQuestion = (q, old) => old && old.text === q.text && old.correctAnswer === q.correctAnswer &&
    q.answers.every((a, i) => old.answers[i] === a);

  const checkTitle = quiz.title === title;
  const checkNum = quiz.num === newNum;
  const checkQuestions = questions.length === quizQuestionIds.length &&
    questions.every((q, i) => q._id === quizQuestionIds[i] && sameQuestion(q, oldById.get(q._id)));

  if(checkTitle && checkNum && checkQuestions) return next(new AppError('لم تقم بتعديل اي شيء', 400, 'message'));

  const newIds = [];
  for(const q of questions) {
    if(q._id) {
      if(!sameQuestion(q, oldById.get(q._id)))
        await Question.findByIdAndUpdate(q._id, { text: q.text, answers: q.answers, correctAnswer: q.correctAnswer });
      newIds.push(q._id);
    } else {
      const created = await Question.create({ text: q.text, answers: q.answers, correctAnswer: q.correctAnswer });
      newIds.push(created._id.toString());
    }
  }

  const removedIds = quizQuestionIds.filter(id => !newIds.includes(id));
  if(removedIds.length) await Question.deleteMany({ _id: { $in: removedIds } });

  quiz.title = title;
  quiz.questions = newIds;
  if(!checkNum) moveResource(lesson, index, newNum);

  await lesson.save({ validateBeforeSave: false });

  res.status(200).json({
    status: 'success',
    message: 'تم تعديل الاختبار بنجاح'
  })
})

exports.deleteVideo = catchAsync(async function(req, res, next) {
  const { lessonId, videoNum } = req.params;
  const lesson = await Lesson.findById(lessonId);

  if(!lesson) return next(new AppError('هذا الدرس غير موجود', 404, 'message'));

  const videoIndex = findVideoIndex(lesson.videos, videoNum);

  if(videoIndex === -1) return next(new AppError('هذا الفيديو غير موجود', 404, 'message'));

  const questionIds = getQuizQuestionIds([lesson.videos[videoIndex]]);
  if(questionIds.length) await Question.deleteMany({ _id: { $in: questionIds } });

  const [removed] = lesson.videos.splice(videoIndex, 1);

  await lesson.save({ validateBeforeSave: false });
  if(isFile(removed)) await deleteCardImages(removed.filePath);

  res.status(200).json({
    status: 'success',
    message: 'تم حذف الفيديو بنجاح'
  })
})

// files open only once reached; the CDN url is never put in the page
exports.openFile = catchAsync(async function(req, res, next) {
  const { subcourseId, lessonId, videoNum } = req.params;
  const { user } = req;
  const isAdmin = user.role === 'admin';

  if(!isAdmin && !user.subcourses.includes(subcourseId)) return next(new AppError('لم تشتري هذا الكورس', 403, 'message'));

  const lesson = await Lesson.findOne({ _id: lessonId, subcourse: subcourseId });
  if(!lesson) return next(new AppError('هذا الدرس غير موجود', 404, 'message'));

  const index = findVideoIndex(lesson.videos, videoNum);
  const file = lesson.videos[index];
  if(!file || !isFile(file) || !file.fileUrl) return next(new AppError('هذا الملف غير موجود', 404, 'message'));

  if(!isAdmin) {
    const progress = user.courseProgress.find(course => course.courseId == subcourseId);
    if(index > lessonPointer(progress, lesson.num, lesson.videos)) return next(new AppError('أكمل الدروس السابقة أولاً', 403, 'message'));
  }

  res.redirect(302, file.fileUrl);
});

exports.addQuestions = catchAsync(async function(req, res, next) {
  const { questions } = req.body;


  if(questions.length < 1) return next(new AppError('ادخل سؤال واحد على الأقل', 400));

  await Question.create(questions)

  res.status(201).json({
    status: "success",
    message: 'تم اضافة الأسالة بنجاح'
  })
});

exports.editQuestion = catchAsync(async function(req, res, next) {
  const { questionId } = req.params;

  const questionToEdit = await Question.findById(questionId);

  const { text, correctAnswer, answers } = req.body;

  if(!text) return next(new AppError('الرجاء ادخال نص السؤال', 400, 'message'));
  if(!correctAnswer) return next(new AppError('الرجاء ادخال رقم الاجابة الصحيحة', 400, 'message'));
  if(!answers || answers.length < 4) return next(new AppError('الرجاء اكمال الأسألة', 400, 'message'));


  const checkText = questionToEdit.text === text;
  const checkCorrectAnswer = questionToEdit.correctAnswer === Number(correctAnswer);
  let checkAnswers = 0;
  answers.forEach( (answer,i) => {
    if(answer === questionToEdit.answers[i]) checkAnswers++;
  })

  if(checkText && checkCorrectAnswer && checkAnswers === 4) return next(new AppError('لم تقم بتعديل اي شيء', 400, 'message'));

  questionToEdit.text = text;
  questionToEdit.correctAnswer = correctAnswer;
  questionToEdit.answers = answers;

  await questionToEdit.save({ validateBeforeSave: false });

  res.status(200).json({
    status: 'success',
    message: 'تم تعديل السؤال بنجاح'
  })
})

exports.deleteQuestion = catchAsync(async function(req, res, next) {
  const { questionId } = req.params;
  await Question.findByIdAndDelete(questionId);
  
  res.status(200).json({
    status: 'success',
    message: 'تم حذف السؤال بنجاح'
  })
})

// the lesson must belong to the course the student owns (checkActivatedSubcourse checked req.body.subcourseId)
const findQuizResource = async ({ lessonId, resourceNum, subcourseId }) => {
  if(!mongoose.isValidObjectId(lessonId) || !mongoose.isValidObjectId(subcourseId)) return null;
  const lesson = await Lesson.findOne({ _id: lessonId, subcourse: subcourseId }).populate({ path: 'videos.questions', model: 'Question' });
  return lesson?.videos.find(vid => vid.num == resourceNum) || null;
};

exports.getQuestions = catchAsync(async function(req, res, next) {
  const resource = await findQuizResource(req.body);
  if(!resource) return next(new AppError('حدث خطأ, الرجاء المحاولة مجددا', 400));

  // never send correctAnswer to the student
  const questions = resource.questions.map(({ _id, text, answers }) => ({ _id, text, answers }));

  res.status(200).json({
    status: 'success',
    results: questions.length,
    data: {
      questions
    }
  })
})

exports.solveQuestions = catchAsync(async function(req, res, next) {
  const { solvedQuestions } = req.body;
  const resource = Array.isArray(solvedQuestions) && await findQuizResource(req.body);
  if(!resource) return next(new AppError('حدث خطأ, الرجاء المحاولة مجددا', 400));

  const feedBack = [];
  let correct = 0;
  const seen = new Set();

  solvedQuestions.forEach(sq => {
    const foundQuestion = sq && resource.questions.find(q => sq.questionId == q._id.toString());
    // each question counts once, so a repeated answer can't raise the mark
    if(!foundQuestion || seen.has(foundQuestion._id.toString())) return;
    seen.add(foundQuestion._id.toString());

    if(foundQuestion.correctAnswer == sq.index)
      correct++;
    else {
      feedBack.push({
      answerIndex: sq.index,
      answerText: foundQuestion.answers[sq.index],
      questionText: foundQuestion.text,
    })
    }
  })

  const lesson = resource.ownerDocument ? resource.ownerDocument() : resource.parent();
  await QuizAttempt.create({
    user: req.user._id,
    subcourse: req.body.subcourseId,
    lesson: lesson._id,
    resourceNum: resource.num,
    lessonTitle: lesson.title,
    quizTitle: resource.title,
    correct,
    total: resource.questions.length
  });

  res.status(200).json({
    status: 'success',
    correct,
    feedBack
  })
})

exports.getEditLesson = catchAsync(async function(req, res, next) {
  const lesson = await Lesson.findById(req.params.lessonId);
  if(!lesson) return next(new AppError('هذا الدرس غير موجود', 404));
 
  res.status(200).render('editLesson', { lesson });
});
 
exports.getEditVideo = catchAsync(async function(req, res, next) {
  const { lessonId, videoNum } = req.params;

  console.log(lessonId, videoNum);
  const lesson = await Lesson.findById(lessonId);

  console.log(lesson);
  const video = lesson && lesson.videos.find(vid => vid.num === Number(videoNum) && vid.fileType === 'video');
  if(!video) return next(new AppError('هذا الفيديو غير موجود', 404));
 
  res.status(200).render('editVideo', { lesson, video });
});
 
exports.getEditQuiz = catchAsync(async function(req, res, next) {
  const { lessonId, videoNum } = req.params;
  const lesson = await Lesson.findById(lessonId).populate({ path: 'videos.questions', model: 'Question' });
  const quiz = lesson && lesson.videos.find(vid => vid.num === Number(videoNum) && vid.fileType === 'quiz');
  if(!quiz) return next(new AppError('هذا الاختبار غير موجود', 404));
 
  res.status(200).render('editQuiz', { lesson, quiz });
});
 