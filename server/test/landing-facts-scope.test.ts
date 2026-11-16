// Landing order wave 5h, Task 3 Step 1: a characterization of one project's guarded landing facts across two projects,
// written green against the scan that read every project's rows whole, and kept green by the scan that reads other
// projects' rows as id, project and pr only. It pins the allocator, the foreign ids, the recovery fold (an identity
// conflict across the projects included), the projections, the dependencies and the coordinators.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openCoordDb } from '../src/coord/db.js';
import { mkTmp } from './tmpHelpers.js';
import { landingStoreOver } from './landingFixture.js';

const sha = (c: string): string => c.repeat(40);

function seed(): { db: DatabaseSync; read: (project: string) => ReturnType<ReturnType<typeof landingStoreOver>['readLanding']> } {
  const home = mkTmp('ccrc-landing-scope-');
  const dbPath = path.join(home, '.ccrc', 'coord.db');
  const db = openCoordDb(dbPath);
  const coord = landingStoreOver(db, dbPath);
  const entry = db.prepare(
    `INSERT INTO landing_entries (id, project, pr, pinnedSha, handoffCommit, runId, state, baseSha, ejectionKind,
       ejections, afterIds, fixesMain, setBy, pinnedAt)
     VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, 0, ?, 0, 'lane-a-project-a', ?)`);
  entry.run(1, 'project-a', 11, sha('a'), sha('b'), 'pinned', '[]', 1000);
  entry.run(2, 'project-a', 12, sha('c'), sha('d'), 'landed', '[1]', 2000);
  entry.run(3, 'project-b', 21, sha('e'), sha('f'), 'pinned', '[]', 3000);
  entry.run(4, 'project-b', 22, sha('1'), sha('2'), 'withdrawn', '[]', 4000);
  entry.run(5, 'project-a', 13, sha('3'), sha('4'), 'ejected', '[]', 5000);
  const subject = db.prepare(
    "INSERT INTO landing_subjects (id, project, pr, bindingKind, observedRunId, observedSeq) VALUES (?, ?, ?, 'no-run', NULL, ?)");
  subject.run(7, 'project-a', 40, 3);   // a recovered subject of project-a with no projection
  subject.run(8, 'project-b', 50, 4);   // a recovered subject of project-b with no projection
  subject.run(3, 'project-a', 21, 5);   // the same id as project-b's entry 3, under another project: an identity conflict
  return { db, read: (project) => coord.readLanding(project) };
}

describe('landing facts: one project read across two projects', () => {
  it("project-a's whole facts equal the pinned literal", () => {
    const { read } = seed();
    const r = read('project-a');
    if (!r.ok) throw new Error('fixture read refused');
    expect(r.facts).toEqual(EXPECTED_A);
  });

  it("project-b's whole facts equal the pinned literal", () => {
    const { read } = seed();
    const r = read('project-b');
    if (!r.ok) throw new Error('fixture read refused');
    expect(r.facts).toEqual(EXPECTED_B);
  });

  it('a foreign row with an invalid pr refuses the whole snapshot', () => {
    const { db, read } = seed();
    db.exec('PRAGMA ignore_check_constraints = ON');
    db.prepare("UPDATE landing_entries SET pr = 0 WHERE id = 4").run();
    db.exec('PRAGMA ignore_check_constraints = OFF');
    expect(read('project-a')).toEqual({ ok: false, error: 'landing-projection-unreadable', recovery: 'restart' });
  });
});

const EXPECTED_A = {
  "project": "project-a",
  "flags": {
    "operatorPaused": false,
    "mainRedHold": false
  },
  "entries": [
    {
      "id": 1,
      "project": "project-a",
      "pr": 11,
      "pinnedSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "handoffCommit": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "runId": null,
      "state": "pinned",
      "baseSha": null,
      "ejectionKind": null,
      "ejections": 0,
      "afterIds": [],
      "fixesMain": false,
      "setBy": "lane-a-project-a",
      "pinnedAt": 1000
    },
    {
      "id": 2,
      "project": "project-a",
      "pr": 12,
      "pinnedSha": "cccccccccccccccccccccccccccccccccccccccc",
      "handoffCommit": "dddddddddddddddddddddddddddddddddddddddd",
      "runId": null,
      "state": "landed",
      "baseSha": null,
      "ejectionKind": null,
      "ejections": 0,
      "afterIds": [
        1
      ],
      "fixesMain": false,
      "setBy": "lane-a-project-a",
      "pinnedAt": 2000
    },
    {
      "id": 5,
      "project": "project-a",
      "pr": 13,
      "pinnedSha": "3333333333333333333333333333333333333333",
      "handoffCommit": "4444444444444444444444444444444444444444",
      "runId": null,
      "state": "ejected",
      "baseSha": null,
      "ejectionKind": null,
      "ejections": 0,
      "afterIds": [],
      "fixesMain": false,
      "setBy": "lane-a-project-a",
      "pinnedAt": 5000
    }
  ],
  "recovery": {
    "subjects": [
      {
        "id": 3,
        "project": "project-a",
        "pr": 21,
        "creation": {
          "kind": "not-recorded"
        },
        "historical": {
          "binding": {
            "kind": "no-run"
          },
          "observedSeq": 5
        },
        "projection": {
          "kind": "identity-conflict",
          "conflicts": [
            {
              "id": 3,
              "project": "project-b",
              "pr": 21
            }
          ]
        },
        "authority": {
          "kind": "not-set"
        }
      },
      {
        "id": 7,
        "project": "project-a",
        "pr": 40,
        "creation": {
          "kind": "not-recorded"
        },
        "historical": {
          "binding": {
            "kind": "no-run"
          },
          "observedSeq": 3
        },
        "projection": {
          "kind": "missing",
          "association": "unmeasured"
        },
        "authority": {
          "kind": "not-set"
        }
      }
    ],
    "hold": {
      "reason": "landing-recovery-unresolved",
      "subjectIds": [
        3,
        7
      ]
    }
  },
  "projections": [
    {
      "id": 1,
      "value": {
        "kind": "readable",
        "quarantine": null
      }
    },
    {
      "id": 2,
      "value": {
        "kind": "readable",
        "quarantine": null
      }
    },
    {
      "id": 5,
      "value": {
        "kind": "readable",
        "quarantine": null
      }
    }
  ],
  "dependencies": [
    {
      "id": 1,
      "value": {
        "kind": "readable",
        "afterIds": []
      }
    },
    {
      "id": 2,
      "value": {
        "kind": "readable",
        "afterIds": [
          1
        ]
      }
    },
    {
      "id": 5,
      "value": {
        "kind": "readable",
        "afterIds": []
      }
    }
  ],
  "nextId": 9,
  "foreignIds": [
    8,
    3,
    4
  ],
  "coordinators": [
    {
      "id": 1,
      "value": {
        "kind": "no-run"
      }
    },
    {
      "id": 2,
      "value": {
        "kind": "no-run"
      }
    },
    {
      "id": 5,
      "value": {
        "kind": "no-run"
      }
    }
  ]
};
const EXPECTED_B = {
  "project": "project-b",
  "flags": {
    "operatorPaused": false,
    "mainRedHold": false
  },
  "entries": [
    {
      "id": 3,
      "project": "project-b",
      "pr": 21,
      "pinnedSha": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      "handoffCommit": "ffffffffffffffffffffffffffffffffffffffff",
      "runId": null,
      "state": "pinned",
      "baseSha": null,
      "ejectionKind": null,
      "ejections": 0,
      "afterIds": [],
      "fixesMain": false,
      "setBy": "lane-a-project-a",
      "pinnedAt": 3000
    },
    {
      "id": 4,
      "project": "project-b",
      "pr": 22,
      "pinnedSha": "1111111111111111111111111111111111111111",
      "handoffCommit": "2222222222222222222222222222222222222222",
      "runId": null,
      "state": "withdrawn",
      "baseSha": null,
      "ejectionKind": null,
      "ejections": 0,
      "afterIds": [],
      "fixesMain": false,
      "setBy": "lane-a-project-a",
      "pinnedAt": 4000
    }
  ],
  "recovery": {
    "subjects": [
      {
        "id": 3,
        "project": "project-a",
        "pr": 21,
        "creation": {
          "kind": "not-recorded"
        },
        "historical": {
          "binding": {
            "kind": "no-run"
          },
          "observedSeq": 5
        },
        "projection": {
          "kind": "identity-conflict",
          "conflicts": [
            {
              "id": 3,
              "project": "project-b",
              "pr": 21
            }
          ]
        },
        "authority": {
          "kind": "not-set"
        }
      },
      {
        "id": 8,
        "project": "project-b",
        "pr": 50,
        "creation": {
          "kind": "not-recorded"
        },
        "historical": {
          "binding": {
            "kind": "no-run"
          },
          "observedSeq": 4
        },
        "projection": {
          "kind": "missing",
          "association": "unmeasured"
        },
        "authority": {
          "kind": "not-set"
        }
      }
    ],
    "hold": {
      "reason": "landing-recovery-unresolved",
      "subjectIds": [
        3,
        8
      ]
    }
  },
  "projections": [
    {
      "id": 3,
      "value": {
        "kind": "readable",
        "quarantine": null
      }
    },
    {
      "id": 4,
      "value": {
        "kind": "readable",
        "quarantine": null
      }
    }
  ],
  "dependencies": [
    {
      "id": 3,
      "value": {
        "kind": "readable",
        "afterIds": []
      }
    },
    {
      "id": 4,
      "value": {
        "kind": "readable",
        "afterIds": []
      }
    }
  ],
  "nextId": 9,
  "foreignIds": [
    3,
    7,
    1,
    2,
    5
  ],
  "coordinators": [
    {
      "id": 3,
      "value": {
        "kind": "no-run"
      }
    },
    {
      "id": 4,
      "value": {
        "kind": "no-run"
      }
    }
  ]
};
