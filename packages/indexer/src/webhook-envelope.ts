export interface EnvelopeInput {
  eventType: string;
  data: unknown;
  livemode: boolean;
  createdAt?: Date;
}

export interface Envelope {
  event: string;
  timestamp: string;
  livemode: boolean;
  data: unknown;
}

export function buildEnvelope(input: EnvelopeInput): Envelope {
  return {
    event: input.eventType,
    timestamp: (input.createdAt ?? new Date()).toISOString(),
    livemode: input.livemode,
    data: input.data,
  };
}
