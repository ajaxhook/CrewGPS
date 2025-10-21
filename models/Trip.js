const mongoose = require('mongoose');

const TripSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    routeName: { type: String, required: true },
    description: { type: String },
    startLocation: { 
      description: { type: String },
      lat: { type: Number },
      lng: { type: Number }
    },
    endLocation: { 
      description: { type: String }
    },
    stops: [{ 
      description: { type: String }
    }],
    date: { type: Date, required: true },
    durationText: { type: String },
    distanceText: { type: String },
    isPublic: { type: Boolean, default: false },
    invitedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // ** VERIFIQUE SE TEM ESTA LINHA **
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

module.exports = mongoose.model('Trip', TripSchema);