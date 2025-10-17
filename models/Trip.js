const mongoose = require('mongoose');

const LocationSchema = new mongoose.Schema({
  description: { type: String, required: true }
}, { _id: false });

const TripSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  routeName: { type: String, required: true },
  description: { type: String, default: '' },
  startLocation: { type: LocationSchema, required: true },
  endLocation:   { type: LocationSchema, required: true },
  stops: [{ description: String }],
  date: { type: Date, required: true },
  durationText: String,
  distanceText: String,
  isPublic: { type: Boolean, default: false },
  invitedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

module.exports = mongoose.model('Trip', TripSchema);
