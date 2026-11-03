# Session slice limits from box config

- **D-7296 (2026-10-28)** — the session slice's MemoryMax and MemorySwapMax are rendered from box config (CCRC_SESSION_SLICE_MEMORY_MAX / CCRC_SESSION_SLICE_SWAP_MAX), defaulting to 24G and 6G; a value below the floor or unparseable is refused loudly and the already-installed value is kept; operator ruling 2026-10-28 that ccrc code is never machine-specific.
