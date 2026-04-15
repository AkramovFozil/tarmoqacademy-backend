const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const { getMyCourses, updateProfile } = require('../controllers/userController');
const { createPurchaseFromLegacyRoute } = require('../controllers/purchaseController');

router.get('/my-courses', auth, getMyCourses);
router.put('/profile', auth, updateProfile);
router.post('/purchase/:courseId', auth, createPurchaseFromLegacyRoute);

module.exports = router;
