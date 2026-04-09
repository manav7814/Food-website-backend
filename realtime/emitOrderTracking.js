const { haversineDistanceKm, calculateETA } = require("../utils/geo");

const toLatLng = (location = {}) => {
  const lat = Number(location.lat ?? location.latitude);
  const lng = Number(location.lng ?? location.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

const calculateTrackingDistances = (orderObj) => {
  const restaurant = toLatLng(orderObj.restaurantLocation);
  const userLocation = toLatLng(orderObj.userLocation || orderObj.deliveryLocation);
  const driverLocation = toLatLng(orderObj.driverLocation);

  let pickupDistanceKm = null;
  let deliveryDistanceKm = null;
  let routeDistanceKm = null;
  let activeRoute = "restaurant_to_user";

  // Always calculate restaurant to user distance
  if (restaurant && userLocation) {
    routeDistanceKm = haversineDistanceKm(restaurant, userLocation);
  }

  // Calculate driver-specific distances
  if (driverLocation) {
    if (restaurant) {
      pickupDistanceKm = haversineDistanceKm(driverLocation, restaurant);
    }
    if (userLocation) {
      deliveryDistanceKm = haversineDistanceKm(driverLocation, userLocation);
    }
  }

  // Determine active route based on status
  const status = orderObj.status;
  if (["assigned", "accepted"].includes(status)) {
    activeRoute = "driver_to_restaurant";
  } else if (["picked", "out_for_delivery"].includes(status)) {
    activeRoute = "driver_to_user";
  }

  // Calculate active distance
  let activeDistanceKm = routeDistanceKm;
  let estimatedDurationMin = null;

  if (activeRoute === "driver_to_restaurant" && pickupDistanceKm) {
    activeDistanceKm = pickupDistanceKm;
    const travelTimeMin = Math.round((pickupDistanceKm / 20) * 60);
    estimatedDurationMin = travelTimeMin;
  } else if (activeRoute === "driver_to_user" && deliveryDistanceKm) {
    activeDistanceKm = deliveryDistanceKm;
    const travelTimeMin = Math.round((deliveryDistanceKm / 20) * 60);
    estimatedDurationMin = travelTimeMin;
  } else if (routeDistanceKm) {
    const etaInfo = calculateETA(routeDistanceKm);
    estimatedDurationMin = etaInfo.estimatedMinutes;
  }

  return {
    routeDistanceKm,
    pickupDistanceKm,
    deliveryDistanceKm,
    activeRoute,
    activeDistanceKm,
    estimatedDurationMin
  };
};

const normalizeTrackingPayload = (order) => {
  const orderObj = typeof order.toObject === "function" ? order.toObject() : order;

  // Calculate distances based on order status
  const distances = calculateTrackingDistances(orderObj);

  return {
    orderId: String(orderObj._id),
    status: orderObj.status,
    orderStatus: orderObj.orderStatus,
    restaurantLocation: orderObj.restaurantLocation
      ? {
          lat: Number(orderObj.restaurantLocation.lat ?? orderObj.restaurantLocation.latitude),
          lng: Number(orderObj.restaurantLocation.lng ?? orderObj.restaurantLocation.longitude)
        }
      : null,
    userLocation: orderObj.userLocation
      ? {
          lat: Number(orderObj.userLocation.lat),
          lng: Number(orderObj.userLocation.lng)
        }
      : orderObj.deliveryLocation
        ? {
            lat: Number(orderObj.deliveryLocation.latitude),
            lng: Number(orderObj.deliveryLocation.longitude)
          }
        : null,
    driverLocation: orderObj.driverLocation
      ? {
          lat: Number(orderObj.driverLocation.lat),
          lng: Number(orderObj.driverLocation.lng)
        }
      : null,
    // Include distance calculations
    routeDistanceKm: distances.routeDistanceKm,
    pickupDistanceKm: distances.pickupDistanceKm,
    deliveryDistanceKm: distances.deliveryDistanceKm,
    activeRoute: distances.activeRoute,
    activeDistanceKm: distances.activeDistanceKm,
    estimatedDurationMin: distances.estimatedDurationMin,
    driver: orderObj.driver ? String(orderObj.driver) : null,
    user: orderObj.user ? String(orderObj.user) : null,
    updatedAt: orderObj.updatedAt
  };
};

const emitOrderTracking = (io, order, eventType = "order:tracking") => {
  if (!io || !order) return;

  const payload = normalizeTrackingPayload(order);
  const orderRoom = `order:${payload.orderId}`;
  io.to(orderRoom).emit(eventType, payload);

  if (payload.user) io.to(`user:${payload.user}`).emit(eventType, payload);
  if (payload.driver) io.to(`driver:${payload.driver}`).emit(eventType, payload);
};

module.exports = { emitOrderTracking, normalizeTrackingPayload };

