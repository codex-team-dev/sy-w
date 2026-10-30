const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const morgan = require('morgan');
const errorController = require('./controllers/errorController');
const cors = require('cors');
const viewRouter = require('./routes/viewRoutes')
const cookieParser = require('cookie-parser');

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const xssProtecter = require('./utils/xssClean');
const noSQLSanitizer = require('express-mongo-sanitize');

const { checkJWT, checkLink } = require('./controllers/authController');

const app = express();

// behind Render's proxy: req.ip is the visitor, not the proxy
app.set('trust proxy', 1);

app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'))

dotenv.config({path: './config.env'});

//SEC Middleware
// sign.js shows message.slice(17), so keep the "Validation Error: " prefix
const tooManyRequests = (req, res) => res.status(429).json({
  status: 'fail',
  message: 'Validation Error: طلبات كثيرة جدا، انتظر قليلا ثم حاول مجددا',
  path: 'name'
});
const userOrIp = (req, res) => String((req.user ?? res.locals.user)?._id ?? req.ip);
const limiter = options => rateLimit({ handler: tooManyRequests, standardHeaders: 'draft-7', legacyHeaders: false, ...options });

const overallLimiter = limiter({ windowMs: 6 * 1000, limit: 110, keyGenerator: userOrIp });
const apiLimiter = limiter({ windowMs: 6 * 1000, limit: 15, keyGenerator: userOrIp });
const loginLimiter = limiter({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true });
const signupLimiter = limiter({ windowMs: 60 * 60 * 1000, limit: 20 });

app.use('/api/v1/users/signup', signupLimiter);
app.use('/api/v1/users/login', loginLimiter);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      frameSrc: ["https://iframe.mediadelivery.net/"],
      connectSrc: ["'self'", process.env.CONNECT_SRC],
      imgSrc: ["'self'", "data:", "https://studyou-pull-zone.b-cdn.net"],
    }
  },
  // the Bunny video iframe may check the referrer
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));



// a test with a big question pool is sent in one request
app.use('/api/v1/tests', express.json({ limit: '1mb' }));
app.use(express.json({ limit: '100kb' }));

// Data sanitization againt NoSQL query injection, XSS
app.use(noSQLSanitizer());
app.use(xssProtecter());

app.use(cookieParser());
app.use(morgan('dev'));
// Codex website (another domain) sends consultation requests here without logging in
const codexRequests = require('./controllers/codexRequestController');
app.options('/api/v1/codex-requests', codexRequests.cors);
app.post('/api/v1/codex-requests', codexRequests.cors, codexRequests.submitLimiter, codexRequests.createRequest);

const allowedOrigins = ['https://studyou.online', 'https://sy-w.onrender.com'];
if(process.env.NODE_ENV !== 'production') allowedOrigins.push('http://127.0.0.1:3000', 'http://127.0.0.1:8080');
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// CSRF defense-in-depth: the auth cookie is SameSite=Lax, so browsers already
// withhold it on cross-site state-changing requests. On top of that, reject any
// state-changing request whose Origin header is present but not in our allowlist.
// (The public cross-origin codex-requests POST is registered above this point.)
const stateChangingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
app.use((req, res, next) => {
  if(!stateChangingMethods.has(req.method)) return next();
  const origin = req.get('origin');
  if(origin && !allowedOrigins.includes(origin)) {
    return res.status(403).json({ status: 'fail', message: 'طلب غير مسموح من مصدر خارجي' });
  }
  next();
});

app.use('/', checkLink, checkJWT, overallLimiter);
app.use('/api', checkLink, checkJWT, apiLimiter);

// files in public/tests; anything else (/tests/new, /tests/:testId...) goes on to the general tests pages
app.use('/tests', express.static(path.join(__dirname, 'public', 'tests'), { index: false, redirect: false }));

// root makes send() reject '..' so encoded paths like /css/..%2F..%2Fconfig.env can't leave the folder
const servePublic = (...dir) => (req, res, next) => {
  res.sendFile(req.params.file, { root: path.join(__dirname, 'public', ...dir) }, err => err && next());
};

app.get('/my-favicon/:file', servePublic('my-favicon'))

app.get('/xml/sitemap.xml', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'xml', 'sitemap.xml'))
})

app.get('/xml/sitemap2.xml', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'xml', 'sitemap2.xml'))
})

app.get('/css/:file', servePublic('css'))
app.get('/js/:file', servePublic('js'))

app.get('/js/anki/:file', servePublic('js', 'anki'))

app.get('/js/tests/:file', servePublic('js', 'tests'))

// browser builds of npm packages, whitelisted by name
const vendorFiles = {
  'pdf-lib.min.js': 'pdf-lib/dist/pdf-lib.min.js',
  'jszip.min.js': 'jszip/dist/jszip.min.js'
};
app.get('/js/vendor/:file', (req, res, next) => {
  if(!Object.hasOwn(vendorFiles, req.params.file)) return next();
  res.sendFile(vendorFiles[req.params.file], { root: path.join(__dirname, 'node_modules') }, err => err && next());
})

app.get('/imgs/:file', servePublic('imgs'))

app.get('/imgs/classes/:file', servePublic('imgs', 'classes'))
app.get('/imgs/subcourses/:file', servePublic('imgs', 'subcourses'))

app.get('/imgs/courses/:file', servePublic('imgs', 'courses'))

app.get('/imgs/workshops/:file', servePublic('imgs', 'workshops'))

// app.use('/.well-known/:file', (req, res) => {
//   res.sendFile(path.join(__dirname, "public", ".well-known", req.params.file));
// })

// app.use((req, res, next) => {
//   console.log(req.cookies);
//   next();
// })

const userRouter = require('./routes/userRoutes');
const classRouter = require('./routes/classesRoutes');
const courseRouter = require('./routes/coursesRoutes');
const subcourseRouter = require('./routes/subcourseRoutes');
const lessonRouter = require('./routes/lessonRoutes');
const videoRouter = require('./routes/videoRoutes');
const questionRouter = require('./routes/questionRoutes');
const codeRouter = require('./routes/codeRoutes');
const workshopRouter = require('./routes/workshopRoutes');
const excelFormRouter = require('./routes/excelFormRoutes');
const notesRouter = require('./routes/notesRouter');
const savedVideosRouter = require("./routes/savedVideosRoutes");

app.use('/', viewRouter);
app.use('/api/v1/users', userRouter);
app.use('/api/v1/classes', classRouter);
app.use('/api/v1/classes/:classId/courses', courseRouter);
app.use('/api/v1/courses/:courseId/subcourses', subcourseRouter);
app.use('/api/v1/subcourses/:subcourseId/lessons', lessonRouter);
app.use('/api/v1/lessons/:subcourseId/videos', videoRouter);
app.use('/api/v1/questions', questionRouter);
app.use('/api/v1/codes', codeRouter);
app.use('/api/v1/workshops', workshopRouter);
app.use('/api/v1/forms', excelFormRouter);
app.use('/api/v1/notes/:subcourseId', notesRouter);
app.use("/api/v1/saved-videos", savedVideosRouter);
app.use('/api/v1/anki', require('./routes/ankiRoutes'));
app.use('/api/v1/tests', require('./routes/generalTestRoutes'));
app.use('/api/v1/bot', require('./routes/botRoutes'));
app.use('/api/v1/codex-requests', require('./routes/codexRequestRoutes'));

app.use(errorController);

app.all('*', (req, res, next) => {
  res.status(404).json({
    status: 'fail',
    message: 'هذا الرابط غير موجود'
  })
})
module.exports = app;