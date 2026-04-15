const express = require('express');
const router = express.Router();

const auth = require('../middleware/authMiddleware');
const role = require('../middleware/roleMiddleware');
const {
  createApplication,
  getApplications,
  updateApplicationStatus,
} = require('../controllers/applicationController');

router.post('/', createApplication);
router.get('/', auth, role('admin'), getApplications);
router.put('/:id', auth, role('admin'), updateApplicationStatus);

module.exports = router;
