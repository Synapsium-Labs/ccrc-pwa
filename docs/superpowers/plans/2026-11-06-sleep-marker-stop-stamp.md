# A sleep marker that gives no time

The operator's ruling of 2026-11-06, decision 5. A session's `.hibernated` marker is listed but gives no time, because
its body will not parse or its read failed, and a stop stamp sits beside it. The server used to treat that as no marker,
so the session read dead. ccd read it as asleep.

## Deviations found

- **D-8067 (2026-11-06)** — a listed `.hibernated` marker that gives no time, beside a readable stop stamp, reads asleep at the stop stamp's time (`hibernatedAtOf`, `server/src/registry.ts`). The stamp is in seconds and is multiplied by 1000. `parseHibernated` is unchanged. A marker the read proves gone is a raced wake or stop and stays no marker.
