import Immutable from "immutable";
import { EntityTrackPing } from "../stores/TrackStore";
import { Entity } from "../types/entity";

type ExtrapolationData = [
  Immutable.Map<number, Entity>,
  Immutable.Map<number, EntityTrackPing[]>,
];

function linearInterpolate(a: number, b: number, alpha: number) {
  return (b - a) * alpha + a;
}

function quadraticInterpolate(a: number, b: number, c: number, alpha: number) {
  return linearInterpolate(
    linearInterpolate(a, b, alpha),
    linearInterpolate(b, c, alpha),
    alpha
  );
}

function cubicInterpolate(a: number, b: number, c: number, d: number, alpha: number) {
  return linearInterpolate(
    quadraticInterpolate(a, b, c, alpha),
    quadraticInterpolate(b, c, d, alpha),
    alpha
  );
}

function interpolate(
  a: EntityTrackPing,
  b: EntityTrackPing,
  alpha: number
): EntityTrackPing {
  return {
    altitude: linearInterpolate(a.altitude, b.altitude, alpha),
    heading: linearInterpolate(a.heading, b.heading, alpha),
    position: [
      linearInterpolate(a.position[0], b.position[0], alpha),
      linearInterpolate(a.position[1], b.position[1], alpha),
    ] as [number, number],
    time: linearInterpolate(a.time, b.time, alpha),
  };
}

function predict(
  lastPing: EntityTrackPing,
  secondToLastPing: EntityTrackPing,
  refreshRate: number
) {
  // Clamp the prediction lookahead time to avoid extreme extrapolations when
  // there is a connection issue between the client and the server
  const lookaheadFactor = 1.5;
  const maxLookahead = refreshRate * 1000 * lookaheadFactor;
  const elapsed = Math.min(Math.max(Date.now() - lastPing.time, 0), maxLookahead);

  const delta: EntityTrackPing = {
    altitude: lastPing.altitude - secondToLastPing.altitude,
    heading: lastPing.heading - secondToLastPing.heading,
    position: [
      lastPing.position[0] - secondToLastPing.position[0],
      lastPing.position[1] - secondToLastPing.position[1],
    ] as [number, number],
    time: lastPing.time - secondToLastPing.time,
  };

  // Predict constant-rate turns by rotating the delta vector
  const deltaHeading = delta.heading * Math.PI / 180;
  const positionDelta = [
    delta.position[0] * Math.cos(deltaHeading) - delta.position[1] * Math.sin(deltaHeading),
    delta.position[0] * Math.sin(deltaHeading) + delta.position[1] * Math.cos(deltaHeading),
  ] as [number, number];

  const predicted: EntityTrackPing = {
    altitude: lastPing.altitude + delta.altitude * lookaheadFactor,
    heading: lastPing.heading + delta.heading * lookaheadFactor,
    position: [
      lastPing.position[0] + positionDelta[0] * lookaheadFactor,
      lastPing.position[1] + positionDelta[1] * lookaheadFactor,
    ] as [number, number],
    time: lastPing.time + delta.time * lookaheadFactor,
  };

  return interpolate(lastPing, predicted, elapsed / maxLookahead);
}

export default function extrapolate([entities, tracks]: ExtrapolationData, refreshRate: number): ExtrapolationData {
  const newTracks = tracks.map((pings, id) => {
    const entity = entities.get(id);
    if (pings.length > 2 && entity) {
      // We have enough data to extrapolate
      const [lastPing, secondToLastPing] = pings;
      const nextPing = predict(lastPing, secondToLastPing, refreshRate);
      return [nextPing, ...pings];
    } else {
      // Return data as-is
      return pings;
    }
  });
  // Move entities to the final calculated position
  const newEntities = entities.map((entity, id) => {
    const pings = newTracks.get(id);
    if (pings == null || pings.length === 0) {
      return entity;
    }
    const nextPing = pings[0];
    return new Entity({
      ...entity,
      longitude: nextPing.position[1],
      latitude: nextPing.position[0],
      altitude: nextPing.altitude,
      created_at: entity.createdAt,
      updated_at: entity.updatedAt,
    });
  });
  return [newEntities, newTracks];
}
