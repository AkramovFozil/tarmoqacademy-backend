const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { getMyPurchases } = require('../controllers/purchaseController');

router.get('/my', authMiddleware, getMyPurchases);

module.exports = router;
