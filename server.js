const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

const authRoutes = require('./routes/authRoutes');
const courseRoutes = require('./routes/courseRoutes');
const lessonRoutes = require('./routes/lessonRoutes');
const progressRoutes = require('./routes/progressRoutes');
const moduleRoutes = require('./routes/moduleRoutes');
const adminRoutes = require('./routes/adminRoutes');
const userRoutes = require('./routes/userRoutes');
const certificateRoutes = require('./routes/certificateRoutes');
const purchaseRoutes = require('./routes/purchaseRoutes');
const purchasesRoutes = require('./routes/purchasesRoutes');
const taskRoutes = require('./routes/taskRoutes');
const aiRoutes = require('./routes/aiRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const applicationRoutes = require('./routes/applicationRoutes');
const authMiddleware = require('./middleware/authMiddleware');
const { getMyCourses } = require('./controllers/userController');
const { getUserStats } = require('./controllers/progressController');

connectDB();

const app = express();
const UPLOADS_DIR = path.join(__dirname, 'uploads');

app.use(cors({
  origin: '*',
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use('/uploads', express.static(UPLOADS_DIR));

app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/lessons', lessonRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/modules', moduleRoutes);
app.use('/api/purchase', purchaseRoutes);
app.use('/api/purchases', purchasesRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/user', userRoutes);
app.use('/api/users', userRoutes);
app.use('/api/certificate', certificateRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/applications', applicationRoutes);

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'API working' });
});

app.get('/api/my-courses', authMiddleware, getMyCourses);
app.get('/api/stats', authMiddleware, getUserStats);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found.`,
  });
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      message: 'Invalid JSON payload.',
    });
  }

  console.error('Error:', err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
