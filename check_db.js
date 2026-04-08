const mongoose = require('mongoose');
const { getTileKeysForBbox } = require('./modules/database/utils/tileKey');
const OcmCharger = require('./modules/database/models/OcmCharger');

mongoose.connect('mongodb://localhost:27017/route_planner').then(async () => {
  const charger = await OcmCharger.findOne({
    location: {
      $near: {
        $geometry: { type: "Point", coordinates: [77.22113, 28.527351] },
        $maxDistance: 1000
      }
    }
  });
  console.log("DB Charger:", charger);
  process.exit(0);
}).catch(err => {
  console.error("DB Error:", err);
  process.exit(1);
});
