const mongoose = require('mongoose');

// admin-made groups of students; supervisors see the full info of the students in their groups
const studentGroupSchema = new mongoose.Schema({
  name: { type: String, required: [true, 'الرجاء كتابة اسم المجموعة'], trim: true, maxlength: [60, 'اسم المجموعة طويل جدا'] },
  students: [{ type: mongoose.Schema.ObjectId, ref: 'User' }],
  supervisors: [{ type: mongoose.Schema.ObjectId, ref: 'User' }]
}, { timestamps: true });

studentGroupSchema.index({ supervisors: 1 });
studentGroupSchema.index({ students: 1 });

module.exports = mongoose.model('StudentGroup', studentGroupSchema);
