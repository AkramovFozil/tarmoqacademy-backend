const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { createPurchase, createPurchaseFromLegacyRoute } = require('../controllers/purchaseController');

router.post('/', authMiddleware, createPurchase);
router.post('/:courseId', authMiddleware, createPurchaseFromLegacyRoute);

module.exports = router;
