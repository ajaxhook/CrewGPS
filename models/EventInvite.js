const mongoose = require('mongoose');
const { Schema } = mongoose;

const EventInviteSchema = new Schema({
  trip: { type: Schema.Types.ObjectId, ref: 'trip', required: true },
  from: { type: Schema.Types.ObjectId, ref: 'user', required: true },
  to: { type: Schema.Types.ObjectId, ref: 'user', required: true },
  note: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
}, { timestamps: true });

module.exports = mongoose.model('event_invite', EventInviteSchema);
