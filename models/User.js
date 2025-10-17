const mongoose = require('mongoose');

const VehicleSchema = new mongoose.Schema({
  make: { type: String, required: true },
  model: { type: String, required: true },
  color: { type: String, required: true },
  plate: { type: String, required: true }
}, { _id: true });

const UserSchema = new mongoose.Schema({
  nome:  { type: String, required: true, unique: true, index: true },
  email: { type: String, required: true, unique: true, index: true },
  password: { type: String, required: true },
  profilePicture: { type: String, default: '' },
  garage: [VehicleSchema],
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  resetPasswordCode: { type: String },
  resetPasswordExpires: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
