# Evidence golden fixtures

Each JSON file contains:

- `checkpoint`: the checkpoint under test;
- `work`: a small serialized `WorkState` with captured tool results;
- `expected`: the stable verdict and a meaningful detail/reason fragment.

These fixtures are deterministic replay cases, not snapshots of timestamps or
full diagnostic prose. They protect the evidence contract when checkpoint logic
changes. A fixture that should pass must remain passed; a fixture that models
stale, missing, or fabricated evidence must remain rejected.
