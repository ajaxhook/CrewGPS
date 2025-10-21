const mongoose = require('mongoose');
const { Schema } = mongoose;

const ConversationSchema = new Schema({
  participants: [{ type: Schema.Types.ObjectId, ref: 'user', required: true }],
  lastMessageAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('conversation', ConversationSchema);
