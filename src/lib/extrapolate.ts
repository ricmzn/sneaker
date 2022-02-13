import Immutable from "immutable";
import { EntityTrackPing } from "../stores/TrackStore";
import { Entity } from "../types/entity";

export interface ExtrapolationState {
  positions?: Map<number, EntityTrackPing>;
  predictions?: Map<number, EntityTrackPing>;
}

type ExtrapolationData = [
  Immutable.Map<number, Entity>,
  Immutable.Map<number, EntityTrackPing[]>,
];

function linearInterpolate(a: number, b: number, alpha: number) {
  return (b - a) * alpha + a;
}

function interpolate(
  a: EntityTrackPing,
  b: EntityTrackPing,
  alpha: number,
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
  previousPing: EntityTrackPing,
  currentPing: EntityTrackPing,
  currentPosition: EntityTrackPing,
  lastPrediction: EntityTrackPing,
  refreshRate: number,
) {
  // Clamp the prediction lookahead time to avoid extreme extrapolations when
  // there is a connection issue between the client and the server
  const lookaheadFactor = 1.5;
  const maxLookahead = refreshRate * 1000 * lookaheadFactor;
  const elapsed = Math.min(Math.max(Date.now() - currentPosition.time, 0), maxLookahead);

  const delta: EntityTrackPing = {
    altitude: currentPing.altitude - previousPing.altitude,
    heading: currentPing.heading - previousPing.heading,
    position: [
      currentPing.position[0] - previousPing.position[0],
      currentPing.position[1] - previousPing.position[1],
    ] as [number, number],
    time: currentPing.time - previousPing.time,
  };

  // Predict constant-rate turns by rotating the delta vector
  const deltaHeading = delta.heading * Math.PI / 180;
  const positionDelta = [
    delta.position[0] * Math.cos(deltaHeading) - delta.position[1] * Math.sin(deltaHeading),
    delta.position[0] * Math.sin(deltaHeading) + delta.position[1] * Math.cos(deltaHeading),
  ] as [number, number];

  const prediction: EntityTrackPing = {
    altitude: currentPing.altitude + delta.altitude * lookaheadFactor,
    heading: currentPing.heading + delta.heading * lookaheadFactor,
    position: [
      currentPing.position[0] + positionDelta[0] * lookaheadFactor,
      currentPing.position[1] + positionDelta[1] * lookaheadFactor,
    ] as [number, number],
    time: currentPing.time + delta.time * lookaheadFactor,
  };

  const alpha = elapsed / maxLookahead;
  const interpPrediction = interpolate(lastPrediction, prediction, alpha);
  const newPosition = interpolate(currentPosition, interpPrediction, alpha);

  return [
    newPosition,
    prediction,
  ];
}

export default function extrapolate(
  [entities, tracks]: ExtrapolationData,
  state: ExtrapolationState,
  refreshRate: number,
): ExtrapolationData {
  if (!state.positions) {
    state.positions = new Map();
  }
  if (!state.predictions) {
    state.predictions = new Map();
  }
  const newTracks = tracks.map((pings, id) => {
    if (pings.length > 1) {
      // We have enough data to extrapolate
      const [currentPing, previousPing] = pings;
      const currentPosition = state.positions!.get(id) ?? currentPing;
      const lastPrediction = state.predictions!.get(id) ?? currentPing;
      const [position, prediction] =
        predict(previousPing, currentPing, currentPosition, lastPrediction, refreshRate);
      state.positions!.set(id, position);
      state.predictions!.set(id, prediction);
      return [position, ...pings];
    } else {
      // Return data as-is
      return pings;
    }
  });
  // Move entities to the predicted position
  const newEntities = entities.map((entity, id) => {
    const pings = newTracks.get(id);
    if (pings == null || pings.length === 0) {
      return entity;
    }
    const lastPing = pings[0];
    return new Entity({
      ...entity,
      longitude: lastPing.position[1],
      latitude: lastPing.position[0],
      altitude: lastPing.altitude,
      created_at: entity.createdAt,
      updated_at: entity.updatedAt,
    });
  });
  return [newEntities, newTracks];
}
