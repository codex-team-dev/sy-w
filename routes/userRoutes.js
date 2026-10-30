const express = require('express');

const router = express.Router();

const { signup, login, checkFingerPrint, checkJWT, restrictTo, updatePassword, updateEmailName, checkActivatedSubcourse, logout, updateCertainPassword, activateUser, addPackage, updateProgress } = require('./../controllers/authController');

router.post('/signup', signup);
router.post('/login', login);
router.post('/logout', logout);
router.post('/update-password', checkJWT, updatePassword);
router.post('/update-email-name', checkJWT, updateEmailName);
router.post('/check-activated-subcourse', checkJWT, checkActivatedSubcourse);
router.post('/update-certain-password', checkJWT, restrictTo('admin'), updateCertainPassword);
router.post('/activate-user', checkJWT, restrictTo('admin'), activateUser);
router.post('/add-package', checkJWT, restrictTo('admin'), addPackage);
router.post('/update-progress', checkJWT, checkActivatedSubcourse, updateProgress);
// router.get('/forgot-password', checkFingerPrint, forgotPassword)
// router.patch('/reset-password/:resetToken', resetPassword);

module.exports = router;