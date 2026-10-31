const mongoose = require('mongoose');

// one document per solve of a lesson quiz (students can solve a quiz many times)
const quizAttemptSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
  subcourse: { type: mongoose.Schema.ObjectId, ref: 'Subcourse', required: true },
  lesson: { type: mongoose.Schema.ObjectId, ref: 'Lesson', required: true },
  resourceNum: { type: Number, required: true },
  lessonTitle: String,
  quizTitle: String,
  correct: { type: Number, required: true },
  total: { type: Number, required: true },
  createdAt: { type: Date, default: () => Date.now() }
});

quizAttemptSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('QuizAttempt', quizAttemptSchema);
