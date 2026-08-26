# Development Discipline

- This project follows test-driven development. Write the failing test
  first, run it, confirm it fails for the expected reason, then implement.
- If a test passes before its implementation exists, stop and report it
  rather than proceeding.
- Coverage may not decrease. A drop is your responsibility to fix, not a
  pre-existing condition.
- When fixing a bug, first determine whether it is an instance of a class
  of bug. If it is, write a static test that fails on any occurrence of
  that class anywhere in the codebase, then fix all occurrences.
- All sixteen tools must construct results through the single shared
  result builder (Invariant 12). No tool may build its own result object.
