const express = require('express');
const { checkJWT, restrictTo } = require('./../controllers/authController');
const d = require('./../controllers/dashboardController');

const router = express.Router();

router.use(checkJWT, restrictTo('admin'));

router.post('/groups', d.createGroup);
router.patch('/groups/:groupId', d.renameGroup);
router.delete('/groups/:groupId', d.deleteGroup);
router.post('/groups/:groupId/students', d.addStudents);
router.delete('/groups/:groupId/students/:userId', d.removeStudent);
router.post('/groups/:groupId/supervisors', d.addSupervisor);
router.delete('/groups/:groupId/supervisors/:userId', d.removeSupervisor);
router.post('/supervisors', d.makeSupervisor);
router.delete('/supervisors/:userId', d.removeSupervisorRole);

module.exports = router;
