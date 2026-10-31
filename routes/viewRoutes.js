const express = require("express");
const User = require('./../models/userModel');
const Class = require("./../models/classesModel");
const Course = require("./../models/coursesModel");
const Subcourse = require("./../models/subcourseModel");
const Lesson = require("./../models/lessonModel");
const Question = require('./../models/questionModel')
const Subourse = require("./../models/subcourseModel");
const Workshop = require('./../models/workshopsModel');
const AnkiGroup = require('./../models/ankiGroupModel');
const catchAsync = require("./../utils/catchAsync");
const { lessonPointer } = require('./../utils/courseProgress');
const { resourceCounts, progressOf } = require('./../utils/courseStats');

const {getEditLesson, getEditQuiz, getEditVideo} = require('./../controllers/lessonController');

const { checkJWT, restrictTo, checkActivatedSubcourse, checkActivatedWorkshop } = require("./../controllers/authController");

const {
  getAnkiHome, getOfficialGroup, getCommunityGroup, getLibraryGroup, getCardEditor, getStudy, getAdminReview, getOfficialEditor
} = require('./../controllers/ankiViewController');

const router = express.Router();

const { profileGate, getCompleteProfile, postCompleteProfile } = require('./../controllers/profileController');
router.use(profileGate);
router.get('/complete-profile', checkJWT, getCompleteProfile);
router.post('/complete-profile', checkJWT, express.urlencoded({ extended: false, limit: '5kb' }), postCompleteProfile);

const { telegramGate, getJoinPage, goToTelegram, confirmJoined } = require('./../controllers/telegramController');
router.use(telegramGate);
router.get('/join-telegram', checkJWT, getJoinPage);
router.get('/join-telegram/go', checkJWT, goToTelegram);
router.post('/join-telegram/done', checkJWT, confirmJoined);

router.get("/sign-up", checkJWT, async (req, res) => {
  if (res.locals.user || req.user) {
    return res.status(200).render("toMain");
  }
  res.status(200).render("sign", {
    metaContent: 'تسجيل الدخول الى المنصة للإشتراك في الكورسات'
  });
});

const PACKAGE_SUBCOURSE_ID = '69f5aa26233985ae8767a9f8';
const HOME_COURSE_ID = process.env.HOME_COURSE_ID || '6a9eac3201a147cc688bb5ee';

router.get("/", checkJWT, catchAsync(async (req, res) => {
  const { user } = res.locals;

  const homeCourses = await Subcourse.find({ course: HOME_COURSE_ID, _id: { $ne: PACKAGE_SUBCOURSE_ID } }).sort({ _id: 1 });

  let myCourses = [];
  if(user) {
    const ownedIds = user.subcourses.map(String).filter(id => id !== PACKAGE_SUBCOURSE_ID);
    const owned = await Subcourse.find({ _id: { $in: ownedIds } });
    const totals = await resourceCounts(owned.map(c => c._id));
    myCourses = owned.map(course => ({ course, ...progressOf(user, course._id, totals[course._id.toString()] || 0) }));
  }

  res.status(200).render("mainpage", {
    user,
    homeCourses,
    homeCourseId: HOME_COURSE_ID,
    myCourses,
    title: "الصفحة الرئيسية",
    metaContent: `الدكتور إياد سكر
كورسات للصف الثالث ثانوي`
  });
}));

// old class page (no longer linked anywhere)
router.get("/classes/:classId/courses", (req, res) => res.redirect('/#courses'));

router.get("/courses/:courseId/view", checkJWT, catchAsync(async (req, res) => {
  let user = undefined;
  if (res.locals.user) {
      user  = res.locals.user;
  }

    const { courseId } = req.params;
    const course = await Subcourse.findById(courseId);
    if(!course) return res.status(400).json({
      status: 'fail',
      message: 'هذا الكورس غير موجود'
    });

    const lessons = (await Lesson.find({subcourse: course._id}).select('+videos.num'));

    for(let i = 0; i < lessons.length - 1; i++) {
      for(let j = i + 1; j < lessons.length; j ++) {
       if(lessons[i].num > lessons[j].num) {
        const a = lessons[i];
        lessons[i] = lessons[j];
        lessons[j] = a;
       } 
      }
    }

    if(!user?.subcourses.includes(course._id.toString())) {
      for(let i = 1; i < lessons.length; i++) {
        lessons[i].videos = [];
      }
    }
    for(let i = 0; i < lessons.length - 1; i++) {
      for(j = i + 1; j < lessons.length; j++) {
        if(lessons[i].num > lessons[j].num) {
          const a = lessons[i];
          lessons[i] = lessons[j];
          lessons[j] = a;
        }
      }
    }

    const progress = user?.subcourses.includes(course._id.toString())
      ? progressOf(user, course._id, lessons.reduce((sum, l) => sum + l.videos.length, 0))
      : null;

    const ankiGroups = user?.subcourses.includes(course._id.toString()) || user?.role === 'admin'
      ? await AnkiGroup.find({ isOfficial: true, parent: null, status: 'published', subcourse: course._id }).select('name')
      : [];

    res.status(200).render("courses", {
      user,
      course,
      ankiGroups,
      lessons,
      progress,
      title: course.title,
      active: course.active,
      metaContent: `الشرح لكامل لمنهاج الكتاب
شرح جميع الرسمات
تحديد كامل على الكتاب
اختبارات جميع الدروس`
    });
  })
);

router.get("/subcourses/:subcourseId/lessons", checkJWT, checkActivatedSubcourse, catchAsync(async (req, res) => {
    if (!res.locals.user) {
      return res.status(200).render("toSign");
    }

    const {resNum, lessonNum} = req.query;

    const { subcourseId } = req.params;

    const course = await Subcourse.findById(subcourseId);

    const lessons = await Lesson.find({ subcourse: subcourseId });

    for(let i = 0; i < lessons.length - 1; i++) {
      for(let j = i + 1; j < lessons.length; j ++) {
       if(lessons[i].num > lessons[j].num) {
        const a = lessons[i];
        lessons[i] = lessons[j];
        lessons[j] = a;
       } 
      }
    }

    const { user } = res.locals;
    
    const courseProgress = user.courseProgress.find(course => course.courseId == subcourseId);

    const lessonPointers = {};
    lessons.forEach(l => lessonPointers[l.num] = lessonPointer(courseProgress, l.num, l.videos));

    const resumeLesson = courseProgress?.lastLesson ?? courseProgress?.achievedVideos?.lessonNum ?? 1;
    const resumeLength = lessons.find(l => l.num == resumeLesson)?.videos.length || 0;
    const resumeRes = Math.max(0, Math.min(lessonPointers[resumeLesson] ?? 0, resumeLength - 1));

    res.status(200).render("video", {
      user,
      course,
      lessons,
      resNum,
      lessonNum,
      courseProgress,
      lessonPointers,
      resumeLesson,
      resumeRes,
      title: "الدروس",
      metaContent: "هنا تفهم العلوم!"
    });
  })
);

router.get("/workshops/:workshopId/lessons", checkJWT, checkActivatedWorkshop, catchAsync(async (req, res) => {
    if (!res.locals.user) {
      return res.status(200).render("toSign");
    }

    const { workshopId } = req.params;

    const lessons = await Lesson.find({ workshop: workshopId });

    const { user } = res.locals;
    
    res.status(200).render("video", {
      user,
      lessons,
      title: "الدروس",
      metaContent: "هنا تفهم العلوم!"
    });
  })
);

router.get("/settings", checkJWT, catchAsync(async (req, res) => {
    if (!res.locals.user) {
      return res.status(200).render("toSign");
    }
    const { user } = res.locals;
    const newUser = await User.findById(user._id).populate('subcourses').select('+role');
    let index;
    for(let i = 0; i < newUser.subcourses.length; i++) {

      if(newUser.subcourses[i]._id.toString() == "69f5aa26233985ae8767a9f8")
        index = i;
    }
    if(!isNaN(index))
      newUser.subcourses.splice(index, 1);
    
    const courses = await Promise.all(
    user.subcourses.map(id => Subcourse.findById(id))
    );

    const courseSummaries = await Promise.all(
  courses.map(async (course) => {

    // 1. Get lessons for this course
    const lessons = await Lesson.find({ subcourse: course._id });

    // 2. Count total videos inside all lessons
    const totalVideos = lessons.reduce((sum, lesson) => {
      return sum + (lesson.videos?.length || 0);
    }, 0);

    // 3. Find matching courseProgress entry
    const progress = user.courseProgress.find(
      (p) => p.courseId.toString() === course._id.toString()
    );

    // 4. Extract achievedVideosCount (default 0 if missing)
    const achievedVideosCount = progress?.achievedVideos?.achievedVideosCount || 0;

    // 5. Return clean object
    return {
      courseId: course._id,
      totalVideos,
      achievedVideosCount
    };
  })
);    

    const title = 'إعدادت الحساب';
    const metaContent = `تغيير الاسم و البريد و كلمة السر
جميع كورساتي المفعلة
تفعيل أكواد الكورسات`;

    res.status(200).render("settings", {
      user: newUser,
      title,
      metaContent,
      courses,
      courseSummaries
    });
  })
);

router.get("/upload-class", checkJWT, restrictTo("admin"),
  catchAsync(async (req, res) => {
    const { user } = res.locals;
    res.status(200).render("uploadClass", {
      user,
    });
  })
);

router.get("/classes/:classId/upload-course", checkJWT, restrictTo("admin"), catchAsync(async (req, res) => {
    const { user } = res.locals;
    res.status(200).render("uploadCourse", {
      user,
    });
  })
);

router.get("/edit-class/:classId", checkJWT, restrictTo("admin"), catchAsync(async (req, res) => {
    const { classId } = req.params;
    const classToEdit = await Class.findById(classId);
    res.status(200).render("editClass", {
      cToEdit: classToEdit,
    });
  })
);

router.get("/classes/:classId/edit-course/:courseId", checkJWT, restrictTo("admin"), catchAsync(async (req, res) => {
    const { courseId } = req.params;
    const courseToEdit = await Course.findById(courseId);
    res.status(200).render("editCourse", {
      cToEdit: courseToEdit,
    });
  })
);

router.get("/courses/:courseId/upload-subcourse", checkJWT, restrictTo("admin"), (req, res) => {
  res.status(200).render("uploadSubcourse");
});

router.get("/courses/:courseId/edit-subcourse/:subcourseId", checkJWT, restrictTo("admin"), catchAsync(async (req, res) => {
    const { subcourseId } = req.params;
    const subcourseToEdit = await Subcourse.findById(subcourseId);
    res.status(200).render("editSubcourse", {
      cToEdit: subcourseToEdit,
    });
  })
);

router.get('/subcourses/:subcourseId/upload-lesson', checkJWT, restrictTo('admin'), catchAsync(async (req, res) => {
  res.status(200).render('uploadLesson');
}))

router.get('/lessons/:subcourseId/edit-lesson/:lessonId', checkJWT, restrictTo('admin'), getEditLesson);

router.get('/lessons/:subcourseId/edit-video/:lessonId/:videoNum', checkJWT, restrictTo('admin'), getEditVideo);

router.get('/lessons/:subcourseId/edit-quiz/:lessonId/:videoNum', checkJWT, restrictTo('admin'), getEditQuiz);

router.get('/workshops/:workshopId/upload-lesson', checkJWT, restrictTo('admin'), catchAsync(async (req, res) => {
  res.status(200).render('uploadLesson');
}))

router.get('/subcourses/:subcourseId/edit-lesson/:lessonId', checkJWT, restrictTo('admin'), catchAsync(async(req, res) => {
  const { lessonId } = req.params;
  const lesson = await Lesson.findById(lessonId);

  res.status(200).render('editLesson', {
    lesson
  })
}))

router.get('/lessons/:lessonId/upload-video/:lessonNum', checkJWT, restrictTo('admin'), catchAsync(async (req, res) => {
  res.status(200).render('uploadVideo');
}))

router.get('/lessons/:lessonId/edit-video/:videoId', checkJWT, restrictTo('admin'), catchAsync(async(req, res) => {
  const { lessonId, videoId } = req.params;

  const lesson = await Lesson.findById(lessonId);

  const video = lesson.videos.find(vid => vid._id == videoId);

  res.status(200).render('editVideo', {
    video
  })
}))

router.get('/videos/:videoId/upload-question', checkJWT, restrictTo('admin'), catchAsync(async(req, res) => {
  res.status(200).render('uploadQuestion');
}))

router.get('/videos/:videoId/edit-question/:questionId', checkJWT, restrictTo('admin'), catchAsync(async(req, res) => {
  if (!res.locals.user) {
      return res.status(200).render("toSign");
    }
  const { user } = res.locals;

  const { questionId } = req.params;

  const question = await Question.findById(questionId);

  res.status(200).render('editQuestion', {
    user,
    question
  })
}))

router.get('/camp', checkJWT, catchAsync(async(req, res) => {
  let user = undefined;
    if (res.locals.user) {
        user  = res.locals.user;
    }

  let checked = false;
  const subcourses = ['69ed6fb1ad45e39f4a699ff0', '69ed6fc7ad45e39f4a699ff1', '69ed6fecad45e39f4a699ff2', '69ed7003ad45e39f4a699ff3', '69ed7023ad45e39f4a699ff4'];

  if(user)
    subcourses.forEach(sb =>{
   if(user.subcourses.includes(sb)) checked = true
  })

  res.status(200).render('camp', {
    buy_msg: "هل تريد شراء المعسكر",
    checked
  });
}))

router.get('/form', checkJWT, restrictTo('admin'), catchAsync(async(req, res) => {
  if (!res.locals.user) {
      return res.status(200).render("toSign");
    }
  res.status(200).render('form');
}))

router.get('/admin-users', checkJWT, restrictTo('admin'), catchAsync((req, res) => {
  res.status(200).render('adminUsers');
}))

// Telegram bot control panel (menus, posts, questions, subscribers, settings)
router.get('/bot-admin', checkJWT, restrictTo('admin'), (req, res) => {
  res.status(200).render('botAdmin');
});

// Codex website consultation requests (hidden admin page, not linked anywhere)
router.get('/codex-requests', checkJWT, restrictTo('admin'), (req, res) => {
  res.status(200).render('codexRequests');
});

// PDF splitter (hidden admin tool, not linked anywhere); splitting happens in the browser
router.get('/pdf-split', checkJWT, restrictTo('admin'), (req, res) => {
  res.status(200).render('pdfSplit');
});

router.get('/code-api', checkJWT, restrictTo('admin'), catchAsync((req, res) => {
  res.status(200).render('code-api');
}))

const { getTests, getTest, getResults, getTestEditor } = require('./../controllers/generalTestViewController');
router.get('/tests', (req, res, next) => { res.locals.siteTab = 'tests'; next(); }, checkJWT, getTests);
router.get('/tests/new', checkJWT, restrictTo('admin'), getTestEditor);
router.get('/tests/:testId', checkJWT, getTest);
router.get('/tests/:testId/edit', checkJWT, restrictTo('admin'), getTestEditor);
router.get('/tests/:testId/results', checkJWT, getResults);

router.get('/anki', checkJWT, getAnkiHome('library'));
router.get('/anki/curriculum', checkJWT, getAnkiHome('curriculum'));
router.get('/anki/community', checkJWT, getAnkiHome('community'));
 
router.get('/anki/official/new', checkJWT, restrictTo('admin'), getOfficialEditor);
router.get('/anki/official/:groupId', checkJWT, getOfficialGroup);
router.get('/anki/official/:groupId/edit', checkJWT, restrictTo('admin'), getOfficialEditor);
router.get('/anki/official/:groupId/add-card', checkJWT, restrictTo('admin'), getCardEditor);
router.get('/anki/official/:groupId/cards/:cardId/edit', checkJWT, restrictTo('admin'), getCardEditor);
router.get('/anki/community/:groupId', checkJWT, getCommunityGroup);
 
router.get('/anki/library/:groupId', checkJWT, getLibraryGroup);
router.get('/anki/library/:groupId/add-card', checkJWT, getCardEditor);
router.get('/anki/library/:groupId/cards/:cardId/edit', checkJWT, getCardEditor);
 
router.get('/anki/groups/:groupId/study', checkJWT, getStudy);
 
router.get('/anki/admin/review', checkJWT, restrictTo('admin'), getAdminReview);
 

// students dashboard: admins see every student, supervisors only the students of their groups
const { getDashboard, getStudent, getGroups, getSupervisors } = require('./../controllers/dashboardController');
router.get('/dashboard', checkJWT, restrictTo('admin', 'supervisor'), getDashboard);
router.get('/dashboard/students/:userId', checkJWT, restrictTo('admin', 'supervisor'), getStudent);
router.get('/dashboard/groups', checkJWT, restrictTo('admin'), getGroups);
router.get('/dashboard/supervisors', checkJWT, restrictTo('admin'), getSupervisors);

module.exports = router;