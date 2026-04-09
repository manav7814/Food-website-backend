const toRadians = (value) => (value * Math.PI) / 180;

const haversineDistanceKm = (source, destination) => {
  if (!source || !destination) return null;

  const EARTH_RADIUS_KM = 6371;
  const dLat = toRadians(destination.lat - source.lat);
  const dLng = toRadians(destination.lng - source.lng);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(source.lat)) *
      Math.cos(toRadians(destination.lat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
};

/**
 * Calculate estimated delivery time based on distance
 * Uses realistic assumptions:
 * - Average city speed: 20 km/h (accounting for traffic)
 * - Restaurant preparation time: 15-20 minutes
 * @param {number|null} distanceKm - Distance in kilometers
 * @returns {object} - Object with estimated time in minutes and formatted string
 */
const calculateETA = (distanceKm) => {
  if (typeof distanceKm !== "number" || distanceKm <= 0) {
    return { estimatedMinutes: null, formattedETA: null };
  }

  const AVERAGE_CITY_SPEED_KMH = 20; // km/h - accounts for city traffic
  const PREPARATION_TIME_MIN = 15; // Restaurant preparation time

  // Calculate travel time: distance / speed * 60 (convert hours to minutes)
  const travelTimeMin = Math.round((distanceKm / AVERAGE_CITY_SPEED_KMH) * 60);

  // Add preparation time
  const totalTimeMin = travelTimeMin + PREPARATION_TIME_MIN;

  // Create formatted ETA string (e.g., "25-30 min" or "45-50 min")
  const minTime = totalTimeMin;
  const maxTime = totalTimeMin + 10; // Add 10 min buffer

  let formattedETA;
  if (totalTimeMin <= 30) {
    formattedETA = `${minTime}-${maxTime} min`;
  } else if (totalTimeMin <= 60) {
    formattedETA = `${minTime}-${maxTime} min`;
  } else if (totalTimeMin <= 90) {
    const hours = Math.floor(totalTimeMin / 60);
    const mins = totalTimeMin % 60;
    const maxHours = Math.floor(maxTime / 60);
    const maxMins = maxTime % 60;
    formattedETA = mins === 0 ? `${hours}-${maxHours} hr` : `${hours}h ${mins}-${maxMins} min`;
  } else {
    const hours = Math.floor(totalTimeMin / 60);
    const mins = totalTimeMin % 60;
    formattedETA = `${hours}h ${mins}+ min`;
  }

  return {
    estimatedMinutes: totalTimeMin,
    travelTimeMinutes: travelTimeMin,
    preparationTimeMinutes: PREPARATION_TIME_MIN,
    formattedETA
  };
};

module.exports = { haversineDistanceKm, calculateETA };

