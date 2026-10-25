const express = require('express');
const { checkJWT, restrictTo } = require('./../controllers/authController');
const codex = require('./../controllers/codexRequestController');

// the public POST is mounted in app.js before the login check
const router = express.Router();

router.use(checkJWT, restrictTo('admin'));

router.get('/', codex.getRequests);
router.route('/:id').patch(codex.updateRequest).delete(codex.deleteRequest);

module.exports = router;
