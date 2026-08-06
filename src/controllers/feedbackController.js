const Feedback = require('../models/Feedback');

// ── @desc    Submit feedback ──────────────────────────────────────────────
// ── @route   POST /api/feedback
// ── @access  Public
const submitFeedback = async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        message: 'Name, email and message are required',
      });
    }

    const feedback = await Feedback.create({ name, email, subject, message });

    res.status(201).json({
      success: true,
      message: 'Thank you for your feedback!',
      data: { id: feedback._id },
    });
  } catch (error) {
    console.error('submitFeedback error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── @desc    Get all feedback (admin) ─────────────────────────────────────
// ── @route   GET /api/feedback
// ── @access  Admin
const getAllFeedback = async (req, res) => {
  try {
    const feedbacks = await Feedback.find().sort({ createdAt: -1 });
    res.json({ success: true, data: feedbacks });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── @desc    Delete feedback ───────────────────────────────────────────────
// ── @route   DELETE /api/feedback/:id
// ── @access  Admin
const deleteFeedback = async (req, res) => {
  try {
    const feedback = await Feedback.findById(req.params.id);
    if (!feedback) {
      return res.status(404).json({ success: false, message: 'Feedback not found' });
    }
    await feedback.deleteOne();
    res.json({ success: true, message: 'Feedback deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { submitFeedback, getAllFeedback, deleteFeedback };
