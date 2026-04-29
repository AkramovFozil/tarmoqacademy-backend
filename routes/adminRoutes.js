const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const role = require('../middleware/roleMiddleware');
const { uploadImage, uploadPdf } = require('../middleware/uploadMiddleware');

const {
  getUsers, createUser, updateUser, updateCourse, deleteUser,
  getCourses, createCourse, deleteCourse, getCourseUsers,
  addCourseUser, updateCourseUser, removeCourseUser,
  getStats, assignCourseToUser, uploadCertificate,} = require('../controllers/adminController');


// All admin routes require auth + admin role
router.use(auth, role('admin'));

router.get('/stats',                               getStats);
router.get('/users',                               getUsers);
router.post('/users',                              createUser);
router.put('/users/:id',                           updateUser);
router.delete('/users/:id',                        deleteUser);
router.post('/assign-course',                      assignCourseToUser);
router.post('/certificates', uploadPdf.single('certificate'), uploadCertificate);
router.get('/courses',                             getCourses);
router.post('/courses',   uploadImage.single("image"),  createCourse);
router.put('/courses/:id', uploadImage.single("image"), updateCourse);
router.delete('/courses/:id',                      deleteCourse);
router.get('/courses/:courseId/users',             getCourseUsers);
router.post('/courses/:courseId/users',            addCourseUser);
router.put('/courses/:courseId/users/:userId',     updateCourseUser);
router.delete('/courses/:courseId/users/:userId',  removeCourseUser);

module.exports = router;
