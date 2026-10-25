// Consultation requests sent from the Codex website's form (separate site, posts to /api/v1/codex-requests)
const mongoose = require('mongoose');

const STATUSES = ['new', 'contacted', 'done'];

const codexRequestSchema = new mongoose.Schema({
  projectType: { type: String, required: true, trim: true, maxlength: 60 },
  budget: { type: String, required: true, trim: true, maxlength: 60 },
  deadline: { type: String, trim: true, maxlength: 60 },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  phone: { type: String, required: true, trim: true, maxlength: 30 },
  location: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, trim: true, lowercase: true, maxlength: 120 },
  details: { type: String, required: true, trim: true, maxlength: 3000 },
  status: { type: String, enum: STATUSES, default: 'new' },
  note: { type: String, trim: true, maxlength: 2000, default: '' }
}, { timestamps: true });

codexRequestSchema.index({ createdAt: -1 });

const CodexRequest = mongoose.model('CodexRequest', codexRequestSchema);
CodexRequest.STATUSES = STATUSES;

module.exports = CodexRequest;
