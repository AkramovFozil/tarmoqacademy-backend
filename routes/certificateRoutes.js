const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const { getCertificate } = require('../controllers/certificateController');

router.get('/:courseId', auth, getCertificate);

module.exports = router;
